package inotify

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestLettersToMaskMapping(t *testing.T) {
	cases := map[string]uint32{
		"a": unix.IN_ACCESS,
		"c": unix.IN_MODIFY,
		"e": unix.IN_ATTRIB,
		"w": unix.IN_CLOSE_WRITE,
		"0": unix.IN_CLOSE_NOWRITE,
		"r": unix.IN_OPEN,
		"n": unix.IN_CREATE,
		"d": unix.IN_DELETE,
		"D": unix.IN_DELETE_SELF,
		"M": unix.IN_MOVE_SELF,
		"m": unix.IN_MOVED_TO,
		"y": unix.IN_MOVED_FROM,
		"*": unix.IN_ALL_EVENTS,
	}
	for letter, want := range cases {
		if got := LettersToMask(letter); got != want {
			t.Errorf("LettersToMask(%q) = %#x, 期望 %#x", letter, got, want)
		}
	}
	// 内核产生的事件字母不应设置 mask
	for _, letter := range []string{"u", "o", "x", "z"} {
		if got := LettersToMask(letter); got != 0 {
			t.Errorf("LettersToMask(%q) 应为 0, 实际 %#x", letter, got)
		}
	}
	if got := LettersToMask("cw"); got != unix.IN_MODIFY|unix.IN_CLOSE_WRITE {
		t.Errorf("多字母组合错误: %#x", got)
	}
}

func TestMaskToLettersOrder(t *testing.T) {
	var mask uint32 = unix.IN_MODIFY | unix.IN_CLOSE_WRITE | unix.IN_CLOSE_NOWRITE
	if got := MaskToLetters(mask); got != "cw0" {
		t.Fatalf("MaskToLetters = %q, 期望 cw0", got)
	}
	if got := MaskToLetters(0); got != "?" {
		t.Fatalf("空 mask 应为 ?, 实际 %q", got)
	}
}

// collect 在后台运行 Runner，收集事件。
type collector struct {
	mu     sync.Mutex
	events []Event
}

func (c *collector) add(ev Event) {
	c.mu.Lock()
	c.events = append(c.events, ev)
	c.mu.Unlock()
}

func (c *collector) snapshot() []Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]Event(nil), c.events...)
}

func startRunner(t *testing.T, w *Watcher, debounce time.Duration, handler func(Event)) chan struct{} {
	t.Helper()
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = w.NewRunner(debounce, nil).Run(handler, stop)
	}()
	t.Cleanup(func() {
		// 必须先让 Run 退出，再关闭 watcher：反过来会先关掉唤醒管道，
		// Stop 的唤醒丢失，Run 会卡在 poll 里直到超时（CI 上偶发）
		close(stop)
		w.Stop()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("Run 未能退出")
		}
		w.Close()
	})
	return stop
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return cond()
}

func TestWatchModifyDeliversEvent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "brightness")
	if err := os.WriteFile(path, []byte("100"), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := New()
	if err != nil {
		t.Skipf("当前环境不支持 inotify: %v", err)
	}
	if err := w.Add(path, "c"); err != nil {
		t.Fatal(err)
	}

	c := &collector{}
	startRunner(t, w, 30*time.Millisecond, c.add)

	if err := os.WriteFile(path, []byte("200"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !waitFor(t, 2*time.Second, func() bool { return len(c.snapshot()) > 0 }) {
		t.Fatal("未收到 MODIFY 事件")
	}
	ev := c.snapshot()[0]
	if !strings.Contains(ev.Letters, "c") || ev.Path != path {
		t.Fatalf("事件内容不正确: %+v", ev)
	}
}

// 关键兼容性测试：fsnotify 不暴露 CLOSE_WRITE，必须能收到 'w'。
func TestCloseWriteLetter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := New()
	if err != nil {
		t.Skipf("当前环境不支持 inotify: %v", err)
	}
	if err := w.Add(path, "w"); err != nil {
		t.Fatal(err)
	}

	c := &collector{}
	startRunner(t, w, 30*time.Millisecond, c.add)

	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("2"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	if !waitFor(t, 2*time.Second, func() bool { return len(c.snapshot()) > 0 }) {
		t.Fatal("未收到 CLOSE_WRITE 事件")
	}
	if got := c.snapshot()[0].Letters; !strings.Contains(got, "w") {
		t.Fatalf("事件字母应为 w, 实际 %q", got)
	}
}

func TestCloseNoWriteLetter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := New()
	if err != nil {
		t.Skipf("当前环境不支持 inotify: %v", err)
	}
	if err := w.Add(path, "0"); err != nil {
		t.Fatal(err)
	}

	c := &collector{}
	startRunner(t, w, 30*time.Millisecond, c.add)

	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Read(make([]byte, 1))
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	if !waitFor(t, 2*time.Second, func() bool { return len(c.snapshot()) > 0 }) {
		t.Fatal("未收到 CLOSE_NOWRITE 事件")
	}
	if got := c.snapshot()[0].Letters; !strings.Contains(got, "0") {
		t.Fatalf("事件字母应为 0, 实际 %q", got)
	}
}

func TestDebounceCoalescesBurst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := New()
	if err != nil {
		t.Skipf("当前环境不支持 inotify: %v", err)
	}
	if err := w.Add(path, "c"); err != nil {
		t.Fatal(err)
	}

	c := &collector{}
	// 防抖窗口取大一些：CI 上单次写文件可能耗时数十毫秒，
	// 窗口过短会让连写跨越窗口边界，产生第 2 次触发（测试因此偶发失败）
	const debounceWindow = 800 * time.Millisecond
	startRunner(t, w, debounceWindow, c.add)

	for i := 0; i < 5; i++ {
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if !waitFor(t, 3*time.Second, func() bool { return len(c.snapshot()) > 0 }) {
		t.Fatal("未收到事件")
	}
	time.Sleep(debounceWindow + 400*time.Millisecond) // 等超过一个防抖窗口
	if got := len(c.snapshot()); got != 1 {
		t.Fatalf("防抖后应只触发 1 次, 实际 %d 次", got)
	}
}

// handler 自身写入被监听文件时，积压事件必须被丢弃，避免递归。
func TestDrainPreventsRecursion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := New()
	if err != nil {
		t.Skipf("当前环境不支持 inotify: %v", err)
	}
	if err := w.Add(path, "c"); err != nil {
		t.Fatal(err)
	}

	c := &collector{}
	startRunner(t, w, 100*time.Millisecond, func(ev Event) {
		c.add(ev)
		// 模拟亮度渐变写入
		for i := 0; i < 5; i++ {
			_ = os.WriteFile(path, []byte("step"), 0o644)
		}
	})

	if err := os.WriteFile(path, []byte("trigger"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !waitFor(t, 2*time.Second, func() bool { return len(c.snapshot()) > 0 }) {
		t.Fatal("未收到事件")
	}
	time.Sleep(400 * time.Millisecond)
	if got := len(c.snapshot()); got != 1 {
		t.Fatalf("渐变写入产生的事件应被丢弃, handler 应只执行 1 次, 实际 %d 次", got)
	}
}

func TestStopExitsBlockingRun(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(path, []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := New()
	if err != nil {
		t.Skipf("当前环境不支持 inotify: %v", err)
	}
	if err := w.Add(path, "c"); err != nil {
		t.Fatal(err)
	}

	stop := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- w.NewRunner(time.Second, nil).Run(func(Event) {}, stop)
	}()

	time.Sleep(100 * time.Millisecond)
	close(stop)
	w.Stop() // 唤醒阻塞中的 poll

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run 返回错误: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Stop 未能唤醒 Run")
	}
}

func TestAddMissingPathFails(t *testing.T) {
	w, err := New()
	if err != nil {
		t.Skipf("当前环境不支持 inotify: %v", err)
	}
	if err := w.Add(filepath.Join(t.TempDir(), "不存在"), "c"); err == nil {
		t.Fatal("监听不存在的路径应报错")
	}
}

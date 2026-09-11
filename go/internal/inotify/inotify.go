// Package inotify 封装原始 inotify，事件字母与 toybox inotifyd 完全兼容。
//
// 为什么不用 fsnotify：fsnotify 不暴露 IN_CLOSE_WRITE / IN_CLOSE_NOWRITE，
// 而部分机型需要监听 `w` / `0` 事件才能触发亮度提升。
package inotify

import (
	"fmt"
	"os"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

// Event 是一次监听事件。
type Event struct {
	Letters string // 事件字母串，如 "c"、"0"、"cw"
	Path    string // 触发事件的被监听路径
}

// LettersToMask 把事件字母串转换为 inotify watch mask（与 toybox 兼容）。
func LettersToMask(letters string) uint32 {
	var mask uint32
	for _, c := range letters {
		switch c {
		case 'a':
			mask |= unix.IN_ACCESS
		case 'c':
			mask |= unix.IN_MODIFY
		case 'e':
			mask |= unix.IN_ATTRIB
		case 'w':
			mask |= unix.IN_CLOSE_WRITE
		case '0':
			mask |= unix.IN_CLOSE_NOWRITE
		case 'r':
			mask |= unix.IN_OPEN
		case 'n':
			mask |= unix.IN_CREATE
		case 'd':
			mask |= unix.IN_DELETE
		case 'D':
			mask |= unix.IN_DELETE_SELF
		case 'M':
			mask |= unix.IN_MOVE_SELF
		case 'm':
			mask |= unix.IN_MOVED_TO
		case 'y':
			mask |= unix.IN_MOVED_FROM
		case '*':
			mask |= unix.IN_ALL_EVENTS
		case 'u', 'o', 'x':
			// 内核产生的事件，不设置 watch mask
		}
	}
	return mask
}

// MaskToLetters 把事件 mask 转回字母串（顺序与旧 lumipro 一致）。
func MaskToLetters(mask uint32) string {
	var s []byte
	if mask&unix.IN_ACCESS != 0 {
		s = append(s, 'a')
	}
	if mask&unix.IN_MODIFY != 0 {
		s = append(s, 'c')
	}
	if mask&unix.IN_ATTRIB != 0 {
		s = append(s, 'e')
	}
	if mask&unix.IN_CLOSE_WRITE != 0 {
		s = append(s, 'w')
	}
	if mask&unix.IN_CLOSE_NOWRITE != 0 {
		s = append(s, '0')
	}
	if mask&unix.IN_OPEN != 0 {
		s = append(s, 'r')
	}
	if mask&unix.IN_MOVED_FROM != 0 {
		s = append(s, 'y')
	}
	if mask&unix.IN_MOVED_TO != 0 {
		s = append(s, 'm')
	}
	if mask&unix.IN_CREATE != 0 {
		s = append(s, 'n')
	}
	if mask&unix.IN_DELETE != 0 {
		s = append(s, 'd')
	}
	if mask&unix.IN_DELETE_SELF != 0 {
		s = append(s, 'D')
	}
	if mask&unix.IN_MOVE_SELF != 0 {
		s = append(s, 'M')
	}
	if mask&unix.IN_UNMOUNT != 0 {
		s = append(s, 'u')
	}
	if mask&unix.IN_Q_OVERFLOW != 0 {
		s = append(s, 'o')
	}
	if mask&unix.IN_IGNORED != 0 {
		s = append(s, 'x')
	}
	if len(s) == 0 {
		return "?"
	}
	return string(s)
}

// Watcher 是一个 inotify 实例。
type Watcher struct {
	fd    int
	wakeR int
	wakeW int

	mu      sync.Mutex
	watches map[int32]string
}

// New 创建 watcher。
func New() (*Watcher, error) {
	fd, err := unix.InotifyInit1(unix.IN_NONBLOCK | unix.IN_CLOEXEC)
	if err != nil {
		return nil, fmt.Errorf("inotify_init 失败: %w", err)
	}
	// 唤醒管道：让 Run 能在阻塞 poll 期间被 Stop 立即唤醒
	var pipe [2]int
	if err := unix.Pipe2(pipe[:], unix.O_NONBLOCK|unix.O_CLOEXEC); err != nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("创建唤醒管道失败: %w", err)
	}
	return &Watcher{
		fd:      fd,
		wakeR:   pipe[0],
		wakeW:   pipe[1],
		watches: map[int32]string{},
	}, nil
}

// Add 监听路径，letters 为事件字母串。
func (w *Watcher) Add(path, letters string) error {
	mask := LettersToMask(letters)
	wd, err := unix.InotifyAddWatch(w.fd, path, mask)
	if err != nil {
		return fmt.Errorf("监听 %s 失败: %w", path, err)
	}
	w.mu.Lock()
	w.watches[int32(wd)] = path
	w.mu.Unlock()
	return nil
}

// Close 释放资源。重复调用安全。
func (w *Watcher) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	// 先唤醒 Run：直接关闭 fd 会让阻塞中的 poll 拿不到退出信号
	if w.wakeW >= 0 {
		_, _ = unix.Write(w.wakeW, []byte{1})
	}
	if w.wakeR >= 0 {
		_ = unix.Close(w.wakeR)
		w.wakeR = -1
	}
	if w.wakeW >= 0 {
		_ = unix.Close(w.wakeW)
		w.wakeW = -1
	}
	if w.fd >= 0 {
		err := unix.Close(w.fd)
		w.fd = -1
		return err
	}
	return nil
}

// wake 唤醒正在 poll 的 Run。并发/重复调用安全。
func (w *Watcher) wake() {
	w.mu.Lock()
	fd := w.wakeW
	w.mu.Unlock()
	if fd >= 0 {
		_, _ = unix.Write(fd, []byte{1})
	}
}

// poll 等待 inotify fd 可读或唤醒管道触发。timeoutMs 为 -1 表示永久阻塞。
func (w *Watcher) poll(timeoutMs int) (ready, woken bool, err error) {
	fds := []unix.PollFd{
		{Fd: int32(w.fd), Events: unix.POLLIN},
		{Fd: int32(w.wakeR), Events: unix.POLLIN},
	}
	n, err := unix.Poll(fds, timeoutMs)
	if err != nil {
		if err == unix.EINTR {
			return false, false, nil
		}
		return false, false, err
	}
	if n == 0 {
		return false, false, nil
	}
	if fds[1].Revents&unix.POLLIN != 0 {
		return false, true, nil
	}
	return fds[0].Revents&unix.POLLIN != 0, false, nil
}

// ReadEvents 非阻塞读取当前可用的全部事件；无数据时返回空切片。
func (w *Watcher) ReadEvents() ([]Event, error) {
	var events []Event
	buf := make([]byte, 4096)
	evSize := int(unsafe.Sizeof(unix.InotifyEvent{}))

	for {
		n, err := unix.Read(w.fd, buf)
		if err != nil {
			if err == unix.EAGAIN || err == unix.EWOULDBLOCK {
				return events, nil
			}
			if err == unix.EINTR {
				continue
			}
			return events, err
		}
		if n <= 0 {
			return events, nil
		}

		for offset := 0; offset+evSize <= n; {
			raw := (*unix.InotifyEvent)(unsafe.Pointer(&buf[offset]))
			// 事件结构后跟 name（已 NUL 结尾），本程序按 wd 定位路径，忽略 name
			offset += evSize + int(raw.Len)

			w.mu.Lock()
			path, ok := w.watches[raw.Wd]
			w.mu.Unlock()
			if !ok {
				continue
			}
			events = append(events, Event{
				Letters: MaskToLetters(raw.Mask),
				Path:    path,
			})
		}
	}
}

// Runner 把 watcher 包装成「防抖 + 执行 handler + 排空积压」的事件循环。
type Runner struct {
	w        *Watcher
	debounce time.Duration
	debugf   func(format string, args ...any)
}

// NewRunner 创建事件循环。debugf 可为 nil。
func (w *Watcher) NewRunner(debounce time.Duration, debugf func(string, ...any)) *Runner {
	if debounce <= 0 {
		debounce = 300 * time.Millisecond
	}
	return &Runner{w: w, debounce: debounce, debugf: debugf}
}

func (r *Runner) debug(format string, args ...any) {
	if r.debugf != nil {
		r.debugf(format, args...)
	}
}

// Run 持续监听并触发 handler，直到 stop 被关闭。
// handler 执行期间积压的事件会被全部丢弃（防止自身写入节点造成递归）。
func (r *Runner) Run(handler func(Event), stop <-chan struct{}) error {
	var pending *Event
	var triggeredAt time.Time

	for {
		select {
		case <-stop:
			return nil
		default:
		}

		timeout := -1
		if pending != nil {
			elapsed := time.Since(triggeredAt)
			if elapsed >= r.debounce {
				timeout = 0
			} else {
				timeout = int((r.debounce - elapsed).Milliseconds())
				if timeout < 0 {
					timeout = 0
				}
			}
		}

		if timeout != 0 {
			ready, woken, err := r.w.poll(timeout)
			if err != nil {
				return err
			}
			if woken {
				return nil
			}
			if ready {
				events, err := r.w.ReadEvents()
				if err != nil {
					r.debug("读取事件失败: %v", err)
					continue
				}
				for _, ev := range events {
					ev := ev
					pending = &ev
					triggeredAt = time.Now()
					r.debug("event: %s path: %s", ev.Letters, ev.Path)
				}
				continue
			}
		}

		if pending == nil {
			continue
		}

		ev := *pending
		pending = nil
		r.debug("debounce fired → handler: %s %s", ev.Letters, ev.Path)
		handler(ev)

		// 丢弃 handler 执行期间（亮度渐变写入）积压的全部事件
		drained := 0
		for {
			events, err := r.w.ReadEvents()
			if err != nil || len(events) == 0 {
				break
			}
			drained += len(events)
		}
		if drained > 0 {
			r.debug("drain: discarded %d event(s)", drained)
		}
	}
}

// Stop 唤醒 Run 使其退出（配合关闭 stop channel 使用）。
func (w *Watcher) Stop() { w.wake() }

// WatchFileModify 是给单文件（如 config.json）做变更监听的便捷封装。
func (w *Watcher) WatchFileModify(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	return w.Add(path, "cw")
}

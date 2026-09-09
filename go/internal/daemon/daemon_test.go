package daemon

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/YuleBest/LuminPro/go/internal/config"
	"github.com/YuleBest/LuminPro/go/internal/logging"
	"github.com/YuleBest/LuminPro/go/internal/system"
)

// scriptRunner 是可编程的命令假实现，用于注入 dumpsys/settings 输出。
type scriptRunner struct {
	mu      sync.Mutex
	outputs map[string]string
}

func (r *scriptRunner) Output(name string, args ...string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := name
	for _, a := range args {
		key += " " + a
	}
	if v, ok := r.outputs[key]; ok {
		return v, nil
	}
	return "", errors.New("no output")
}

func (r *scriptRunner) set(key, value string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.outputs[key] = value
}

type fixture struct {
	daemon *Daemon
	paths  Paths
	runner *scriptRunner
	node   string
	logs   string
}

func newFixture(t *testing.T, mutate func(*config.Config)) *fixture {
	t.Helper()
	dir := t.TempDir()
	paths := DefaultPaths(dir)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	node := filepath.Join(dir, "brightness")
	if err := os.WriteFile(node, []byte("1200"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Default()
	cfg.NowBriFile = node
	cfg.UIMaxBri = 1000
	cfg.MaxBri = 3000
	cfg.StepsNum = 5
	cfg.AutoBriSleep = 0
	cfg.DisplayHdrSleep = 0
	if mutate != nil {
		mutate(&cfg)
	}
	if err := cfg.Save(paths.ConfigFile); err != nil {
		t.Fatal(err)
	}

	runner := &scriptRunner{outputs: map[string]string{}}
	log := logging.New(paths.LogFile, logging.FilterInfo, 512)
	d, err := New(paths, Deps{
		AutoBrightness: system.AutoBrightness{Runner: runner},
		Focus:          system.Focus{Runner: runner},
		HDR:            system.HdrRatio{Runner: runner},
		Log:            log,
		Now:            func() time.Time { return time.Date(2026, 9, 10, 12, 0, 0, 0, time.Local) },
		StepDelay:      time.Millisecond,
		SettleDelay:    time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{daemon: d, paths: paths, runner: runner, node: node, logs: paths.LogFile}
}

func (f *fixture) nodeValue(t *testing.T) int {
	t.Helper()
	data, err := os.ReadFile(f.node)
	if err != nil {
		t.Fatal(err)
	}
	v, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatalf("节点内容不是整数: %q", string(data))
	}
	return v
}

func (f *fixture) logContent(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(f.logs)
	if err != nil {
		return ""
	}
	return string(data)
}

func TestEvaluateBoostsWhenAboveThreshold(t *testing.T) {
	f := newFixture(t, nil)
	f.daemon.evaluate()

	if got := f.nodeValue(t); got != 3000 {
		t.Fatalf("应提升到目标亮度 3000, 实际 %d", got)
	}
	logs := f.logContent(t)
	if !strings.Contains(logs, "触发提升") || !strings.Contains(logs, "亮度提升完成 (3000)") {
		t.Fatalf("日志缺少提升记录: %q", logs)
	}
	if _, err := os.Stat(f.paths.Oplock); err == nil {
		t.Fatal("提升结束后操作锁应被清除")
	}
}

func TestEvaluateSkipsBelowThreshold(t *testing.T) {
	f := newFixture(t, nil)
	if err := os.WriteFile(f.node, []byte("500"), 0o644); err != nil {
		t.Fatal(err)
	}
	f.daemon.evaluate()

	if got := f.nodeValue(t); got != 500 {
		t.Fatalf("低于阈值不应提升, 实际 %d", got)
	}
	if strings.Contains(f.logContent(t), "触发提升") {
		t.Fatal("不应记录提升日志")
	}
}

func TestEvaluateSkipsWhenUncalibrated(t *testing.T) {
	f := newFixture(t, func(c *config.Config) { c.MaxBri = 0 })
	f.daemon.evaluate()
	if got := f.nodeValue(t); got != 1200 {
		t.Fatalf("未校准时不应提升, 实际 %d", got)
	}
}

func TestEvaluateSkipsInSleepWindow(t *testing.T) {
	// 固定时间 12:00，休眠时段覆盖它
	f := newFixture(t, func(c *config.Config) { c.SleepTime = "0900-1700" })
	f.daemon.evaluate()
	if got := f.nodeValue(t); got != 1200 {
		t.Fatalf("休眠时段不应提升, 实际 %d", got)
	}
	if !strings.Contains(f.logContent(t), "处于休眠时段") {
		t.Fatal("应记录休眠时段日志")
	}
}

func TestEvaluateSkipsWhenAutoBrightnessOn(t *testing.T) {
	f := newFixture(t, func(c *config.Config) { c.AutoBriSleep = 1 })
	f.runner.set("settings get system screen_brightness_mode", "1\n")
	f.daemon.evaluate()
	if got := f.nodeValue(t); got != 1200 {
		t.Fatalf("自动亮度开启时不应提升, 实际 %d", got)
	}
	if !strings.Contains(f.logContent(t), "自动亮度已启用") {
		t.Fatal("应记录自动亮度日志")
	}
}

func TestEvaluateSkipsWhenBlacklisted(t *testing.T) {
	f := newFixture(t, func(c *config.Config) {
		c.BlacklistApps = []string{"com.video.app/.MainActivity"}
	})
	f.runner.set("dumpsys window", "  mCurrentFocus=Window{abc u0 com.video.app/.MainActivity}\n")
	f.daemon.evaluate()
	if got := f.nodeValue(t); got != 1200 {
		t.Fatalf("黑名单应用内不应提升, 实际 %d", got)
	}
	if !strings.Contains(f.logContent(t), "在黑名单中") {
		t.Fatal("应记录黑名单日志")
	}
}

func TestEvaluateHdrHysteresis(t *testing.T) {
	f := newFixture(t, func(c *config.Config) { c.DisplayHdrSleep = 1 })

	// 比率高于进入阈值：进入休眠，不提升
	f.runner.set("dumpsys display", "hdrSdrRatio 1.30\n")
	f.daemon.evaluate()
	if got := f.nodeValue(t); got != 1200 {
		t.Fatalf("HDR 内容时不应提升, 实际 %d", got)
	}
	if !strings.Contains(f.logContent(t), "进入休眠") {
		t.Fatal("应记录进入 HDR 休眠")
	}

	// 比率落到迟滞区间内：仍休眠
	f.runner.set("dumpsys display", "hdrSdrRatio 1.10\n")
	f.daemon.evaluate()
	if got := f.nodeValue(t); got != 1200 {
		t.Fatalf("迟滞区间内不应提升, 实际 %d", got)
	}

	// 比率降到退出阈值以下：解除休眠并提升
	f.runner.set("dumpsys display", "hdrSdrRatio 1.02\n")
	f.daemon.evaluate()
	if got := f.nodeValue(t); got != 3000 {
		t.Fatalf("解除休眠后应提升, 实际 %d", got)
	}
	if !strings.Contains(f.logContent(t), "HDR 休眠解除") {
		t.Fatal("应记录解除休眠")
	}
}

func TestEvaluateRespectsFlags(t *testing.T) {
	for _, flag := range []string{"stop.flag", "daemon.pause"} {
		t.Run(flag, func(t *testing.T) {
			f := newFixture(t, nil)
			if err := os.MkdirAll(f.paths.PIDDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(f.paths.PIDDir, flag), nil, 0o644); err != nil {
				t.Fatal(err)
			}
			f.daemon.evaluate()
			if got := f.nodeValue(t); got != 1200 {
				t.Fatalf("%s 存在时不应提升, 实际 %d", flag, got)
			}
		})
	}
}

func TestEvaluateWaitsForSettledValue(t *testing.T) {
	f := newFixture(t, nil)
	// 首次读取低于阈值，随后稳定：不应无限等待
	if err := os.WriteFile(f.node, []byte("500"), 0o644); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	f.daemon.evaluate()
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("值稳定后应提前退出，实际耗时 %v", elapsed)
	}
}

func TestBoostTogglesPeakAndRestore(t *testing.T) {
	f := newFixture(t, nil)

	if err := Boost(f.paths, nil); err != nil {
		t.Fatal(err)
	}
	if got := f.nodeValue(t); got != 3000 {
		t.Fatalf("一键提升应写入峰值 3000, 实际 %d", got)
	}
	if _, err := os.Stat(f.paths.BoostFlag); err != nil {
		t.Fatalf("应记录原亮度标记: %v", err)
	}
	if _, err := os.Stat(f.paths.Oplock); err == nil {
		t.Fatal("写入完成后应释放操作锁")
	}

	if err := Boost(f.paths, nil); err != nil {
		t.Fatal(err)
	}
	if got := f.nodeValue(t); got != 1200 {
		t.Fatalf("再次调用应恢复原亮度 1200, 实际 %d", got)
	}
	if _, err := os.Stat(f.paths.BoostFlag); err == nil {
		t.Fatal("恢复后应清除标记")
	}
}

func TestBoostRejectsUnconfiguredPeak(t *testing.T) {
	f := newFixture(t, func(c *config.Config) { c.MaxBri = 0 })
	if err := Boost(f.paths, nil); err == nil {
		t.Fatal("未配置峰值亮度应报错")
	}
}

func TestBoostRejectsMissingNode(t *testing.T) {
	f := newFixture(t, nil)
	if err := os.Remove(f.node); err != nil {
		t.Fatal(err)
	}
	if err := Boost(f.paths, nil); err == nil {
		t.Fatal("节点不存在应报错")
	}
}

func TestReadDaemonPID(t *testing.T) {
	dir := t.TempDir()
	pidFile := filepath.Join(dir, "inotifyd.pid")

	if _, alive := readDaemonPID(pidFile); alive {
		t.Fatal("文件不存在应视为未运行")
	}
	_ = os.WriteFile(pidFile, []byte("notanumber"), 0o644)
	if _, alive := readDaemonPID(pidFile); alive {
		t.Fatal("非法内容应视为未运行")
	}
	_ = os.WriteFile(pidFile, []byte("999999"), 0o644)
	if _, alive := readDaemonPID(pidFile); alive {
		t.Fatal("不存在的 PID 应视为未运行")
	}
	_ = os.WriteFile(pidFile, []byte(strconv.Itoa(os.Getpid())), 0o644)
	if pid, alive := readDaemonPID(pidFile); !alive || pid != os.Getpid() {
		t.Fatal("当前进程 PID 应视为存活")
	}
}

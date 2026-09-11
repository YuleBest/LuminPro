package api

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/YuleBest/LuminPro/go/internal/config"
	"github.com/YuleBest/LuminPro/go/internal/system"
)

// scriptRunner 是可编程的命令假实现。
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

func TestParseLogLine(t *testing.T) {
	cases := []struct {
		line string
		want LogEntry
	}{
		{
			"[09-10 12:34:56] [luminpro] [INFO] 触发提升",
			LogEntry{Time: "09-10 12:34:56", Tag: "luminpro", Level: "INFO", Message: "触发提升"},
		},
		{
			"[09-10 12:34:56] [luminpro] [SUCCESS] 亮度提升完成 (3000)",
			LogEntry{Time: "09-10 12:34:56", Tag: "luminpro", Level: "SUCCESS", Message: "亮度提升完成 (3000)"},
		},
		{
			"没有格式的一行",
			LogEntry{Message: "没有格式的一行"},
		},
	}
	for _, tc := range cases {
		if got := ParseLogLine(tc.line); got != tc.want {
			t.Errorf("ParseLogLine(%q) = %+v, 期望 %+v", tc.line, got, tc.want)
		}
	}
}

func TestTailLog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "service.log")
	content := "[09-10 12:00:00] [luminpro] [INFO] 第一条\n" +
		"[09-10 12:00:01] [luminpro] [WARN] 第二条\n" +
		"[09-10 12:00:02] [luminpro] [ERROR] 第三条\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	page, err := TailLog(path, 2, false)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 3 || len(page.Entries) != 2 {
		t.Fatalf("应取末 2 条（共 3 条）: total=%d len=%d", page.Total, len(page.Entries))
	}
	if page.Entries[0].Level != "WARN" || page.Entries[1].Message != "第三条" {
		t.Fatalf("条目内容不正确: %+v", page.Entries)
	}

	raw, err := TailLog(path, 1, true)
	if err != nil {
		t.Fatal(err)
	}
	if raw.Raw == "" || len(raw.Entries) != 0 {
		t.Fatalf("--raw 模式应只返回原文: %+v", raw)
	}

	missing, err := TailLog(filepath.Join(dir, "不存在.log"), 10, false)
	if err != nil || len(missing.Entries) != 0 {
		t.Fatalf("缺失文件应返回空页且不报错: %+v %v", missing, err)
	}
}

func TestClearAndExportLog(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "service.log")
	if err := os.WriteFile(src, []byte("data\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	outDir := filepath.Join(dir, "out")
	if err := os.Mkdir(outDir, 0o755); err != nil {
		t.Fatal(err)
	}

	path, err := ExportLog(src, outDir)
	if err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "data\n" {
		t.Fatalf("导出内容不正确: %q %v", string(data), err)
	}
	if _, err := ExportLog(src, filepath.Join(dir, "缺失目录")); err == nil {
		t.Fatal("导出目录不可用时应报错")
	}

	if err := ClearLog(src); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(src); len(data) != 0 {
		t.Fatalf("清空后应为空文件: %q", string(data))
	}
}

func TestOplockLifecycle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "oplock")

	if got := ReadOplock(path); got.Locked {
		t.Fatal("无锁文件应返回未锁定")
	}

	if err := WriteOplock(path, KindRamp); err != nil {
		t.Fatal(err)
	}
	got := ReadOplock(path)
	if !got.Locked || got.PID != os.Getpid() || got.Kind != KindRamp {
		t.Fatalf("锁状态不正确: %+v", got)
	}
	if got.Label != "正在调整亮度" {
		t.Fatalf("锁文案不正确: %q", got.Label)
	}

	RemoveOplock(path)
	if got := ReadOplock(path); got.Locked {
		t.Fatal("释放后应返回未锁定")
	}
}

// 遗留锁（持锁进程已死）应被就地清理。
func TestOplockSelfHeals(t *testing.T) {
	path := filepath.Join(t.TempDir(), "oplock")
	if err := os.WriteFile(path, []byte(`{"pid":999999,"kind":"ramp","startedAt":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ReadOplock(path); got.Locked {
		t.Fatal("进程已死的锁应视为未锁定")
	}
	if _, err := os.Stat(path); err == nil {
		t.Fatal("遗留锁文件应被清理")
	}
}

// 兼容旧版裸 PID 格式的锁文件。
func TestOplockLegacyFormat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "oplock")
	if err := os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ReadOplock(path)
	if !got.Locked || got.PID != os.Getpid() {
		t.Fatalf("旧格式应可识别: %+v", got)
	}

	if err := os.WriteFile(path, []byte("garbage"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ReadOplock(path); got.Locked {
		t.Fatal("无法解析的内容应视为未锁定")
	}
}

func TestChannelOf(t *testing.T) {
	cases := map[string]string{
		"V2.5.0":        "stable",
		"V2.5.0-beta.1": "beta",
		"V2.5.0-Beta.2": "beta",
		"V2.5.0-dev.3":  "dev",
		"V2.4-2401":     "stable",
	}
	for version, want := range cases {
		if got := ChannelOf(version); got != want {
			t.Errorf("ChannelOf(%q) = %q, 期望 %q", version, got, want)
		}
	}
}

func TestReadModuleInfo(t *testing.T) {
	dir := t.TempDir()
	prop := "id=LuminPro\nname=LuminPro丨测试\nversion=V2.5.0-beta.2\nversionCode=2050052\n"
	if err := os.WriteFile(filepath.Join(dir, "module.prop"), []byte(prop), 0o644); err != nil {
		t.Fatal(err)
	}
	info := ReadModuleInfo(dir)
	if info.ID != "LuminPro" || info.Version != "V2.5.0-beta.2" || info.VersionCode != 2050052 || info.Channel != "beta" {
		t.Fatalf("module.prop 解析不正确: %+v", info)
	}
	// 缺失文件时回退默认值
	if info := ReadModuleInfo(filepath.Join(dir, "不存在")); info.Channel != "stable" {
		t.Fatalf("缺失 module.prop 应回退 stable: %+v", info)
	}
}

// fixedNow 是状态聚合测试的基准时间：运行时长等字段依赖「当前时间」，
// 必须与写入 state 的 startedAt 用同一基准，否则测试会随执行时机漂移。
var fixedNow = time.Date(2026, 9, 10, 12, 0, 0, 0, time.Local)

func TestBuildStatus(t *testing.T) {
	dir := t.TempDir()
	paths := DefaultPaths(dir)
	if err := os.MkdirAll(paths.PIDDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}

	node := filepath.Join(dir, "brightness")
	maxNode := filepath.Join(dir, "max_brightness")
	if err := os.WriteFile(node, []byte("1200"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(maxNode, []byte("4000"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Default()
	cfg.NowBriFile = node
	cfg.MaxBriFile = maxNode
	cfg.UIMaxBri = 1000
	cfg.MaxBri = 3000
	cfg.SleepTime = "2300-0700"
	cfg.BlacklistApps = []string{"com.a"}
	if err := cfg.Save(paths.ConfigFile); err != nil {
		t.Fatal(err)
	}

	// daemon 状态
	if err := os.WriteFile(paths.PIDFile, []byte(strconv.Itoa(os.Getpid())), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteState(paths.StateFile, DaemonState{
		PID:       os.Getpid(),
		StartedAt: fixedNow.Add(-90 * time.Second).Unix(),
		Mode:      "event",
		Ratio:     &RatioInfo{Value: 1.08, At: fixedNow.Unix()},
		HdrSleep:  true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := WriteOplock(paths.Oplock, KindRamp); err != nil {
		t.Fatal(err)
	}

	runner := &scriptRunner{outputs: map[string]string{
		"settings get system screen_brightness_mode": "1\n",
		"dumpsys display": "hdrSdrRatio 1.02\n",
	}}
	status := BuildStatus(paths, cfg, StatusDeps{
		AutoBrightness: system.AutoBrightness{Runner: runner},
		HDR:            system.HdrRatio{Runner: runner},
		Now:            func() time.Time { return fixedNow },
	}, StatusOptions{IncludeDisplay: true})

	if status.Module.Version != "" && status.Module.Channel != "stable" {
		t.Fatalf("模块信息不正确: %+v", status.Module)
	}
	if !status.Daemon.Running || status.Daemon.PID != os.Getpid() || status.Daemon.Mode != "event" {
		t.Fatalf("daemon 状态不正确: %+v", status.Daemon)
	}
	if status.Daemon.UptimeSec < 80 {
		t.Fatalf("运行时长计算不正确: %d", status.Daemon.UptimeSec)
	}
	if status.Brightness.Current != 1200 || status.Brightness.Max != 4000 || status.Brightness.Percent != 30 {
		t.Fatalf("亮度信息不正确: %+v", status.Brightness)
	}
	if status.Sleep.Window != "2300-0700" || status.Sleep.Active {
		t.Fatalf("休眠状态不正确: %+v", status.Sleep)
	}
	if !status.Oplock.Locked || status.Oplock.Kind != KindRamp {
		t.Fatalf("操作锁不正确: %+v", status.Oplock)
	}
	if status.Config.UIMaxBri != 1000 || status.Config.BlacklistCount != 1 {
		t.Fatalf("配置摘要不正确: %+v", status.Config)
	}
	if status.Display == nil || status.Display.HdrRatio != 1.02 || !status.Display.HdrKnown || !status.Display.AutoBrightness || !status.Display.HdrSleep {
		t.Fatalf("显示信息不正确: %+v", status.Display)
	}

	// --no-display：不调用 dumpsys/settings，改用 daemon 缓存
	light := BuildStatus(paths, cfg, StatusDeps{
		AutoBrightness: system.AutoBrightness{Runner: runner},
		HDR:            system.HdrRatio{Runner: runner},
	}, StatusOptions{IncludeDisplay: false})
	if light.Display != nil {
		t.Fatalf("--no-display 不应包含显示信息: %+v", light.Display)
	}

	// JSON 可序列化
	if _, err := json.Marshal(light); err != nil {
		t.Fatalf("状态无法序列化: %v", err)
	}
}

// dumpsys 读取失败时回退到 daemon 缓存并标记 stale。
func TestBuildStatusFallsBackToCachedRatio(t *testing.T) {
	dir := t.TempDir()
	paths := DefaultPaths(dir)
	if err := os.MkdirAll(paths.PIDDir, 0o755); err != nil {
		t.Fatal(err)
	}
	node := filepath.Join(dir, "brightness")
	if err := os.WriteFile(node, []byte("500"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := config.Default()
	cfg.NowBriFile = node
	if err := cfg.Save(paths.ConfigFile); err != nil {
		t.Fatal(err)
	}
	if err := WriteState(paths.StateFile, DaemonState{
		PID:   os.Getpid(),
		Ratio: &RatioInfo{Value: 1.30, At: time.Now().Unix()},
	}); err != nil {
		t.Fatal(err)
	}

	runner := &scriptRunner{outputs: map[string]string{}} // 全部失败
	status := BuildStatus(paths, cfg, StatusDeps{
		AutoBrightness: system.AutoBrightness{Runner: runner},
		HDR:            system.HdrRatio{Runner: runner},
	}, StatusOptions{IncludeDisplay: true})

	if status.Display == nil || !status.Display.HdrKnown || !status.Display.HdrStale || status.Display.HdrRatio != 1.30 {
		t.Fatalf("应回退到缓存的比率并标记 stale: %+v", status.Display)
	}
}

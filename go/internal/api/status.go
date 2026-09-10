package api

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/YuleBest/LuminPro/go/internal/config"
	"github.com/YuleBest/LuminPro/go/internal/policy"
	"github.com/YuleBest/LuminPro/go/internal/system"
)

// ModuleInfo 来自 module.prop。
type ModuleInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	VersionCode int    `json:"versionCode"`
	Channel     string `json:"channel"`
}

// ReadModuleInfo 解析模块根目录下的 module.prop，并从版本号推导发布通道。
func ReadModuleInfo(moduleDir string) ModuleInfo {
	info := ModuleInfo{ID: "LuminPro", Channel: "stable"}
	f, err := os.Open(moduleDir + "/module.prop")
	if err != nil {
		return info
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "id":
			info.ID = value
		case "name":
			info.Name = value
		case "version":
			info.Version = value
		case "versionCode":
			if n, err := strconv.Atoi(value); err == nil {
				info.VersionCode = n
			}
		}
	}
	info.Channel = ChannelOf(info.Version)
	return info
}

// ChannelOf 依据版本号判断发布通道。
func ChannelOf(version string) string {
	v := strings.ToLower(version)
	switch {
	case strings.Contains(v, "-beta"):
		return "beta"
	case strings.Contains(v, "-dev"):
		return "dev"
	default:
		return "stable"
	}
}

// DaemonPart 是守护进程状态。
type DaemonPart struct {
	PID       int    `json:"pid"`
	Running   bool   `json:"running"`
	State     string `json:"state"`
	Mode      string `json:"mode"`
	Paused    bool   `json:"paused"`
	UptimeSec int    `json:"uptimeSec"`
}

// BrightnessPart 是亮度信息。
type BrightnessPart struct {
	Current int    `json:"current"`
	Max     int    `json:"max"`
	Percent int    `json:"percent"`
	Node    string `json:"node"`
	MaxNode string `json:"maxNode"`
	Error   string `json:"error,omitempty"`
}

// DisplayPart 是屏幕相关状态（需要 dumpsys / settings）。
type DisplayPart struct {
	HdrRatio       float64 `json:"hdrRatio"`
	HdrKnown       bool    `json:"hdrKnown"`
	HdrStale       bool    `json:"hdrStale"`
	HdrSleep       bool    `json:"hdrSleep"`
	AutoBrightness bool    `json:"autoBrightness"`
}

// SleepPart 是休眠时段状态。
type SleepPart struct {
	Window string `json:"window"`
	Active bool   `json:"active"`
}

// ConfigPart 是前端展示需要的配置子集。
type ConfigPart struct {
	UIMaxBri          int     `json:"uiMaxBri"`
	MaxBri            int     `json:"maxBri"`
	StepsNum          int     `json:"stepsNum"`
	SleepTime         string  `json:"sleepTime"`
	AutoBriSleep      int     `json:"autoBriSleep"`
	DisplayHdrSleep   int     `json:"displayHdrSleep"`
	HdrEnterRatio     float64 `json:"hdrEnterRatio"`
	HdrExitRatio      float64 `json:"hdrExitRatio"`
	CompatibilityMode int     `json:"compatibilityMode"`
	LogLevel          string  `json:"logLevel"`
	LogMaxSize        int     `json:"logMaxSize"`
	DebugMode         int     `json:"debugMode"`
	NowBriFile        string  `json:"nowBriFile"`
	MaxBriFile        string  `json:"maxBriFile"`
	BlacklistCount    int     `json:"blacklistCount"`
}

// LogPart 是日志文件信息。
type LogPart struct {
	Path   string `json:"path"`
	SizeKB int    `json:"sizeKB"`
}

// Status 是 status 子命令的输出。
type Status struct {
	Module     ModuleInfo     `json:"module"`
	Daemon     DaemonPart     `json:"daemon"`
	Brightness BrightnessPart `json:"brightness"`
	Display    *DisplayPart   `json:"display,omitempty"`
	Sleep      SleepPart      `json:"sleep"`
	Oplock     OplockStatus   `json:"oplock"`
	Config     ConfigPart     `json:"config"`
	Log        LogPart        `json:"log"`
}

// StatusDeps 是状态聚合用到的系统调用（测试可注入）。
type StatusDeps struct {
	AutoBrightness system.AutoBrightness
	HDR            system.HdrRatio
	Now            func() time.Time
}

// StatusOptions 控制是否读取需要系统调用的字段。
type StatusOptions struct {
	// IncludeDisplay=false 时跳过 dumpsys/settings，仅用 daemon 缓存的数值，
	// 供前端高频刷新（例如操作锁轮询）使用。
	IncludeDisplay bool
}

// BuildStatus 聚合一次完整状态。
func BuildStatus(p Paths, cfg config.Config, deps StatusDeps, opts StatusOptions) Status {
	now := deps.Now
	if now == nil {
		now = time.Now
	}

	st := Status{
		Module: ReadModuleInfo(p.ModuleDir),
		Oplock: ReadOplock(p.Oplock),
		Sleep: SleepPart{
			Window: cfg.SleepTime,
			Active: policy.InSleepWindow(cfg.SleepTime, now()),
		},
		Config: ConfigPart{
			UIMaxBri:          cfg.UIMaxBri,
			MaxBri:            cfg.MaxBri,
			StepsNum:          cfg.StepsNum,
			SleepTime:         cfg.SleepTime,
			AutoBriSleep:      cfg.AutoBriSleep,
			DisplayHdrSleep:   cfg.DisplayHdrSleep,
			HdrEnterRatio:     cfg.HdrEnterRatio,
			HdrExitRatio:      cfg.HdrExitRatio,
			CompatibilityMode: cfg.CompatibilityMode,
			LogLevel:          cfg.LogLevel,
			LogMaxSize:        cfg.LogMaxSize,
			DebugMode:         cfg.DebugMode,
			NowBriFile:        cfg.NowBriFile,
			MaxBriFile:        cfg.MaxBriFile,
			BlacklistCount:    len(cfg.BlacklistApps),
		},
	}

	// 守护进程
	daemonState, hasState := ReadState(p.StateFile)
	if pid, alive := DaemonPID(p.PIDFile); alive {
		st.Daemon = DaemonPart{
			PID:     pid,
			Running: true,
			State:   ProcessState(pid),
		}
		if hasState {
			st.Daemon.Mode = daemonState.Mode
			if daemonState.StartedAt > 0 {
				if d := now().Unix() - daemonState.StartedAt; d > 0 {
					st.Daemon.UptimeSec = int(d)
				}
			}
		}
	}
	st.Daemon.Paused = FileExists(p.StopFlag)

	// 亮度节点
	st.Brightness = BrightnessPart{Node: cfg.NowBriFile, MaxNode: cfg.MaxBriFile}
	current, err := readIntFile(cfg.NowBriFile)
	if err != nil {
		st.Brightness.Error = err.Error()
	}
	maxBri, err := readIntFile(cfg.MaxBriFile)
	if err != nil && st.Brightness.Error == "" {
		st.Brightness.Error = err.Error()
	}
	st.Brightness.Current = current
	st.Brightness.Max = maxBri
	if maxBri > 0 {
		st.Brightness.Percent = current * 100 / maxBri
	}

	// 日志
	st.Log = LogPart{Path: p.LogFile}
	if fi, err := os.Stat(p.LogFile); err == nil {
		st.Log.SizeKB = int(fi.Size() / 1024)
	}

	if !opts.IncludeDisplay {
		return st
	}

	display := &DisplayPart{}
	if deps.HDR.Runner != nil {
		if ratio, ok := deps.HDR.Ratio(); ok {
			display.HdrRatio = ratio
			display.HdrKnown = true
		} else if hasState && daemonState.Ratio != nil {
			display.HdrRatio = daemonState.Ratio.Value
			display.HdrKnown = true
			display.HdrStale = true
		}
	}
	if deps.AutoBrightness.Runner != nil {
		display.AutoBrightness = deps.AutoBrightness.Enabled()
	} else if hasState && daemonState.AutoBrightness != nil {
		display.AutoBrightness = daemonState.AutoBrightness.Value
	}
	display.HdrSleep = hasState && daemonState.HdrSleep
	st.Display = display
	return st
}

func readIntFile(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	text := strings.TrimSpace(string(data))
	v, err := strconv.Atoi(text)
	if err != nil {
		return 0, fmt.Errorf("节点内容不是整数: %q", text)
	}
	return v, nil
}

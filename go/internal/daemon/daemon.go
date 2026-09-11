// Package daemon 实现常驻守护进程，以及 boost / restart 一次性操作。
//
// 它取代旧的 service.sh + daemon.sh + up.sh + lumipro 四层结构：
// 单进程内完成监听、判定、渐变写入与状态文件维护。
package daemon

import (
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/YuleBest/LuminPro/go/internal/api"
	"github.com/YuleBest/LuminPro/go/internal/brightness"
	"github.com/YuleBest/LuminPro/go/internal/config"
	"github.com/YuleBest/LuminPro/go/internal/inotify"
	"github.com/YuleBest/LuminPro/go/internal/logging"
	"github.com/YuleBest/LuminPro/go/internal/policy"
	"github.com/YuleBest/LuminPro/go/internal/system"
)

// Paths 是模块内的文件布局（与 WebUI 的契约，不可随意改名）。
type Paths = api.Paths

// DefaultPaths 按模块目录推导全部路径。
func DefaultPaths(moduleDir string) Paths { return api.DefaultPaths(moduleDir) }

// Deps 是守护进程的外部依赖，测试时可注入假实现。
type Deps struct {
	AutoBrightness system.AutoBrightness
	Focus          system.Focus
	HDR            system.HdrRatio
	Log            *logging.Logger
	Now            func() time.Time

	StepDelay      time.Duration // 渐变每步间隔，默认 20ms
	Debounce       time.Duration // 事件防抖窗口，默认 300ms
	CompatInterval time.Duration // 兼容模式轮询间隔，默认 2s
	NodeRetry      time.Duration // 节点缺失重试间隔，默认 10s
	SettleDelay    time.Duration // 等待亮度值落定的间隔，默认 300ms
}

func (d *Deps) withDefaults() {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.StepDelay <= 0 {
		d.StepDelay = 20 * time.Millisecond
	}
	if d.Debounce <= 0 {
		d.Debounce = 300 * time.Millisecond
	}
	if d.CompatInterval <= 0 {
		d.CompatInterval = 2 * time.Second
	}
	if d.NodeRetry <= 0 {
		d.NodeRetry = 10 * time.Second
	}
	if d.SettleDelay <= 0 {
		d.SettleDelay = 300 * time.Millisecond
	}
}

// Daemon 是守护进程。
type Daemon struct {
	paths Paths
	deps  Deps

	mu                sync.RWMutex
	cfg               config.Config
	hdr               policy.HdrState
	ratioCache        float64
	haveRatioCache    bool
	nodeMissingLogged bool

	// 运行状态（供 WebUI 的 status 读取，避免前端反复调用 dumpsys）
	stateMu sync.Mutex
	state   api.DaemonState
}

// New 创建守护进程并加载初始配置。
func New(paths Paths, deps Deps) (*Daemon, error) {
	deps.withDefaults()
	d := &Daemon{
		paths: paths,
		deps:  deps,
		state: api.DaemonState{
			PID:       os.Getpid(),
			StartedAt: time.Now().Unix(),
			Mode:      "event",
		},
	}
	cfg, err := config.Load(paths.ConfigFile)
	if err != nil {
		return nil, err
	}
	d.setConfig(cfg)
	d.state.Node = cfg.NowBriFile
	return d, nil
}

type exitReason int

const (
	reasonReload exitReason = iota
	reasonExit
	reasonError
)

// Run 启动主循环，直到收到退出信号。
func (d *Daemon) Run() error {
	if err := os.MkdirAll(d.paths.PIDDir, 0o755); err != nil {
		return err
	}
	if err := d.writePID(); err != nil {
		return err
	}
	defer d.cleanup()

	d.log().Info("守护进程已启动")
	d.flushState()

	sigCh := make(chan os.Signal, 4)
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGINT)
	defer signal.Stop(sigCh)

	cfgCh := make(chan struct{}, 1)
	stopCfgPoll := d.pollConfig(cfgCh)
	defer stopCfgPoll()

	for {
		node := d.currentConfig().NowBriFile
		if _, err := os.Stat(node); err != nil {
			d.logNodeMissing(node)
			select {
			case <-time.After(d.deps.NodeRetry):
				d.reloadConfig()
				continue
			case sig := <-sigCh:
				if d.handleSignal(sig) {
					return nil
				}
				d.reloadConfig()
				continue
			case <-cfgCh:
				d.reloadConfig()
				continue
			}
		}
		if d.nodeMissingLogged {
			d.log().Info("亮度节点已就绪: " + node)
			d.nodeMissingLogged = false
		}

		reason := d.serve(sigCh, cfgCh)
		switch reason {
		case reasonExit:
			return nil
		case reasonError:
			select {
			case <-time.After(time.Second):
			case sig := <-sigCh:
				if d.handleSignal(sig) {
					return nil
				}
			}
		}
		d.reloadConfig()
		// 重写 PID 文件，作为「监听已重建」的就绪标记（restart 子命令据此等待）
		if err := d.writePID(); err != nil {
			d.log().Warn("重写 PID 文件失败: " + err.Error())
		}
	}
}

// serve 运行监听循环，直到配置变更/信号/监听失效。
func (d *Daemon) serve(sigCh chan os.Signal, cfgCh chan struct{}) exitReason {
	stop := make(chan struct{})
	defer close(stop)

	// 事件模式下，节点被删除或监听失效时通过该通道请求重建
	rebuild := make(chan struct{}, 1)
	cfg := d.currentConfig()

	if cfg.CompatibilityMode == 1 {
		d.log().Warn("兼容模式已开启 (轮询驱动)")
		d.setStateMode("polling")
		go d.compatLoop(stop)
	} else {
		d.setStateMode("event")
		w, err := inotify.New()
		if err != nil {
			d.log().Error("初始化 inotify 失败: " + err.Error())
			return reasonError
		}
		defer w.Close()

		if err := w.Add(cfg.NowBriFile, cfg.InotifyEvents); err != nil {
			d.log().Error("监听亮度节点失败: " + err.Error())
			return reasonError
		}
		d.log().Info(fmt.Sprintf("正在监听: %s, 事件: %s", cfg.NowBriFile, cfg.InotifyEvents))

		runStop := make(chan struct{})
		go func() {
			_ = w.NewRunner(d.deps.Debounce, d.debugf).Run(func(ev inotify.Event) {
				// 节点被删除 (D) / 监听失效 (x) / 被移动 (M)：交给外层循环重建
				if strings.ContainsAny(ev.Letters, "xDM") {
					select {
					case rebuild <- struct{}{}:
					default:
					}
					return
				}
				d.recordEvent(ev.Letters)
				d.evaluate()
			}, runStop)
		}()
		defer func() {
			close(runStop)
			w.Stop()
		}()
	}

	for {
		select {
		case sig := <-sigCh:
			if d.handleSignal(sig) {
				return reasonExit
			}
			d.log().Info("收到重载信号，重建监听")
			return reasonReload
		case <-cfgCh:
			d.log().Info("检测到配置变更，重新加载")
			return reasonReload
		case <-rebuild:
			d.log().Warn("亮度节点监听失效，重建监听")
			return reasonReload
		}
	}
}

// compatLoop 兼容模式：定期轮询执行判定。
func (d *Daemon) compatLoop(stop <-chan struct{}) {
	ticker := time.NewTicker(d.deps.CompatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			d.log().Info("轮询模式已退出")
			return
		case <-ticker.C:
			d.evaluate()
		}
	}
}

// evaluate 执行一次完整判定；满足条件时执行亮度提升。
func (d *Daemon) evaluate() {
	defer d.flushState()

	// 服务暂停 / 守护进程挂起：静默跳过（与旧脚本一致）
	if api.FileExists(d.paths.StopFlag) || api.FileExists(d.paths.PauseFlag) {
		d.setStatePaused(api.FileExists(d.paths.StopFlag))
		return
	}
	d.setStatePaused(false)

	cfg := d.currentConfig()
	if cfg.UIMaxBri <= 0 || cfg.MaxBri <= 0 {
		return // 未校准，等价于旧脚本的 `now >= 0 && now < 0`
	}
	if !api.FileExists(cfg.NowBriFile) {
		return // 节点缺失由外层循环负责记录与重试，这里静默
	}

	if policy.InSleepWindow(cfg.SleepTime, d.deps.Now()) {
		d.log().Info(fmt.Sprintf("处于休眠时段 (%s)，跳过提升", cfg.SleepTime))
		return
	}
	if cfg.AutoBriSleep == 1 {
		autoBri := d.deps.AutoBrightness.Enabled()
		d.setStateAutoBrightness(autoBri)
		if autoBri {
			d.log().Info("自动亮度已启用，跳过提升")
			return
		}
	}
	if len(cfg.BlacklistApps) > 0 {
		focus := d.deps.Focus.CurrentFocus()
		if policy.BlacklistMatch(cfg.BlacklistApps, focus) {
			d.log().Info(fmt.Sprintf("当前前台 (%s) 在黑名单中，跳过提升", focus))
			return
		}
	}
	if cfg.DisplayHdrSleep == 1 && !d.evaluateHdr(cfg) {
		return
	}

	d.boost(cfg)
}

// evaluateHdr 推进 HDR 迟滞状态机，返回是否可以继续提升。
func (d *Daemon) evaluateHdr(cfg config.Config) bool {
	ratio, ok := d.deps.HDR.Ratio()
	if !ok && d.haveRatioCache {
		ratio, ok = d.ratioCache, true
		d.log().Info(fmt.Sprintf("HDR 比率读取为空，使用缓存值: %.2f", ratio))
	}
	if ok {
		d.ratioCache, d.haveRatioCache = ratio, true
		d.setStateRatio(ratio)
	}

	decision := d.hdr.Evaluate(ratio, ok, cfg.HdrEnterRatio, cfg.HdrExitRatio)
	switch {
	case decision.Entered:
		d.log().Info(fmt.Sprintf("检测到 HDR 内容 (比率: %.2f ≥ 进入阈值 %.2f)，进入休眠", ratio, cfg.HdrEnterRatio))
	case decision.Exited:
		d.log().Info(fmt.Sprintf("HDR 休眠解除 (比率: %.2f ≤ 退出阈值 %.2f)", ratio, cfg.HdrExitRatio))
	case decision.Skip:
		d.log().Info("HDR 休眠中，跳过提升")
	}
	d.setStateHdrSleep(d.hdr.InSleep())
	return !decision.Skip
}

// boost 读取当前亮度并在满足阈值时执行渐变。
//
// 与旧 CHECK_BRI 一致：最多 10 次、间隔 0.3s 等待亮度值落定；
// 额外优化为「读数稳定且不满足条件时提前退出」，避免无谓占用事件循环。
func (d *Daemon) boost(cfg config.Config) {
	prev := -1
	for i := 0; i < 10; i++ {
		now, err := brightness.ReadInt(cfg.NowBriFile)
		if err != nil {
			d.log().Error("读取亮度节点失败: " + err.Error())
			return
		}
		d.setStateBrightness(now)
		if policy.ShouldBoost(now, cfg.UIMaxBri, cfg.MaxBri) {
			d.log().Info(fmt.Sprintf("触发提升: 当前亮度 %d ≥ 阈值 %d，目标 %d", now, cfg.UIMaxBri, cfg.MaxBri))
			if err := d.ramp(cfg, now); err != nil {
				d.log().Error("亮度提升失败: " + err.Error())
				return
			}
			d.log().Success(fmt.Sprintf("亮度提升完成 (%d)", cfg.MaxBri))
			return
		}
		if prev == now {
			return
		}
		prev = now
		time.Sleep(d.deps.SettleDelay)
	}
}

// ramp 执行渐变写入，期间持操作锁。
func (d *Daemon) ramp(cfg config.Config, start int) error {
	d.log().Info(fmt.Sprintf("开始渐变调整: %d → %d (%d 步)", start, cfg.MaxBri, cfg.StepsNum))
	if err := api.WriteOplock(d.paths.Oplock, api.KindRamp); err != nil {
		d.log().Warn("写入操作锁失败: " + err.Error())
	}
	defer api.RemoveOplock(d.paths.Oplock)

	err := brightness.Ramp(cfg.NowBriFile, start, cfg.MaxBri, cfg.StepsNum, d.deps.StepDelay, nil)
	d.setStateAction(api.KindRamp, start, cfg.MaxBri)
	d.setStateBrightness(cfg.MaxBri)
	return err
}

// pollConfig 定期比对 config.json 的 mtime/大小，变更时通知主循环。
// 用轮询而非 inotify：配置写入可能使用「临时文件 + rename」，会打断对旧 inode 的监听。
func (d *Daemon) pollConfig(cfgCh chan struct{}) func() {
	stop := make(chan struct{})
	go func() {
		var lastMod time.Time
		var lastSize int64
		if fi, err := os.Stat(d.paths.ConfigFile); err == nil {
			lastMod, lastSize = fi.ModTime(), fi.Size()
		}
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				fi, err := os.Stat(d.paths.ConfigFile)
				if err != nil {
					continue
				}
				if fi.ModTime() != lastMod || fi.Size() != lastSize {
					lastMod, lastSize = fi.ModTime(), fi.Size()
					select {
					case cfgCh <- struct{}{}:
					default:
					}
				}
			}
		}
	}()
	return func() { close(stop) }
}

func (d *Daemon) handleSignal(sig os.Signal) bool {
	if sig == syscall.SIGHUP {
		return false
	}
	d.log().Info("收到退出信号，停止守护进程")
	return true
}

func (d *Daemon) reloadConfig() {
	cfg, err := config.Load(d.paths.ConfigFile)
	if err != nil {
		d.log().Error("加载配置失败: " + err.Error())
		return
	}
	d.setConfig(cfg)
	d.log().Info("配置已重新加载")
}

func (d *Daemon) setConfig(cfg config.Config) {
	d.mu.Lock()
	d.cfg = cfg
	d.mu.Unlock()

	if d.deps.Log != nil {
		d.deps.Log.SetLevel(cfg.LogLevel)
		d.deps.Log.SetMaxSizeKB(cfg.LogMaxSize)
		d.deps.Log.SetDebug(cfg.DebugMode == 1)
	}
}

func (d *Daemon) currentConfig() config.Config {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.cfg
}

func (d *Daemon) logNodeMissing(node string) {
	if d.nodeMissingLogged {
		return
	}
	d.log().Error("亮度节点不存在: " + node + "，功能挂起，每 10 秒重试")
	d.nodeMissingLogged = true
}

func (d *Daemon) log() *logging.Logger {
	return d.deps.Log
}

func (d *Daemon) debugf(format string, args ...any) {
	if d.deps.Log != nil {
		d.deps.Log.Debug(format, args...)
	}
}

func (d *Daemon) writePID() error {
	if err := os.MkdirAll(d.paths.PIDDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(d.paths.PIDFile, []byte(strconv.Itoa(os.Getpid())), 0o644)
}

func (d *Daemon) cleanup() {
	_ = os.Remove(d.paths.PIDFile)
	_ = os.Remove(d.paths.Oplock)
	_ = os.Remove(d.paths.StateFile)
}

// ── 运行状态维护（供 WebUI 的 status 子命令读取）────────────────────────────

func (d *Daemon) updateState(fn func(s *api.DaemonState)) {
	d.stateMu.Lock()
	defer d.stateMu.Unlock()
	fn(&d.state)
}

func (d *Daemon) flushState() {
	d.stateMu.Lock()
	snapshot := d.state
	d.stateMu.Unlock()
	if err := api.WriteState(d.paths.StateFile, snapshot); err != nil {
		d.log().Warn("写入运行状态失败: " + err.Error())
	}
}

func (d *Daemon) recordEvent(letters string) {
	now := time.Now().Unix()
	d.updateState(func(s *api.DaemonState) {
		s.LastEvent = &api.EventInfo{Letters: letters, At: now}
	})
}

func (d *Daemon) setStateMode(mode string) {
	d.updateState(func(s *api.DaemonState) { s.Mode = mode })
	d.flushState()
}

func (d *Daemon) setStatePaused(paused bool) {
	d.updateState(func(s *api.DaemonState) { s.Paused = paused })
}

func (d *Daemon) setStateRatio(ratio float64) {
	now := time.Now().Unix()
	d.updateState(func(s *api.DaemonState) {
		s.Ratio = &api.RatioInfo{Value: ratio, At: now}
	})
}

func (d *Daemon) setStateAutoBrightness(on bool) {
	now := time.Now().Unix()
	d.updateState(func(s *api.DaemonState) {
		s.AutoBrightness = &api.BoolInfo{Value: on, At: now}
	})
}

func (d *Daemon) setStateHdrSleep(asleep bool) {
	d.updateState(func(s *api.DaemonState) { s.HdrSleep = asleep })
}

func (d *Daemon) setStateBrightness(value int) {
	now := time.Now().Unix()
	d.updateState(func(s *api.DaemonState) {
		s.Brightness = &api.IntInfo{Value: value, At: now}
	})
}

func (d *Daemon) setStateAction(kind string, from, to int) {
	now := time.Now().Unix()
	d.updateState(func(s *api.DaemonState) {
		s.LastAction = &api.ActionInfo{Kind: kind, From: from, To: to, At: now}
	})
}

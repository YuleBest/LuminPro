package daemon

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/YuleBest/LuminPro/go/internal/brightness"
	"github.com/YuleBest/LuminPro/go/internal/config"
	"github.com/YuleBest/LuminPro/go/internal/logging"
)

// Boost 一键提升至峰值亮度；再次调用恢复原亮度（取代 boost.sh）。
func Boost(paths Paths, log *logging.Logger) error {
	cfg, err := config.Load(paths.ConfigFile)
	if err != nil {
		return err
	}
	if !fileExists(cfg.NowBriFile) {
		return fmt.Errorf("亮度节点不存在: %s", cfg.NowBriFile)
	}

	// 已提升过：恢复并清除标记
	if data, err := os.ReadFile(paths.BoostFlag); err == nil {
		restore := strings.TrimSpace(string(data))
		if restore != "" {
			if v, err := strconv.Atoi(restore); err == nil {
				writeWithOplock(paths, log, cfg.NowBriFile, v)
			}
		}
		_ = os.Remove(paths.BoostFlag)
		return nil
	}

	if cfg.MaxBri <= 0 {
		return errors.New("峰值亮度未配置，无法一键提升")
	}
	now, err := brightness.ReadInt(cfg.NowBriFile)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(paths.PIDDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(paths.BoostFlag, []byte(strconv.Itoa(now)), 0o644); err != nil {
		return err
	}
	writeWithOplock(paths, log, cfg.NowBriFile, cfg.MaxBri)
	return nil
}

// writeWithOplock 在持操作锁的前提下写一次亮度节点。
func writeWithOplock(paths Paths, log *logging.Logger, node string, value int) {
	_ = os.MkdirAll(paths.PIDDir, 0o755)
	if err := os.WriteFile(paths.Oplock, []byte(strconv.Itoa(os.Getpid())), 0o644); err != nil && log != nil {
		log.Warn("写入操作锁失败: " + err.Error())
	}
	defer func() { _ = os.Remove(paths.Oplock) }()
	if err := brightness.WriteInt(node, value); err != nil && log != nil {
		log.Error("写入亮度节点失败: " + err.Error())
	}
}

// Restart 实现「重启模块」：daemon 在跑就发 SIGHUP 让它重建监听，
// 没跑就检查亮度节点后拉起一个新 daemon（取代 script/restart.sh）。
func Restart(paths Paths, selfPath string, log *logging.Logger) error {
	if err := os.MkdirAll(paths.PIDDir, 0o755); err != nil {
		return err
	}
	// 整个重启窗口持操作锁，WebUI 会据此暂停刷新
	if err := os.WriteFile(paths.Oplock, []byte(strconv.Itoa(os.Getpid())), 0o644); err != nil {
		return err
	}
	defer func() { _ = os.Remove(paths.Oplock) }()

	if pid, alive := readDaemonPID(paths.PIDFile); alive {
		start := time.Now()
		if err := syscall.Kill(pid, syscall.SIGHUP); err != nil {
			return fmt.Errorf("通知守护进程失败: %w", err)
		}
		// daemon 重建监听后会重写 PID 文件，以其 mtime 变化作为就绪信号
		waitForPIDRewrite(paths.PIDFile, start, 3*time.Second)
		return nil
	}

	cfg, err := config.Load(paths.ConfigFile)
	if err != nil {
		return err
	}
	if !fileExists(cfg.NowBriFile) {
		return fmt.Errorf("亮度节点不存在: %s，无法启动服务，请先在配置页填写正确路径", cfg.NowBriFile)
	}

	cmd := exec.Command(selfPath, "daemon")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动守护进程失败: %w", err)
	}
	return cmd.Process.Release()
}

// readDaemonPID 读取 PID 文件并确认进程存活（/proc 检测，等价于旧脚本的 [ -d /proc/$pid ]）。
func readDaemonPID(pidFile string) (int, bool) {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	if _, err := os.Stat(fmt.Sprintf("/proc/%d", pid)); err != nil {
		return 0, false
	}
	return pid, true
}

// waitForPIDRewrite 等待 PID 文件在 start 之后被重写。
func waitForPIDRewrite(pidFile string, start time.Time, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fi, err := os.Stat(pidFile); err == nil && fi.ModTime().After(start) {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

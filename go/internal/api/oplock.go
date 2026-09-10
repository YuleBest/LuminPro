package api

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"time"
)

// 操作锁类型，用于前端显示更具体的提示文案。
const (
	KindRamp    = "ramp"    // 亮度渐变写入
	KindBoost   = "boost"   // 一键峰值 / 恢复
	KindRestart = "restart" // 重启模块
	KindManual  = "manual"  // 前端手动设置亮度
)

// OplockFile 是 pid/oplock 的内容。
type OplockFile struct {
	PID       int    `json:"pid"`
	Kind      string `json:"kind"`
	StartedAt int64  `json:"startedAt"`
}

// OplockStatus 是给前端的操作锁状态。
type OplockStatus struct {
	Locked  bool   `json:"locked"`
	PID     int    `json:"pid,omitempty"`
	Kind    string `json:"kind,omitempty"`
	Label   string `json:"label,omitempty"`
	Seconds int    `json:"seconds"`
}

// KindLabel 返回操作类型的中文说明。
func KindLabel(kind string) string {
	switch kind {
	case KindRamp:
		return "正在调整亮度"
	case KindBoost:
		return "正在执行一键提升"
	case KindRestart:
		return "正在重启模块"
	case KindManual:
		return "正在设置亮度"
	default:
		return "正在执行后台操作"
	}
}

// WriteOplock 写入操作锁（持锁进程把自己的 PID 与操作类型写进去）。
func WriteOplock(path, kind string) error {
	info := OplockFile{PID: os.Getpid(), Kind: kind, StartedAt: time.Now().Unix()}
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// RemoveOplock 释放操作锁。
func RemoveOplock(path string) {
	_ = os.Remove(path)
}

// ReadOplock 读取并校验操作锁；持锁进程已不存在时视为遗留锁并就地清理。
func ReadOplock(path string) OplockStatus {
	data, err := os.ReadFile(path)
	if err != nil {
		return OplockStatus{}
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		_ = os.Remove(path)
		return OplockStatus{}
	}

	var info OplockFile
	if err := json.Unmarshal([]byte(text), &info); err != nil {
		// 兼容旧版裸 PID 格式
		if pid, perr := strconv.Atoi(text); perr == nil {
			info = OplockFile{PID: pid}
		} else {
			_ = os.Remove(path)
			return OplockStatus{}
		}
	}

	if info.PID <= 0 || !ProcessAlive(info.PID) {
		_ = os.Remove(path) // 遗留锁：进程已被 SIGKILL 等
		return OplockStatus{}
	}

	seconds := 0
	if info.StartedAt > 0 {
		if d := time.Now().Unix() - info.StartedAt; d > 0 {
			seconds = int(d)
		}
	}
	return OplockStatus{
		Locked:  true,
		PID:     info.PID,
		Kind:    info.Kind,
		Label:   KindLabel(info.Kind),
		Seconds: seconds,
	}
}

// ProcessAlive 通过 /proc 判断进程是否存活。
func ProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	_, err := os.Stat("/proc/" + strconv.Itoa(pid))
	return err == nil
}

// DaemonPID 读取 daemon PID 文件并确认进程存活。
func DaemonPID(pidFile string) (int, bool) {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	if !ProcessAlive(pid) {
		return 0, false
	}
	return pid, true
}

// ProcessState 读取 /proc/<pid>/status 的状态字符（R/S/D/Z/T/I）。
func ProcessState(pid int) string {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/status")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "State:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				return fields[1]
			}
		}
	}
	return ""
}

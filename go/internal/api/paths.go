// Package api 提供 WebUI 使用的 JSON API：状态聚合、操作锁、daemon 运行状态与日志读取。
//
// 设计目标：把过去前端要跑 5~6 条 shell 命令（cat /proc、dumpsys、settings、读节点）
// 才能拿到的信息合并成一次调用，并让所有写操作走 argv/stdin 而不是拼接 shell 字符串。
package api

import (
	"os"
	"path/filepath"
)

// Paths 是模块内的文件布局（与 WebUI 的契约）。
type Paths struct {
	ModuleDir  string
	PIDDir     string
	ConfigFile string
	LogFile    string
	PIDFile    string
	StopFlag   string
	PauseFlag  string
	Oplock     string
	BoostFlag  string
	StateFile  string
}

// DefaultPaths 按模块目录推导全部路径。
func DefaultPaths(moduleDir string) Paths {
	pidDir := filepath.Join(moduleDir, "pid")
	return Paths{
		ModuleDir:  moduleDir,
		PIDDir:     pidDir,
		ConfigFile: filepath.Join(moduleDir, "config", "config.json"),
		LogFile:    filepath.Join(moduleDir, "service.log"),
		PIDFile:    filepath.Join(pidDir, "daemon.pid"),
		StopFlag:   filepath.Join(pidDir, "stop.flag"),
		PauseFlag:  filepath.Join(pidDir, "daemon.pause"),
		Oplock:     filepath.Join(pidDir, "oplock"),
		BoostFlag:  filepath.Join(pidDir, "boost.flag"),
		StateFile:  filepath.Join(pidDir, "state.json"),
	}
}

// FileExists 判断普通文件是否存在。
func FileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

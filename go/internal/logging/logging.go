// Package logging 写模块的 service.log。
//
// 格式与旧 shell 版一致：`[MM-DD HH:SS] [luminpro] [LEVEL] msg`。
// WebUI 的日志过滤只做 `includes("[LEVEL]")` 子串匹配，因此格式必须保持。
package logging

import (
	"fmt"
	"os"
	"sync"
	"time"
)

// 日志等级。
const (
	LevelInfo    = "INFO"
	LevelWarn    = "WARN"
	LevelError   = "ERROR"
	LevelSuccess = "SUCCESS"
)

// 配置里的 log_level 取值。
const (
	FilterOff   = "off"
	FilterError = "error"
	FilterWarn  = "warn"
	FilterInfo  = "info"
)

// Tag 是所有日志行的来源标记（旧版为 service/daemon/up，Go 版统一）。
const Tag = "luminpro"

// Logger 是并发安全的追加式日志器。
type Logger struct {
	path      string
	level     string
	maxSizeKB int
	debug     bool

	mu sync.Mutex
}

// New 创建日志器。maxSizeKB 为 0 时使用默认值 512。
func New(path, level string, maxSizeKB int) *Logger {
	if level == "" {
		level = FilterInfo
	}
	if maxSizeKB <= 0 {
		maxSizeKB = 512
	}
	return &Logger{path: path, level: level, maxSizeKB: maxSizeKB}
}

// SetLevel 更新等级过滤（配置热重载时调用）。
func (l *Logger) SetLevel(level string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if level == "" {
		level = FilterInfo
	}
	l.level = level
}

// SetMaxSizeKB 更新日志大小上限。
func (l *Logger) SetMaxSizeKB(kb int) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if kb <= 0 {
		kb = 512
	}
	l.maxSizeKB = kb
}

// SetDebug 开启/关闭调试日志（对应配置 debug_mode）。
func (l *Logger) SetDebug(on bool) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.debug = on
}

// Info / Warn / Error / Success 写一条对应等级的日志。
func (l *Logger) Info(msg string)    { l.write(LevelInfo, msg) }
func (l *Logger) Warn(msg string)    { l.write(LevelWarn, msg) }
func (l *Logger) Error(msg string)   { l.write(LevelError, msg) }
func (l *Logger) Success(msg string) { l.write(LevelSuccess, msg) }

// Debug 仅在 debug_mode 开启时写 INFO 日志。
func (l *Logger) Debug(format string, args ...any) {
	if l == nil {
		return
	}
	l.mu.Lock()
	on := l.debug
	l.mu.Unlock()
	if !on {
		return
	}
	l.write(LevelInfo, fmt.Sprintf(format, args...))
}

// allowed 判断某等级是否应写入。
func (l *Logger) allowed(level string) bool {
	switch l.level {
	case FilterOff:
		return false
	case FilterError:
		return level == LevelError
	case FilterWarn:
		return level == LevelError || level == LevelWarn
	default:
		return true
	}
}

func (l *Logger) write(level, msg string) {
	if l == nil || l.path == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	if !l.allowed(level) {
		return
	}
	l.rotateLocked()

	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "[%s] [%s] [%s] %s\n", time.Now().Format("01-02 15:04:05"), Tag, level, msg)
}

// rotateLocked 超过大小上限时重置日志文件（与旧 up.sh 行为一致）。
func (l *Logger) rotateLocked() {
	info, err := os.Stat(l.path)
	if err != nil {
		return
	}
	curKB := int(info.Size() / 1024)
	if curKB < l.maxSizeKB {
		return
	}
	reset := fmt.Sprintf("[%s] [%s] [%s] 日志超限 (%dKB / %dKB)，已自动重置\n",
		time.Now().Format("01-02 15:04:05"), Tag, LevelWarn, curKB, l.maxSizeKB)
	_ = os.WriteFile(l.path, []byte(reset), 0o644)
}

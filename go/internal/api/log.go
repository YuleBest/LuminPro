package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LogEntry 是一条结构化日志。
type LogEntry struct {
	Time    string `json:"time"`
	Tag     string `json:"tag"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

// LogPage 是 log tail 的输出。
type LogPage struct {
	Entries []LogEntry `json:"entries"`
	Raw     string     `json:"raw,omitempty"`
	SizeKB  int        `json:"sizeKB"`
	Total   int        `json:"total"`
}

// ParseLogLine 解析 `[09-10 12:34:56] [luminpro] [INFO] msg`。
// 不匹配时整行作为 message，level/tag 留空，前端可原样展示。
func ParseLogLine(line string) LogEntry {
	rest := line
	var entry LogEntry

	if strings.HasPrefix(rest, "[") {
		if end := strings.Index(rest, "]"); end > 0 {
			entry.Time = strings.TrimSpace(rest[1:end])
			rest = strings.TrimSpace(rest[end+1:])
		}
	}
	if strings.HasPrefix(rest, "[") {
		if end := strings.Index(rest, "]"); end > 0 {
			entry.Tag = strings.TrimSpace(rest[1:end])
			rest = strings.TrimSpace(rest[end+1:])
		}
	}
	if strings.HasPrefix(rest, "[") {
		if end := strings.Index(rest, "]"); end > 0 {
			entry.Level = strings.ToUpper(strings.TrimSpace(rest[1:end]))
			rest = strings.TrimSpace(rest[end+1:])
		}
	}
	entry.Message = rest
	return entry
}

// TailLog 读取日志末尾若干行。
func TailLog(path string, lines int, raw bool) (LogPage, error) {
	page := LogPage{Entries: []LogEntry{}}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return page, nil
		}
		return page, err
	}
	page.SizeKB = int(int64(len(data)) / 1024)

	text := strings.TrimRight(string(data), "\n")
	if text == "" {
		return page, nil
	}
	all := strings.Split(text, "\n")
	page.Total = len(all)

	if lines > 0 && len(all) > lines {
		all = all[len(all)-lines:]
	}
	if raw {
		page.Raw = strings.Join(all, "\n")
		return page, nil
	}
	for _, line := range all {
		page.Entries = append(page.Entries, ParseLogLine(line))
	}
	return page, nil
}

// ClearLog 清空日志文件。
func ClearLog(path string) error {
	return os.WriteFile(path, nil, 0o644)
}

// ExportLog 把日志复制到目标目录，返回最终路径。
func ExportLog(src, dir string) (string, error) {
	if dir == "" {
		dir = "/sdcard"
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("导出目录不可用: %s", dir)
	}
	name := fmt.Sprintf("LuminPro_%s.log", time.Now().Format("20060102_150405"))
	dst := filepath.Join(dir, name)

	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		return "", err
	}
	return dst, nil
}

// FormatLogEntry 反向格式化，供需要时使用。
func FormatLogEntry(e LogEntry) string {
	return fmt.Sprintf("[%s] [%s] [%s] %s", e.Time, e.Tag, e.Level, e.Message)
}

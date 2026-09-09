package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// OldConfig 描述一份可迁移的旧配置。
type OldConfig struct {
	Format    string // "json" 或 "txt"
	Values    map[string]string
	Blacklist []string
}

// 旧版 txt 配置的字段文件名（相对旧配置目录）。
var oldTxtFields = map[string]string{
	"ui_max_bri":         "ui_max_bri.txt",
	"max_bri":            "max_bri.txt",
	"steps_num":          "steps_num.txt",
	"log_max_size":       "log_max_size.txt",
	"auto_bri_sleep":     "auto_bri_sleep.txt",
	"display_hdr_sleep":  "display_hdr_sleep.txt",
	"compatibility_mode": "compatibility_mode.txt",
	"sleep_time":         "sleep_time.txt",
	"inotify_events":     "inotify_events.txt",
}

// InspectOld 检查旧配置目录，返回可展示的字段值。ok 为 false 表示没有可用旧配置。
func InspectOld(dir string) (OldConfig, bool) {
	values := map[string]string{}

	// 1. 已有 JSON 配置（要求 ui_max_bri > 0 才算有效，与旧脚本判断一致）
	if jsonPath := filepath.Join(dir, "config.json"); fileExists(jsonPath) {
		var raw map[string]json.RawMessage
		if data, err := os.ReadFile(jsonPath); err == nil && json.Unmarshal(data, &raw) == nil {
			var ui int
			_ = json.Unmarshal(raw["ui_max_bri"], &ui)
			if ui > 0 {
				values["ui_max_bri"] = strconv.Itoa(ui)
				var maxBri int
				_ = json.Unmarshal(raw["max_bri"], &maxBri)
				values["max_bri"] = strconv.Itoa(maxBri)
				var sleepTime string
				_ = json.Unmarshal(raw["sleep_time"], &sleepTime)
				values["sleep_time"] = sleepTime
				return OldConfig{Format: "json", Values: values}, true
			}
		}
		return OldConfig{}, false
	}

	// 2. 旧 txt 配置（ui_max_bri / max_bri 都非空才算有效）
	uiTxt := filepath.Join(dir, oldTxtFields["ui_max_bri"])
	maxTxt := filepath.Join(dir, oldTxtFields["max_bri"])
	if !fileExists(uiTxt) || !fileExists(maxTxt) || readTrim(uiTxt) == "" || readTrim(maxTxt) == "" {
		return OldConfig{}, false
	}

	for key, name := range oldTxtFields {
		values[key] = readTrim(filepath.Join(dir, name))
	}
	values["now_bri_file"] = readTrim(filepath.Join(dir, "path", "now_bri_file.txt"))
	values["max_bri_file"] = readTrim(filepath.Join(dir, "path", "max_bri_file.txt"))

	bl := readBlacklistTxt(dir)
	values["blacklist_count"] = strconv.Itoa(len(bl))

	return OldConfig{Format: "txt", Values: values, Blacklist: bl}, true
}

// MigrateOld 把旧配置迁移到 target，返回迁移内容用于安装界面展示。
func MigrateOld(dir, target string) (OldConfig, error) {
	old, ok := InspectOld(dir)
	if !ok {
		return old, errors.New("未找到可迁移的旧配置")
	}

	if old.Format == "json" {
		data, err := os.ReadFile(filepath.Join(dir, "config.json"))
		if err != nil {
			return old, err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return old, err
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return old, err
		}
		// 补齐新版本新增字段
		c, err := Load(target)
		if err != nil {
			return old, err
		}
		// 旧 JSON 缺少 blacklist_apps 时，从 blacklist_apps.txt 补入
		var raw map[string]json.RawMessage
		if rawData, err := os.ReadFile(target); err == nil && json.Unmarshal(rawData, &raw) == nil {
			if _, has := raw["blacklist_apps"]; !has {
				bl := readBlacklistTxt(dir)
				c.BlacklistApps = bl
			}
		}
		if err := c.Save(target); err != nil {
			return old, err
		}
		return old, nil
	}

	// txt -> JSON
	c := Default()
	setInt := func(key string, dst *int) {
		if v := old.Values[key]; v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				*dst = n
			}
		}
	}
	setInt("ui_max_bri", &c.UIMaxBri)
	setInt("max_bri", &c.MaxBri)
	setInt("steps_num", &c.StepsNum)
	setInt("log_max_size", &c.LogMaxSize)
	setInt("auto_bri_sleep", &c.AutoBriSleep)
	setInt("display_hdr_sleep", &c.DisplayHdrSleep)
	setInt("compatibility_mode", &c.CompatibilityMode)
	if v := old.Values["sleep_time"]; v != "" {
		c.SleepTime = v
	}
	if v := old.Values["inotify_events"]; v != "" {
		c.InotifyEvents = v
	}
	if v := old.Values["now_bri_file"]; v != "" {
		c.NowBriFile = v
	}
	if v := old.Values["max_bri_file"]; v != "" {
		c.MaxBriFile = v
	}
	c.BlacklistApps = old.Blacklist

	if err := c.Save(target); err != nil {
		return old, err
	}
	return old, nil
}

// RemoveOldTxt 删除旧 txt 配置（迁移成功后由安装脚本调用）。
func RemoveOldTxt(dir string) error {
	for _, name := range oldTxtFields {
		_ = os.Remove(filepath.Join(dir, name))
	}
	if err := os.RemoveAll(filepath.Join(dir, "path")); err != nil {
		return err
	}
	return os.Remove(filepath.Join(dir, "blacklist_apps.txt"))
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func readTrim(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// readBlacklistTxt 读取旧版黑名单文本（每行一条，忽略空行）。
func readBlacklistTxt(dir string) []string {
	data, err := os.ReadFile(filepath.Join(dir, "blacklist_apps.txt"))
	if err != nil {
		return []string{}
	}
	out := []string{}
	for _, line := range strings.Split(string(data), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

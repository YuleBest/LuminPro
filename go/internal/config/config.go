// Package config 负责读写模块的 config.json。
//
// 字段与 WebUI、安装脚本共享，是三方之间的稳定契约：新增字段必须给默认值，
// 缺失字段按默认值补齐（等价于旧 shell 版 get_cfg 的 fallback 行为）。
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// 默认值，与 config/config.json 模板及 customize.sh 保持一致。
const (
	DefaultUIMaxBri          = 0
	DefaultMaxBri            = 0
	DefaultStepsNum          = 50
	DefaultLogMaxSize        = 512
	DefaultAutoBriSleep      = 1
	DefaultDisplayHdrSleep   = 0
	DefaultHdrEnterRatio     = 1.15
	DefaultHdrExitRatio      = 1.05
	DefaultCompatibilityMode = 0
	DefaultSleepTime         = ""
	DefaultInotifyEvents     = "c"
	DefaultNowBriFile        = "/sys/class/backlight/panel0-backlight/brightness"
	DefaultMaxBriFile        = "/sys/class/backlight/panel0-backlight/max_brightness"
	DefaultLogLevel          = "info"
	DefaultDebugMode         = 0
)

// Config 是模块配置的强类型表示。
type Config struct {
	UIMaxBri          int      `json:"ui_max_bri"`
	MaxBri            int      `json:"max_bri"`
	StepsNum          int      `json:"steps_num"`
	LogMaxSize        int      `json:"log_max_size"`
	AutoBriSleep      int      `json:"auto_bri_sleep"`
	DisplayHdrSleep   int      `json:"display_hdr_sleep"`
	HdrEnterRatio     float64  `json:"hdr_enter_ratio"`
	HdrExitRatio      float64  `json:"hdr_exit_ratio"`
	CompatibilityMode int      `json:"compatibility_mode"`
	SleepTime         string   `json:"sleep_time"`
	InotifyEvents     string   `json:"inotify_events"`
	NowBriFile        string   `json:"now_bri_file"`
	MaxBriFile        string   `json:"max_bri_file"`
	LogLevel          string   `json:"log_level"`
	DebugMode         int      `json:"debug_mode"`
	BlacklistApps     []string `json:"blacklist_apps"`

	// extra 保存本程序不认识的键，读写时原样保留，避免与 WebUI 抢字段。
	extra map[string]json.RawMessage
}

// Default 返回带完整默认值的配置。
func Default() Config {
	return Config{
		UIMaxBri:          DefaultUIMaxBri,
		MaxBri:            DefaultMaxBri,
		StepsNum:          DefaultStepsNum,
		LogMaxSize:        DefaultLogMaxSize,
		AutoBriSleep:      DefaultAutoBriSleep,
		DisplayHdrSleep:   DefaultDisplayHdrSleep,
		HdrEnterRatio:     DefaultHdrEnterRatio,
		HdrExitRatio:      DefaultHdrExitRatio,
		CompatibilityMode: DefaultCompatibilityMode,
		SleepTime:         DefaultSleepTime,
		InotifyEvents:     DefaultInotifyEvents,
		NowBriFile:        DefaultNowBriFile,
		MaxBriFile:        DefaultMaxBriFile,
		LogLevel:          DefaultLogLevel,
		DebugMode:         DefaultDebugMode,
		BlacklistApps:     []string{},
	}
}

// Load 读取配置。文件不存在或为空时返回默认配置；
// 单个字段损坏时保留该字段的默认值（与旧 shell 版 get_cfg 的降级一致）。
func Load(path string) (Config, error) {
	c := Default()
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return c, nil
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return c, fmt.Errorf("解析配置失败: %w", err)
	}
	c.applyRaw(raw)
	return c, nil
}

// Save 原子写回配置（临时文件 + rename），保证 WebUI 读到的是完整 JSON。
func (c Config) Save(path string) error {
	raw := c.toRawMap()
	data, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Ensure 补齐缺失字段并落盘。
func Ensure(path string) error {
	c, err := Load(path)
	if err != nil {
		return err
	}
	return c.Save(path)
}

// Init 在文件不存在时写入默认配置。
func Init(path string) error {
	if _, err := os.Stat(path); err == nil {
		return Ensure(path)
	}
	return Default().Save(path)
}

// Set 按 key=value 写入字段。值按字段的既有类型编码（与旧脚本里 jq 的
// `--arg x | tonumber` / 字符串赋值保持一致），避免 "0" 这类事件字母被写成数字。
func Set(path string, pairs []string) error {
	c, err := Load(path)
	if err != nil {
		return err
	}
	raw := c.toRawMap()
	for _, p := range pairs {
		key, value, ok := strings.Cut(p, "=")
		if !ok || key == "" {
			return fmt.Errorf("参数格式应为 key=value: %q", p)
		}
		b, err := encodeValue(key, value)
		if err != nil {
			return err
		}
		raw[key] = b
	}

	updated := Default()
	updated.applyRaw(raw)
	return updated.Save(path)
}

var intFields = map[string]bool{
	"ui_max_bri":         true,
	"max_bri":            true,
	"steps_num":          true,
	"log_max_size":       true,
	"auto_bri_sleep":     true,
	"display_hdr_sleep":  true,
	"compatibility_mode": true,
	"debug_mode":         true,
}

var floatFields = map[string]bool{
	"hdr_enter_ratio": true,
	"hdr_exit_ratio":  true,
}

var stringFields = map[string]bool{
	"sleep_time":     true,
	"inotify_events": true,
	"now_bri_file":   true,
	"max_bri_file":   true,
	"log_level":      true,
}

// encodeValue 按已知字段类型把字符串编码为 JSON 值；未知字段按 JSON 字面量解析。
func encodeValue(key, value string) (json.RawMessage, error) {
	switch {
	case intFields[key]:
		n, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return nil, fmt.Errorf("%s 需要整数: %q", key, value)
		}
		return json.Marshal(n)
	case floatFields[key]:
		f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return nil, fmt.Errorf("%s 需要数值: %q", key, value)
		}
		return json.Marshal(f)
	case stringFields[key]:
		return json.Marshal(value)
	case key == "blacklist_apps":
		var arr []string
		if err := json.Unmarshal([]byte(value), &arr); err != nil {
			return nil, fmt.Errorf("blacklist_apps 需要 JSON 数组: %q", value)
		}
		if arr == nil {
			arr = []string{}
		}
		return json.Marshal(arr)
	default:
		return json.Marshal(parseValue(value))
	}
}

// parseValue 把字符串解析为 JSON 值；不是合法 JSON 字面量时按字符串处理。
func parseValue(s string) any {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err == nil {
		return v
	}
	return s
}

// applyRaw 用原始键值填充强类型字段，未识别的键留在 extra。
func (c *Config) applyRaw(raw map[string]json.RawMessage) {
	known := map[string]any{
		"ui_max_bri":         &c.UIMaxBri,
		"max_bri":            &c.MaxBri,
		"steps_num":          &c.StepsNum,
		"log_max_size":       &c.LogMaxSize,
		"auto_bri_sleep":     &c.AutoBriSleep,
		"display_hdr_sleep":  &c.DisplayHdrSleep,
		"hdr_enter_ratio":    &c.HdrEnterRatio,
		"hdr_exit_ratio":     &c.HdrExitRatio,
		"compatibility_mode": &c.CompatibilityMode,
		"sleep_time":         &c.SleepTime,
		"inotify_events":     &c.InotifyEvents,
		"now_bri_file":       &c.NowBriFile,
		"max_bri_file":       &c.MaxBriFile,
		"log_level":          &c.LogLevel,
		"debug_mode":         &c.DebugMode,
		"blacklist_apps":     &c.BlacklistApps,
	}

	c.extra = nil
	for key, value := range raw {
		if dst, ok := known[key]; ok {
			// 单个字段损坏时保留默认值，不阻断整体加载。
			_ = json.Unmarshal(value, dst)
			continue
		}
		if c.extra == nil {
			c.extra = map[string]json.RawMessage{}
		}
		c.extra[key] = value
	}
	if c.BlacklistApps == nil {
		c.BlacklistApps = []string{}
	}
}

// toRawMap 导出为原始键值表（含未知键）。
func (c Config) toRawMap() map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for key, value := range map[string]any{
		"ui_max_bri":         c.UIMaxBri,
		"max_bri":            c.MaxBri,
		"steps_num":          c.StepsNum,
		"log_max_size":       c.LogMaxSize,
		"auto_bri_sleep":     c.AutoBriSleep,
		"display_hdr_sleep":  c.DisplayHdrSleep,
		"hdr_enter_ratio":    c.HdrEnterRatio,
		"hdr_exit_ratio":     c.HdrExitRatio,
		"compatibility_mode": c.CompatibilityMode,
		"sleep_time":         c.SleepTime,
		"inotify_events":     c.InotifyEvents,
		"now_bri_file":       c.NowBriFile,
		"max_bri_file":       c.MaxBriFile,
		"log_level":          c.LogLevel,
		"debug_mode":         c.DebugMode,
		"blacklist_apps":     c.BlacklistApps,
	} {
		b, err := json.Marshal(value)
		if err != nil {
			continue
		}
		out[key] = b
	}
	for key, value := range c.extra {
		if _, ok := out[key]; !ok {
			out[key] = value
		}
	}
	return out
}

// Blacklist 返回黑名单副本，避免调用方误改内部切片。
func (c Config) Blacklist() []string {
	return append([]string(nil), c.BlacklistApps...)
}

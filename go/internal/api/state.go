package api

import (
	"encoding/json"
	"os"
)

// daemon 运行状态文件的 DTO。daemon 每次判定后刷新，status 直接读取，
// 避免前端高频刷新时反复调用 dumpsys。

// EventInfo 最近一次监听到的事件。
type EventInfo struct {
	Letters string `json:"letters"`
	At      int64  `json:"at"`
}

// ActionInfo 最近一次亮度操作。
type ActionInfo struct {
	Kind string `json:"kind"`
	From int    `json:"from"`
	To   int    `json:"to"`
	At   int64  `json:"at"`
}

// RatioInfo 最近一次读到的 HDR/SDR 比率。
type RatioInfo struct {
	Value float64 `json:"value"`
	At    int64   `json:"at"`
}

// BoolInfo 带时间戳的布尔值。
type BoolInfo struct {
	Value bool  `json:"value"`
	At    int64 `json:"at"`
}

// IntInfo 带时间戳的整数。
type IntInfo struct {
	Value int   `json:"value"`
	At    int64 `json:"at"`
}

// DaemonState 是 pid/state.json 的内容。
type DaemonState struct {
	PID            int         `json:"pid"`
	StartedAt      int64       `json:"startedAt"`
	Mode           string      `json:"mode"` // event | polling
	Node           string      `json:"node"`
	Paused         bool        `json:"paused"`
	HdrSleep       bool        `json:"hdrSleep"`
	LastEvent      *EventInfo  `json:"lastEvent,omitempty"`
	LastAction     *ActionInfo `json:"lastAction,omitempty"`
	Ratio          *RatioInfo  `json:"ratio,omitempty"`
	AutoBrightness *BoolInfo   `json:"autoBrightness,omitempty"`
	Brightness     *IntInfo    `json:"brightness,omitempty"`
}

// WriteState 原子写入运行状态。
func WriteState(path string, s DaemonState) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ReadState 读取运行状态；文件缺失或损坏时返回 false。
func ReadState(path string) (DaemonState, bool) {
	var s DaemonState
	data, err := os.ReadFile(path)
	if err != nil {
		return s, false
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return s, false
	}
	if s.PID <= 0 || !ProcessAlive(s.PID) {
		return s, false
	}
	return s, true
}

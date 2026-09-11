// Package brightness 负责亮度 sysfs 节点的读写与渐变计算。
package brightness

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// ReadInt 读取节点当前整数值（对应 shell 的 `cat`）。
func ReadInt(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return 0, fmt.Errorf("亮度节点内容为空: %s", path)
	}
	v, err := strconv.Atoi(text)
	if err != nil {
		return 0, fmt.Errorf("亮度节点内容不是整数 (%q): %w", text, err)
	}
	return v, nil
}

// WriteInt 写入节点（对应 shell 的 `echo -n`，不追加换行）。
func WriteInt(path string, value int) error {
	return os.WriteFile(path, []byte(strconv.Itoa(value)), 0o644)
}

// Steps 计算渐变序列：不含起点，含目标值。
//
// 与旧 shell 版一致：step = (target-start)/steps 为整除，
// 结果为 0 时直接返回单个目标值（差値过小）。
func Steps(start, target, steps int) []int {
	if steps <= 0 {
		return []int{target}
	}
	stepValue := (target - start) / steps
	if stepValue == 0 {
		return []int{target}
	}
	out := make([]int, 0, steps+1)
	for i := 1; i <= steps; i++ {
		out = append(out, start+i*stepValue)
	}
	// 末值兜底为精确目标（整除余数导致的偏差）
	return append(out, target)
}

// Ramp 按渐变序列写入节点，每步之间等待 delay。onStep 可为 nil。
func Ramp(path string, start, target, steps int, delay time.Duration, onStep func(step, value int)) error {
	for i, value := range Steps(start, target, steps) {
		if err := WriteInt(path, value); err != nil {
			return err
		}
		if onStep != nil {
			onStep(i+1, value)
		}
		if i < steps && delay > 0 {
			time.Sleep(delay)
		}
	}
	return nil
}

// Package system 封装对 Android 系统命令的调用。
//
// 全部通过接口暴露，daemon 只依赖接口，测试时注入假实现。
// 命令失败时按「无数据」处理，与旧 shell 版 `2>/dev/null || default` 语义一致。
package system

import (
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Runner 执行命令并返回标准输出，便于测试注入。
type Runner interface {
	Output(name string, args ...string) (string, error)
}

// ExecRunner 用 os/exec 执行命令，带超时避免 dumpsys 卡死。
type ExecRunner struct {
	Timeout time.Duration
}

// Output 执行命令。
func (r ExecRunner) Output(name string, args ...string) (string, error) {
	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	return string(out), err
}

// AutoBrightness 判断系统自动亮度是否开启。
type AutoBrightness struct{ Runner Runner }

// Enabled 对应 `settings get system screen_brightness_mode`，仅 "1" 视为开启。
func (a AutoBrightness) Enabled() bool {
	if a.Runner == nil {
		return false
	}
	out, err := a.Runner.Output("settings", "get", "system", "screen_brightness_mode")
	if err != nil {
		return false
	}
	return strings.TrimSpace(out) == "1"
}

// Focus 获取当前前台焦点（pkg/Activity）。
type Focus struct{ Runner Runner }

// CurrentFocus 解析 `dumpsys window` 中的 mCurrentFocus 行。
// 无法解析时返回空串（视为无前台应用，不命中黑名单）。
func (f Focus) CurrentFocus() string {
	if f.Runner == nil {
		return ""
	}
	out, err := f.Runner.Output("dumpsys", "window")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "mCurrentFocus") {
			return parseFocusLine(line)
		}
	}
	return ""
}

// parseFocusLine 等价于旧脚本的 `sed 's/.*u[0-9][0-9]* //' | sed 's/}.*//'`：
// 取最后一个 `u<pid> ` 之后的内容，并截断到第一个 `}`。
func parseFocusLine(line string) string {
	start := -1
	for i := 0; i < len(line); i++ {
		if line[i] != 'u' {
			continue
		}
		j := i + 1
		for j < len(line) && line[j] >= '0' && line[j] <= '9' {
			j++
		}
		if j > i+1 && j < len(line) && line[j] == ' ' {
			start = j + 1 // 记录最后一个匹配（sed 的 .* 是贪婪的）
		}
	}
	if start < 0 {
		return ""
	}
	s := line[start:]
	if k := strings.Index(s, "}"); k >= 0 {
		s = s[:k]
	}
	return strings.TrimSpace(s)
}

// HdrRatio 读取 HDR/SDR 比率。
type HdrRatio struct{ Runner Runner }

var hdrRatioRe = regexp.MustCompile(`hdrSdrRatio ([0-9.]+)`)

// Ratio 解析 `dumpsys display` 中第一处 hdrSdrRatio。第二个返回值表示是否读到。
func (h HdrRatio) Ratio() (float64, bool) {
	if h.Runner == nil {
		return 0, false
	}
	out, err := h.Runner.Output("dumpsys", "display")
	if err != nil {
		return 0, false
	}
	m := hdrRatioRe.FindStringSubmatch(out)
	if m == nil {
		return 0, false
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

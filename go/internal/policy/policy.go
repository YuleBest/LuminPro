// Package policy 是纯判定逻辑：休眠时段、阈值、黑名单、HDR 迟滞。
//
// 全部函数不接触 IO，便于 host 单测；IO 与系统调用在 daemon/system 层。
package policy

import (
	"strconv"
	"strings"
	"time"
)

// InSleepWindow 判断当前是否处于休眠时段（格式 HHMM-HHMM，支持跨午夜）。
//
// 与旧 shell 版语义一致：格式非法、起止相同或为空时都视为不休眠。
func InSleepWindow(sleepTime string, now time.Time) bool {
	start, end, ok := parseSleepWindow(sleepTime)
	if !ok || start == end {
		return false
	}
	cur := now.Hour()*100 + now.Minute()
	if start > end {
		// 跨午夜，如 2200-0700
		return cur >= start || cur < end
	}
	return cur >= start && cur < end
}

func parseSleepWindow(s string) (start, end int, ok bool) {
	idx := strings.Index(s, "-")
	if idx < 0 {
		return 0, 0, false
	}
	left, right := s[:idx], s[idx+1:]
	if left == "" || right == "" {
		return 0, 0, false
	}
	a, err1 := strconv.Atoi(left)
	b, err2 := strconv.Atoi(right)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return a, b, true
}

// ShouldBoost 判断当前亮度是否满足提升条件：
// 已到达前台阈值，且尚未到达目标亮度（对应 shell 的 `-ge ui_max && -lt target`）。
func ShouldBoost(nowBri, uiMax, target int) bool {
	return nowBri >= uiMax && nowBri < target
}

// BlacklistMatch 判断前台焦点是否命中黑名单。
// 黑名单项可以是完整 Activity（pkg/Activity）或包名，两者都算命中。
func BlacklistMatch(entries []string, focus string) bool {
	if focus == "" {
		return false
	}
	pkg := focus
	if i := strings.Index(focus, "/"); i >= 0 {
		pkg = focus[:i]
	}
	for _, entry := range entries {
		if entry == focus || entry == pkg {
			return true
		}
	}
	return false
}

// HdrDecision 是 HDR 判定结果。
type HdrDecision struct {
	Skip    bool // 本次是否跳过提升
	Entered bool // 本次是否刚进入 HDR 休眠
	Exited  bool // 本次是否刚退出 HDR 休眠
}

// HdrState 是带迟滞的 HDR 休眠状态机（替代旧的 hdr.flag 文件）。
//
// 比率达到进入阈值后休眠，直到比率降到退出阈值及以下才恢复；
// 比率不可读时，休眠中保持休眠，未休眠则放行。
type HdrState struct {
	inSleep bool
}

// InSleep 返回当前是否处于 HDR 休眠。
func (h *HdrState) InSleep() bool { return h.inSleep }

// Evaluate 根据当前比率推进状态机。
func (h *HdrState) Evaluate(ratio float64, haveRatio bool, enter, exit float64) HdrDecision {
	if !haveRatio {
		if h.inSleep {
			return HdrDecision{Skip: true}
		}
		return HdrDecision{}
	}

	if h.inSleep {
		if ratio <= exit {
			h.inSleep = false
			return HdrDecision{Exited: true}
		}
		return HdrDecision{Skip: true}
	}

	if ratio >= enter {
		h.inSleep = true
		return HdrDecision{Skip: true, Entered: true}
	}
	return HdrDecision{}
}

// Reset 清除休眠状态（配置变更或服务重启时使用）。
func (h *HdrState) Reset() { h.inSleep = false }

package policy

import (
	"testing"
	"time"
)

func at(hour, min int) time.Time {
	return time.Date(2026, 9, 10, hour, min, 0, 0, time.Local)
}

func TestInSleepWindow(t *testing.T) {
	cases := []struct {
		name      string
		sleepTime string
		now       time.Time
		want      bool
	}{
		{"空配置不休眠", "", at(23, 0), false},
		{"无连字符不休眠", "2200", at(23, 0), false},
		{"跨午夜命中-深夜", "2200-0700", at(23, 0), true},
		{"跨午夜命中-凌晨", "2200-0700", at(6, 0), true},
		{"跨午夜起点含", "2200-0700", at(22, 0), true},
		{"跨午夜终点不含", "2200-0700", at(7, 0), false},
		{"跨午夜白天不休眠", "2200-0700", at(12, 0), false},
		{"同日命中", "0900-1700", at(12, 0), true},
		{"同日起点含", "0900-1700", at(9, 0), true},
		{"同日终点不含", "0900-1700", at(17, 0), false},
		{"同日之前不休眠", "0900-1700", at(8, 59), false},
		{"起止相同不休眠", "1200-1200", at(12, 0), false},
		{"非法格式不休眠", "abc-def", at(12, 0), false},
		{"单侧缺失不休眠", "2200-", at(23, 0), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := InSleepWindow(tc.sleepTime, tc.now); got != tc.want {
				t.Fatalf("InSleepWindow(%q, %s) = %v, 期望 %v", tc.sleepTime, tc.now.Format("15:04"), got, tc.want)
			}
		})
	}
}

func TestShouldBoost(t *testing.T) {
	cases := []struct {
		now, uiMax, target int
		want               bool
	}{
		{1000, 1000, 2000, true},  // 刚到阈值
		{999, 1000, 2000, false},  // 低于阈值
		{2000, 1000, 2000, false}, // 已达目标
		{2500, 1000, 2000, false}, // 超过目标
		{1500, 1000, 2000, true},  // 区间内
		{0, 0, 2000, true},        // 阈值为 0（未校准）时也满足，与旧脚本一致
	}
	for _, tc := range cases {
		if got := ShouldBoost(tc.now, tc.uiMax, tc.target); got != tc.want {
			t.Errorf("ShouldBoost(%d,%d,%d) = %v, 期望 %v", tc.now, tc.uiMax, tc.target, got, tc.want)
		}
	}
}

func TestBlacklistMatch(t *testing.T) {
	entries := []string{"com.a/.MainActivity", "com.b"}
	cases := []struct {
		focus string
		want  bool
	}{
		{"com.a/.MainActivity", true},   // 完整 Activity 精确命中
		{"com.a/.OtherActivity", false}, // 仅包名相同不算命中（与旧 jq 表达式一致）
		{"com.b/.Main", true},           // 包名条目命中
		{"com.c/.Main", false},
		{"", false},
		{"com.b", true}, // 焦点无斜杠时按包名比较
	}
	for _, tc := range cases {
		if got := BlacklistMatch(entries, tc.focus); got != tc.want {
			t.Errorf("BlacklistMatch(%q) = %v, 期望 %v", tc.focus, got, tc.want)
		}
	}

	// 黑名单里是完整 Activity，焦点只有包名时不应命中（与旧 jq 表达式一致）
	if BlacklistMatch([]string{"com.a/.Main"}, "com.a") {
		t.Error("焦点仅包名不应命中仅含 Activity 的黑名单项")
	}
	if BlacklistMatch(nil, "com.a/.Main") {
		t.Error("空黑名单不应命中")
	}
}

func TestHdrStateMachine(t *testing.T) {
	var h HdrState
	const enter, exit = 1.15, 1.05

	// 未达进入阈值：放行
	if d := h.Evaluate(1.10, true, enter, exit); d.Skip || d.Entered || d.Exited {
		t.Fatalf("1.10 应放行: %+v", d)
	}
	// 达到进入阈值：进入休眠
	if d := h.Evaluate(1.15, true, enter, exit); !d.Skip || !d.Entered || !h.InSleep() {
		t.Fatalf("1.15 应进入休眠: %+v", d)
	}
	// 迟滞区间内：保持休眠
	if d := h.Evaluate(1.10, true, enter, exit); !d.Skip || d.Exited {
		t.Fatalf("1.10 应保持休眠: %+v", d)
	}
	// 高于退出阈值：仍休眠
	if d := h.Evaluate(1.06, true, enter, exit); !d.Skip {
		t.Fatalf("1.06 应保持休眠: %+v", d)
	}
	// 降到退出阈值：解除休眠且本次放行
	if d := h.Evaluate(1.05, true, enter, exit); !d.Exited || d.Skip || h.InSleep() {
		t.Fatalf("1.05 应解除休眠: %+v", d)
	}
	// 解除后可再次进入
	if d := h.Evaluate(1.30, true, enter, exit); !d.Entered {
		t.Fatalf("1.30 应再次进入休眠: %+v", d)
	}
}

func TestHdrUnreadableRatio(t *testing.T) {
	var h HdrState
	const enter, exit = 1.15, 1.05

	// 未休眠且比率不可读：放行
	if d := h.Evaluate(0, false, enter, exit); d.Skip {
		t.Fatalf("未休眠且不可读应放行: %+v", d)
	}
	// 进入休眠后比率不可读：保持休眠
	h.Evaluate(1.20, true, enter, exit)
	if d := h.Evaluate(0, false, enter, exit); !d.Skip || !h.InSleep() {
		t.Fatalf("休眠中且不可读应保持休眠: %+v", d)
	}
	// Reset 后恢复放行
	h.Reset()
	if h.InSleep() {
		t.Fatal("Reset 后不应处于休眠")
	}
}

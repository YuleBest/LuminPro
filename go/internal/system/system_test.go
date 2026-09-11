package system

import (
	"errors"
	"testing"
)

type fakeRunner struct {
	outputs map[string]string
	err     error
}

func (f fakeRunner) Output(name string, args ...string) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	return f.outputs[name+" "+joinArgs(args)], nil
}

func joinArgs(args []string) string {
	out := ""
	for i, a := range args {
		if i > 0 {
			out += " "
		}
		out += a
	}
	return out
}

func TestAutoBrightness(t *testing.T) {
	on := AutoBrightness{Runner: fakeRunner{outputs: map[string]string{
		"settings get system screen_brightness_mode": "1\n",
	}}}
	if !on.Enabled() {
		t.Fatal("mode=1 应判定为开启")
	}
	off := AutoBrightness{Runner: fakeRunner{outputs: map[string]string{
		"settings get system screen_brightness_mode": "0\n",
	}}}
	if off.Enabled() {
		t.Fatal("mode=0 应判定为关闭")
	}
	fail := AutoBrightness{Runner: fakeRunner{err: errors.New("boom")}}
	if fail.Enabled() {
		t.Fatal("命令失败应按关闭处理")
	}
}

func TestParseFocusLine(t *testing.T) {
	cases := []struct {
		line string
		want string
	}{
		{"  mCurrentFocus=Window{a1b2c3 u0 com.example/.MainActivity}", "com.example/.MainActivity"},
		{"  mCurrentFocus=Window{abc u12345 com.foo.bar/.BazActivity}", "com.foo.bar/.BazActivity"},
		{"mCurrentFocus=Window{abc u0 com.a/.B} dumpsys 附加文本", "com.a/.B"},
		{"mCurrentFocus=null", ""},
		{"", ""},
		{"mCurrentFocus=Window{abc u0 com.a/.B", "com.a/.B"}, // 缺右花括号
	}
	for _, tc := range cases {
		if got := parseFocusLine(tc.line); got != tc.want {
			t.Errorf("parseFocusLine(%q) = %q, 期望 %q", tc.line, got, tc.want)
		}
	}
}

func TestFocusPicksFirstMatchingLine(t *testing.T) {
	f := Focus{Runner: fakeRunner{outputs: map[string]string{
		"dumpsys window": "  mCurrentFocus=Window{x u0 com.first/.Main}\n" +
			"  mFocusedApp=Window{y u0 com.second/.Main}\n",
	}}}
	if got := f.CurrentFocus(); got != "com.first/.Main" {
		t.Fatalf("应取第一处 mCurrentFocus: %q", got)
	}
}

func TestHdrRatio(t *testing.T) {
	h := HdrRatio{Runner: fakeRunner{outputs: map[string]string{
		"dumpsys display": "  some line\n  hdrSdrRatio 1.25 extra\n  hdrSdrRatio 9.99\n",
	}}}
	v, ok := h.Ratio()
	if !ok || v != 1.25 {
		t.Fatalf("应取第一处比率 1.25, 实际 %v %v", v, ok)
	}

	none := HdrRatio{Runner: fakeRunner{outputs: map[string]string{"dumpsys display": "no ratio here"}}}
	if _, ok := none.Ratio(); ok {
		t.Fatal("无比率时应返回 false")
	}
	fail := HdrRatio{Runner: fakeRunner{err: errors.New("boom")}}
	if _, ok := fail.Ratio(); ok {
		t.Fatal("命令失败时应返回 false")
	}
}

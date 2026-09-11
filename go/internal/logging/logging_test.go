package logging

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
)

func readLog(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取日志失败: %v", err)
	}
	return string(data)
}

func TestFormatMatchesWebUIFilter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.log")
	New(path, FilterInfo, 512).Info("触发提升")

	got := readLog(t, path)
	// WebUI 用 includes("[INFO]") 过滤，格式必须保持
	if !strings.Contains(got, "[INFO]") || !strings.Contains(got, "[luminpro]") {
		t.Fatalf("日志格式不符合 WebUI 过滤预期: %q", got)
	}
	re := regexp.MustCompile(`^\[\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[luminpro\] \[INFO\] 触发提升\n$`)
	if !re.MatchString(got) {
		t.Fatalf("日志格式不匹配: %q", got)
	}
}

func TestLevelFiltering(t *testing.T) {
	cases := []struct {
		filter string
		want   []string
	}{
		{FilterOff, nil},
		{FilterError, []string{"[ERROR]"}},
		{FilterWarn, []string{"[ERROR]", "[WARN]"}},
		{FilterInfo, []string{"[ERROR]", "[WARN]", "[INFO]", "[SUCCESS]"}},
	}
	for _, tc := range cases {
		t.Run(tc.filter, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "service.log")
			l := New(path, tc.filter, 512)
			l.Error("e")
			l.Warn("w")
			l.Info("i")
			l.Success("s")

			data, err := os.ReadFile(path)
			if tc.want == nil {
				if err == nil {
					t.Fatalf("off 模式不应写日志: %q", string(data))
				}
				return
			}
			if err != nil {
				t.Fatalf("读取失败: %v", err)
			}
			got := string(data)
			for _, level := range []string{"[ERROR]", "[WARN]", "[INFO]", "[SUCCESS]"} {
				shouldContain := false
				for _, w := range tc.want {
					if w == level {
						shouldContain = true
					}
				}
				if strings.Contains(got, level) != shouldContain {
					t.Fatalf("filter=%s level=%s 不符合预期: %q", tc.filter, level, got)
				}
			}
		})
	}
}

func TestRotationResetsOversizedLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.log")
	l := New(path, FilterInfo, 1) // 上限 1KB
	for i := 0; i < 200; i++ {
		l.Info("填充日志内容填充日志内容填充日志内容填充日志内容")
	}
	got := readLog(t, path)
	if !strings.Contains(got, "日志超限") {
		t.Fatalf("超限后未重置: %q", got[:min(len(got), 200)])
	}
	if len(got) > 2048 {
		t.Fatalf("重置后文件仍然过大: %d 字节", len(got))
	}
}

func TestDebugOnlyWhenEnabled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.log")
	l := New(path, FilterInfo, 512)
	l.Debug("事件: %s", "c")
	if _, err := os.Stat(path); err == nil {
		t.Fatal("debug 关闭时不应写日志")
	}
	l.SetDebug(true)
	l.Debug("事件: %s", "c")
	if got := readLog(t, path); !strings.Contains(got, "事件: c") {
		t.Fatalf("debug 开启后应写日志: %q", got)
	}
}

func TestConcurrentWritesKeepLinesIntact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.log")
	l := New(path, FilterInfo, 512)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				l.Info("并发写入测试内容")
			}
		}()
	}
	wg.Wait()

	for _, line := range strings.Split(strings.TrimSpace(readLog(t, path)), "\n") {
		if !strings.HasPrefix(line, "[") || !strings.HasSuffix(line, "并发写入测试内容") {
			t.Fatalf("出现被截断/交错的日志行: %q", line)
		}
	}
}

func TestSetLevelAndMaxSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.log")
	l := New(path, FilterInfo, 512)
	l.SetLevel(FilterError)
	l.Info("不该出现")
	l.Error("该出现")
	got := readLog(t, path)
	if strings.Contains(got, "不该出现") || !strings.Contains(got, "该出现") {
		t.Fatalf("SetLevel 未生效: %q", got)
	}
	l.SetMaxSizeKB(0) // 应回退默认值，不 panic
	l.Info("ok")
}

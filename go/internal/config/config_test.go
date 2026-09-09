package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingFileReturnsDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	c, err := Load(path)
	if err != nil {
		t.Fatalf("Load 出错: %v", err)
	}
	if c.StepsNum != DefaultStepsNum || c.HdrEnterRatio != DefaultHdrEnterRatio || c.LogLevel != DefaultLogLevel {
		t.Fatalf("默认值不正确: %+v", c)
	}
	if c.BlacklistApps == nil {
		t.Fatal("BlacklistApps 不应为 nil")
	}
}

func TestLoadPartialFileFillsDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"ui_max_bri":123,"max_bri":4095}`), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.UIMaxBri != 123 || c.MaxBri != 4095 {
		t.Fatalf("已存在的字段未生效: %+v", c)
	}
	if c.StepsNum != DefaultStepsNum {
		t.Fatalf("缺失字段未补默认值: steps_num=%d", c.StepsNum)
	}
	if c.NowBriFile != DefaultNowBriFile {
		t.Fatalf("缺失字段未补默认值: now_bri_file=%q", c.NowBriFile)
	}
}

func TestLoadMalformedFieldKeepsDefault(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	// steps_num 类型错误，ui_max_bri 正常
	if err := os.WriteFile(path, []byte(`{"ui_max_bri":200,"steps_num":"abc"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.UIMaxBri != 200 {
		t.Fatalf("正常字段应生效: %d", c.UIMaxBri)
	}
	if c.StepsNum != DefaultStepsNum {
		t.Fatalf("损坏字段应回退默认值: %d", c.StepsNum)
	}
}

func TestUnknownKeysPreservedOnSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"ui_max_bri":100,"future_field":"keep-me"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	c.MaxBri = 999
	if err := c.Save(path); err != nil {
		t.Fatal(err)
	}

	var raw map[string]json.RawMessage
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	var kept string
	if err := json.Unmarshal(raw["future_field"], &kept); err != nil || kept != "keep-me" {
		t.Fatalf("未知字段未保留: %v %q", err, kept)
	}
	if _, ok := raw["steps_num"]; !ok {
		t.Fatal("保存后应包含全部已知字段")
	}
}

func TestSetParsesTypes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	err := Set(path, []string{
		"ui_max_bri=1500",
		"hdr_enter_ratio=1.25",
		"inotify_events=0",
		"blacklist_apps=[\"com.a\",\"com.b\"]",
		"sleep_time=2200-0700",
	})
	if err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.UIMaxBri != 1500 {
		t.Fatalf("int 未写入: %d", c.UIMaxBri)
	}
	if c.HdrEnterRatio != 1.25 {
		t.Fatalf("float 未写入: %v", c.HdrEnterRatio)
	}
	if c.InotifyEvents != "0" {
		t.Fatalf("字符串未写入: %q", c.InotifyEvents)
	}
	if len(c.BlacklistApps) != 2 || c.BlacklistApps[0] != "com.a" {
		t.Fatalf("数组未写入: %v", c.BlacklistApps)
	}
	if c.SleepTime != "2200-0700" {
		t.Fatalf("时间串未写入: %q", c.SleepTime)
	}
}

func TestSetRejectsBadPair(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := Set(path, []string{"novalue"}); err == nil {
		t.Fatal("缺少 = 应报错")
	}
}

func TestSetRejectsBadType(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := Set(path, []string{"ui_max_bri=1500"}); err != nil {
		t.Fatal(err)
	}
	if err := Set(path, []string{"ui_max_bri=abc"}); err == nil {
		t.Fatal("整数字段给非数字应报错")
	}
	// 失败时不应破坏已有配置
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.UIMaxBri != 1500 {
		t.Fatalf("写入失败不应改动原值: %d", c.UIMaxBri)
	}
}

func TestInitCreatesAndEnsureFills(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := Init(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("Init 未创建文件: %v", err)
	}
	// 删掉一个字段后 Ensure 应补回
	if err := os.WriteFile(path, []byte(`{"ui_max_bri":50}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Ensure(path); err != nil {
		t.Fatal(err)
	}
	c, _ := Load(path)
	if c.UIMaxBri != 50 || c.LogMaxSize != DefaultLogMaxSize {
		t.Fatalf("Ensure 结果不正确: %+v", c)
	}
}

func TestInspectAndMigrateOldTxt(t *testing.T) {
	oldDir := t.TempDir()
	write := func(name, content string) {
		p := filepath.Join(oldDir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("ui_max_bri.txt", "1200\n")
	write("max_bri.txt", "4095\n")
	write("sleep_time.txt", "2200-0700\n")
	write("steps_num.txt", "80\n")
	write("path/now_bri_file.txt", "/sys/custom/brightness\n")
	write("blacklist_apps.txt", "com.a\ncom.b\n\n")

	old, ok := InspectOld(oldDir)
	if !ok || old.Format != "txt" {
		t.Fatalf("未识别旧 txt 配置: %+v ok=%v", old, ok)
	}
	if old.Values["ui_max_bri"] != "1200" || old.Values["blacklist_count"] != "2" {
		t.Fatalf("inspect 值不正确: %+v", old.Values)
	}

	target := filepath.Join(t.TempDir(), "config.json")
	if _, err := MigrateOld(oldDir, target); err != nil {
		t.Fatal(err)
	}
	c, err := Load(target)
	if err != nil {
		t.Fatal(err)
	}
	if c.UIMaxBri != 1200 || c.MaxBri != 4095 || c.StepsNum != 80 {
		t.Fatalf("迁移数值不正确: %+v", c)
	}
	if c.SleepTime != "2200-0700" || c.NowBriFile != "/sys/custom/brightness" {
		t.Fatalf("迁移字符串不正确: %+v", c)
	}
	if len(c.BlacklistApps) != 2 {
		t.Fatalf("迁移黑名单不正确: %v", c.BlacklistApps)
	}
	if c.LogLevel != DefaultLogLevel {
		t.Fatalf("未迁移字段应取默认值: %q", c.LogLevel)
	}

	if err := RemoveOldTxt(oldDir); err != nil {
		t.Fatalf("删除旧 txt 失败: %v", err)
	}
	if fileExists(filepath.Join(oldDir, "ui_max_bri.txt")) {
		t.Fatal("旧 txt 未删除")
	}
}

func TestMigrateOldJSON(t *testing.T) {
	oldDir := t.TempDir()
	oldJSON := `{"ui_max_bri":900,"max_bri":3000,"sleep_time":"0100-0600","blacklist_apps":["com.x"]}`
	if err := os.WriteFile(filepath.Join(oldDir, "config.json"), []byte(oldJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	old, ok := InspectOld(oldDir)
	if !ok || old.Format != "json" {
		t.Fatalf("未识别旧 JSON 配置: %+v ok=%v", old, ok)
	}

	target := filepath.Join(t.TempDir(), "config.json")
	if _, err := MigrateOld(oldDir, target); err != nil {
		t.Fatal(err)
	}
	c, err := Load(target)
	if err != nil {
		t.Fatal(err)
	}
	if c.UIMaxBri != 900 || c.MaxBri != 3000 || c.SleepTime != "0100-0600" {
		t.Fatalf("JSON 迁移值不正确: %+v", c)
	}
	if len(c.BlacklistApps) != 1 || c.BlacklistApps[0] != "com.x" {
		t.Fatalf("黑名单未保留: %v", c.BlacklistApps)
	}
	if c.HdrEnterRatio != DefaultHdrEnterRatio {
		t.Fatalf("新字段未补默认值: %v", c.HdrEnterRatio)
	}
}

func TestInspectOldRejectsEmptyConfig(t *testing.T) {
	oldDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(oldDir, "config.json"), []byte(`{"ui_max_bri":0}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := InspectOld(oldDir); ok {
		t.Fatal("ui_max_bri 为 0 的旧配置不应被视为可用")
	}
	if _, ok := InspectOld(t.TempDir()); ok {
		t.Fatal("空目录不应被视为可用旧配置")
	}
}

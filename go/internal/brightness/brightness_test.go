package brightness

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadWriteInt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "brightness")
	if err := os.WriteFile(path, []byte("1200\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	v, err := ReadInt(path)
	if err != nil || v != 1200 {
		t.Fatalf("ReadInt = %d, %v", v, err)
	}
	if err := WriteInt(path, 3500); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "3500" {
		t.Fatalf("写入内容应为无换行的 3500, 实际 %q", string(data))
	}
}

func TestReadIntErrors(t *testing.T) {
	dir := t.TempDir()
	if _, err := ReadInt(filepath.Join(dir, "缺失")); err == nil {
		t.Fatal("缺失文件应报错")
	}
	empty := filepath.Join(dir, "empty")
	_ = os.WriteFile(empty, []byte("  \n"), 0o644)
	if _, err := ReadInt(empty); err == nil {
		t.Fatal("空内容应报错")
	}
	bad := filepath.Join(dir, "bad")
	_ = os.WriteFile(bad, []byte("abc"), 0o644)
	if _, err := ReadInt(bad); err == nil {
		t.Fatal("非整数应报错")
	}
}

// 与旧 shell 版 update_all 的整除语义对齐
func TestStepsMatchesShellSemantics(t *testing.T) {
	seq := Steps(100, 3500, 50)
	if len(seq) != 51 {
		t.Fatalf("序列长度应为 steps+1=51, 实际 %d", len(seq))
	}
	if seq[0] != 168 { // 100 + (3400/50)
		t.Fatalf("首步应为 168, 实际 %d", seq[0])
	}
	if seq[len(seq)-1] != 3500 {
		t.Fatalf("末值应为目标值 3500, 实际 %d", seq[len(seq)-1])
	}
	// 整除时末值会与兜底写入重复一次（与旧脚本一致），故用非递减断言
	for i := 1; i < len(seq); i++ {
		if seq[i] < seq[i-1] {
			t.Fatalf("序列应非递减: %v", seq)
		}
	}
}

func TestStepsZeroDiffWritesTargetOnce(t *testing.T) {
	if seq := Steps(2000, 2000, 50); len(seq) != 1 || seq[0] != 2000 {
		t.Fatalf("差值为 0 应直接写目标值: %v", seq)
	}
	// 差值小于步数时整除为 0
	if seq := Steps(2000, 2010, 50); len(seq) != 1 || seq[0] != 2010 {
		t.Fatalf("步长整除为 0 应直接写目标值: %v", seq)
	}
}

func TestStepsNegativeDirection(t *testing.T) {
	seq := Steps(3500, 100, 50)
	if len(seq) != 51 || seq[len(seq)-1] != 100 {
		t.Fatalf("下降渐变末值应为 100: %v", seq)
	}
	for i := 1; i < len(seq); i++ {
		if seq[i] > seq[i-1] {
			t.Fatalf("下降序列应非递增: %v", seq)
		}
	}
}

func TestStepsRemainderEndsAtTarget(t *testing.T) {
	// 100/30 = 3 整除，最后一步只到 90，需兜底补 100
	seq := Steps(0, 100, 30)
	if seq[len(seq)-2] != 90 || seq[len(seq)-1] != 100 {
		t.Fatalf("末两步应为 90,100, 实际 %v", seq[len(seq)-2:])
	}
}

func TestStepsNonPositiveStepsFallsBackToTarget(t *testing.T) {
	for _, steps := range []int{0, -5} {
		if seq := Steps(100, 500, steps); len(seq) != 1 || seq[0] != 500 {
			t.Fatalf("steps=%d 应直接写目标值: %v", steps, seq)
		}
	}
}

func TestRampWritesSequenceAndCallsOnStep(t *testing.T) {
	path := filepath.Join(t.TempDir(), "brightness")
	if err := os.WriteFile(path, []byte("100"), 0o644); err != nil {
		t.Fatal(err)
	}

	var values []int
	err := Ramp(path, 100, 400, 3, time.Millisecond, func(step, value int) {
		values = append(values, value)
	})
	if err != nil {
		t.Fatal(err)
	}
	// stepValue = 100: 200, 300, 400，末尾再兜底写一次 400（与旧脚本一致）
	want := []int{200, 300, 400, 400}
	if len(values) != len(want) {
		t.Fatalf("回调次数应为 %d, 实际 %v", len(want), values)
	}
	for i := range want {
		if values[i] != want[i] {
			t.Fatalf("序列不匹配: 期望 %v, 实际 %v", want, values)
		}
	}
	if got, _ := ReadInt(path); got != 400 {
		t.Fatalf("末值应为 400, 实际 %d", got)
	}
}

func TestRampReportsWriteError(t *testing.T) {
	// 指向不存在的目录，写入应失败
	err := Ramp(filepath.Join(t.TempDir(), "不存在", "node"), 0, 100, 5, 0, nil)
	if err == nil {
		t.Fatal("写入失败应返回错误")
	}
}

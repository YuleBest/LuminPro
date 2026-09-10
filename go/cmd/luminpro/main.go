// 命令 luminpro 是 LuminPro 模块的 Go 实现入口。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/YuleBest/LuminPro/go/internal/api"
	"github.com/YuleBest/LuminPro/go/internal/brightness"
	"github.com/YuleBest/LuminPro/go/internal/config"
	"github.com/YuleBest/LuminPro/go/internal/daemon"
	"github.com/YuleBest/LuminPro/go/internal/logging"
	"github.com/YuleBest/LuminPro/go/internal/system"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "luminpro: "+err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	moduleDir, err := resolveModuleDir()
	if err != nil {
		return err
	}
	paths := api.DefaultPaths(moduleDir)
	log := logging.New(paths.LogFile, config.DefaultLogLevel, config.DefaultLogMaxSize)

	switch args[0] {
	case "daemon":
		d, err := daemon.New(paths, daemon.Deps{
			AutoBrightness: system.AutoBrightness{Runner: system.ExecRunner{}},
			Focus:          system.Focus{Runner: system.ExecRunner{}},
			HDR:            system.HdrRatio{Runner: system.ExecRunner{}},
			Log:            log,
		})
		if err != nil {
			return err
		}
		return d.Run()
	case "boost":
		return daemon.Boost(paths, log)
	case "restart":
		self, err := os.Executable()
		if err != nil {
			return err
		}
		return daemon.Restart(paths, self, log)
	case "status":
		return runStatus(paths, args[1:])
	case "oplock":
		return emitJSON(api.ReadOplock(paths.Oplock))
	case "brightness":
		return runBrightness(paths, args[1:])
	case "config":
		return runConfig(paths, args[1:])
	case "log":
		return runLog(paths, args[1:])
	case "help", "-h", "--help":
		return usage()
	default:
		return fmt.Errorf("未知子命令: %s", args[0])
	}
}

func usage() error {
	fmt.Print(`luminpro - LuminPro 模块守护进程

用法:
  luminpro daemon               启动守护进程（监听亮度节点并自动提升）
  luminpro boost                一键提升到峰值亮度 / 再次调用恢复
  luminpro restart              重启模块（daemon 未运行时按需拉起）

  luminpro status [--no-display]    聚合状态（JSON）
  luminpro oplock                   操作锁状态（JSON）
  luminpro brightness set <值>       设置亮度（JSON）

  luminpro config <操作>            配置管理（JSON）
    read | patch(stdin JSON) | get <key> | set k=v [...] | summary
    init | ensure | inspect <旧目录> | migrate <旧目录> [目标] | remove-old-txt <旧目录>

  luminpro log <操作>
    tail [-n 行数] [--raw] | clear | export [目录]

模块目录默认由可执行文件位置推导，可用环境变量 LUMINPRO_MODDIR 覆盖（调试用）。
`)
	return nil
}

// resolveModuleDir 推导模块根目录：<module>/bin/luminpro -> <module>。
func resolveModuleDir() (string, error) {
	if v := os.Getenv("LUMINPRO_MODDIR"); v != "" {
		return v, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(filepath.Dir(exe)), nil
}

// emitJSON 输出 JSON（不转义 HTML，供前端直接解析）。
func emitJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func runStatus(paths api.Paths, args []string) error {
	includeDisplay := true
	for _, arg := range args {
		if arg == "--no-display" {
			includeDisplay = false
		}
	}
	cfg, err := config.Load(paths.ConfigFile)
	if err != nil {
		return err
	}
	status := api.BuildStatus(paths, cfg, api.StatusDeps{
		AutoBrightness: system.AutoBrightness{Runner: system.ExecRunner{}},
		HDR:            system.HdrRatio{Runner: system.ExecRunner{}},
		Now:            time.Now,
	}, api.StatusOptions{IncludeDisplay: includeDisplay})
	return emitJSON(status)
}

func runBrightness(paths api.Paths, args []string) error {
	if len(args) < 2 || args[0] != "set" {
		return errors.New("用法: luminpro brightness set <值>")
	}
	value, err := strconv.Atoi(strings.TrimSpace(args[1]))
	if err != nil {
		return fmt.Errorf("亮度值必须是整数: %q", args[1])
	}
	if value < 0 {
		return errors.New("亮度值不能为负")
	}
	cfg, err := config.Load(paths.ConfigFile)
	if err != nil {
		return err
	}
	if max, err := brightness.ReadInt(cfg.MaxBriFile); err == nil && max > 0 && value > max {
		return fmt.Errorf("亮度值需在 0~%d 之间", max)
	}
	if !api.FileExists(cfg.NowBriFile) {
		return fmt.Errorf("亮度节点不存在: %s", cfg.NowBriFile)
	}

	if err := os.MkdirAll(paths.PIDDir, 0o755); err != nil {
		return err
	}
	if err := api.WriteOplock(paths.Oplock, api.KindManual); err != nil {
		return err
	}
	defer api.RemoveOplock(paths.Oplock)

	if err := brightness.WriteInt(cfg.NowBriFile, value); err != nil {
		return err
	}
	return emitJSON(map[string]any{"ok": true, "value": value})
}

func runLog(paths api.Paths, args []string) error {
	if len(args) == 0 {
		return errors.New("用法: luminpro log tail|clear|export")
	}
	switch args[0] {
	case "tail":
		lines, raw := 100, false
		for i := 1; i < len(args); i++ {
			switch {
			case args[i] == "--raw":
				raw = true
			case args[i] == "-n" && i+1 < len(args):
				if n, err := strconv.Atoi(args[i+1]); err == nil {
					lines = n
				}
				i++
			case strings.HasPrefix(args[i], "-n="):
				if n, err := strconv.Atoi(strings.TrimPrefix(args[i], "-n=")); err == nil {
					lines = n
				}
			}
		}
		page, err := api.TailLog(paths.LogFile, lines, raw)
		if err != nil {
			return err
		}
		return emitJSON(page)
	case "clear":
		if err := api.ClearLog(paths.LogFile); err != nil {
			return err
		}
		return emitJSON(map[string]any{"ok": true})
	case "export":
		dir := "/sdcard"
		if len(args) > 1 {
			dir = args[1]
		}
		path, err := api.ExportLog(paths.LogFile, dir)
		if err != nil {
			return err
		}
		return emitJSON(map[string]any{"ok": true, "path": path})
	default:
		return fmt.Errorf("未知 log 操作: %s", args[0])
	}
}

func runConfig(paths api.Paths, args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "init":
		return config.Init(paths.ConfigFile)
	case "ensure":
		return config.Ensure(paths.ConfigFile)
	case "read":
		cfg, err := config.Load(paths.ConfigFile)
		if err != nil {
			return err
		}
		data, err := cfg.JSON()
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(append(data, '\n'))
		return err
	case "patch":
		input, err := io.ReadAll(os.Stdin)
		if err != nil {
			return err
		}
		var patch map[string]json.RawMessage
		if err := json.Unmarshal(input, &patch); err != nil {
			return fmt.Errorf("补丁必须是 JSON 对象: %w", err)
		}
		if err := config.Patch(paths.ConfigFile, patch); err != nil {
			return err
		}
		return emitJSON(map[string]any{"ok": true, "patched": len(patch)})
	case "set":
		if len(args) < 2 {
			return errors.New("set 需要至少一个 key=value")
		}
		if err := config.Set(paths.ConfigFile, args[1:]); err != nil {
			return err
		}
		return emitJSON(map[string]any{"ok": true})
	case "get":
		if len(args) < 2 {
			return errors.New("get 需要字段名")
		}
		cfg, err := config.Load(paths.ConfigFile)
		if err != nil {
			return err
		}
		value, ok := cfg.Get(args[1])
		if !ok {
			return fmt.Errorf("未知字段: %s", args[1])
		}
		fmt.Println(value)
		return nil
	case "summary":
		cfg, err := config.Load(paths.ConfigFile)
		if err != nil {
			return err
		}
		printMap(cfg.Summary())
		return nil
	case "inspect":
		if len(args) < 2 {
			return errors.New("inspect 需要旧配置目录")
		}
		old, ok := config.InspectOld(args[1])
		if !ok {
			return errors.New("未找到可迁移的旧配置")
		}
		printOld(old)
		return nil
	case "migrate":
		if len(args) < 2 {
			return errors.New("migrate 需要旧配置目录")
		}
		target := paths.ConfigFile
		if len(args) >= 3 {
			target = args[2]
		}
		old, err := config.MigrateOld(args[1], target)
		if err != nil {
			return err
		}
		printOld(old)
		return nil
	case "remove-old-txt":
		if len(args) < 2 {
			return errors.New("remove-old-txt 需要旧配置目录")
		}
		return config.RemoveOldTxt(args[1])
	default:
		return fmt.Errorf("未知 config 操作: %s", args[0])
	}
}

// printOld 输出 key=value 行，供安装脚本读取展示。
func printOld(old config.OldConfig) {
	fmt.Printf("format=%s\n", old.Format)
	printMap(old.Values)
}

// printMap 按键排序输出 key=value 行。
func printMap(values map[string]string) {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("%s=%s\n", k, values[k])
	}
}

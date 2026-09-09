// 命令 luminpro 是 LuminPro 模块的 Go 实现入口。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"

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
	paths := daemon.DefaultPaths(moduleDir)
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
	case "config":
		return runConfig(paths, args[1:])
	case "help", "-h", "--help":
		return usage()
	default:
		return fmt.Errorf("未知子命令: %s", args[0])
	}
}

func usage() error {
	fmt.Print(`luminpro - LuminPro 模块守护进程

用法:
  luminpro daemon              启动守护进程（监听亮度节点并自动提升）
  luminpro boost               一键提升到峰值亮度 / 再次调用恢复
  luminpro restart             重启模块（daemon 未运行时按需拉起）
  luminpro config <操作>       配置管理
    init                       写入默认配置（已存在则补齐字段）
    ensure                     补齐缺失字段
    set key=value [...]        写入字段（按字段类型编码）
    inspect <旧目录>           输出旧配置字段（key=value 行）
    migrate <旧目录> [目标]    迁移旧配置
    remove-old-txt <旧目录>    删除旧版 txt 配置

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

func runConfig(paths daemon.Paths, args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "init":
		return config.Init(paths.ConfigFile)
	case "ensure":
		return config.Ensure(paths.ConfigFile)
	case "set":
		if len(args) < 2 {
			return fmt.Errorf("set 需要至少一个 key=value")
		}
		return config.Set(paths.ConfigFile, args[1:])
	case "get":
		if len(args) < 2 {
			return fmt.Errorf("get 需要字段名")
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
			return fmt.Errorf("inspect 需要旧配置目录")
		}
		old, ok := config.InspectOld(args[1])
		if !ok {
			return fmt.Errorf("未找到可迁移的旧配置")
		}
		printOld(old)
		return nil
	case "migrate":
		if len(args) < 2 {
			return fmt.Errorf("migrate 需要旧配置目录")
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
			return fmt.Errorf("remove-old-txt 需要旧配置目录")
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

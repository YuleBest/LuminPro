#!/system/bin/sh
#shellcheck shell=ash

# 默认设备路径（如果路径配置不存在）
DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"
DEFAULT_MAX_BRI_FILE="/sys/class/backlight/panel0-backlight/max_brightness"

mod_config="$MODPATH/config"
mod_path_config="$mod_config/path"
old_config="/data/adb/modules/LuminPro/config"
old_path_config="/data/adb/modules/LuminPro/config/path"

# 创建配置目录
[ -d "$mod_config" ] || mkdir -p "$mod_config"
[ -d "$mod_path_config" ] || mkdir -p "$mod_path_config"

# 获取设备路径函数
get_device_path() {
    local path_config="$1"
    local default_path="$2"

    if [ -f "$path_config" ]; then
        cat "$path_config"
    else
        echo "$default_path"
    fi
}

# 初始化全局变量（尝试读取配置，失败则使用默认值）
now_bri_file="$(get_device_path "$mod_path_config/now_bri_file.txt" "$DEFAULT_NOW_BRI_FILE")"
max_bri_file="$(get_device_path "$mod_path_config/max_bri_file.txt" "$DEFAULT_MAX_BRI_FILE")"

# 检查亮度节点文件
CHECK_FILES() {
    sleep 1

    # 策略：尝试从多个位置读取配置
    # 1. 首先从 $MODPATH（安装到设备上的目录）读取
    # 2. 然后从脚本所在目录读取（压缩包源）
    # 3. 最后使用默认值

    now_bri_file="$DEFAULT_NOW_BRI_FILE"
    max_bri_file="$DEFAULT_MAX_BRI_FILE"

    # 尝试从多个来源读取配置文件
    local now_sources="$mod_path_config/now_bri_file.txt $old_path_config/now_bri_file.txt"
    local max_sources="$mod_path_config/max_bri_file.txt $old_path_config/max_bri_file.txt"

    # 查找第一个存在的配置文件
    for source_file in $now_sources; do
        if [ -f "$source_file" ]; then
            now_bri_file="$(cat "$source_file")"
            echo "- 从 $source_file 读取了亮度节点路径"
            break
        fi
    done

    for source_file in $max_sources; do
        if [ -f "$source_file" ]; then
            max_bri_file="$(cat "$source_file")"
            echo "- 从 $source_file 读取了最大亮度节点路径"
            break
        fi
    done

    # 验证路径是否存在
    echo ""
    echo "- 尝试验证路径..."
    echo "  - 当前亮度节点: $now_bri_file"
    echo "  - 最大亮度节点: $max_bri_file"
    echo ""

    if [ -f "$now_bri_file" ] && [ -f "$max_bri_file" ]; then
        echo "✓ 找到亮度节点文件"
    else
        echo "x 未找到亮度节点文件"
        if [ ! -f "$now_bri_file" ]; then
            echo "  ✗ 当前亮度节点不存在: $now_bri_file"
        fi
        if [ ! -f "$max_bri_file" ]; then
            echo "  ✗ 最大亮度节点不存在: $max_bri_file"
        fi
        echo ""
        echo "设备不支持默认路径，需要修改配置"
        echo "修改方法："
        echo "  1. 编辑压缩包内的 config/path/now_bri_file.txt"
        echo "  2. 编辑压缩包内的 config/path/max_bri_file.txt"
        echo "  3. 添加你设备的正确亮度节点路径"
        echo "  4. 重新打包并刷入模块"
        echo ""
        echo "查找路径的方法："
        echo "  find /sys -name '*brightness*' 2>/dev/null | grep -E '(brightness|lcd)'"
        abort "x 安装中止：无法找到设备亮度节点"
    fi

    now_bri="$(cat "$now_bri_file")"
    max_bri="$(cat "$max_bri_file")"

    echo "✓ 当前亮度: $now_bri"
    echo "✓ 最大亮度: $max_bri"
}

# 监听音量键函数
button_listener() {
    local choose
    local branch
    while :; do
        choose="$(getevent -qlc 1 | awk '{ print $3 }')"
        case "$choose" in
        KEY_VOLUMEUP) branch="0" ;;
        KEY_VOLUMEDOWN) branch="1" ;;
        *) continue ;;
        esac
        echo "$branch"
        break
    done
}

# 注意事项
SHOW_CHANGELOG() {
    local changelog_file="$MODPATH/changelog.md"
    if [ -f "$changelog_file" ]; then
        echo "--------------------------------------"
        echo "- 本次更新日志:"
        # 提取第一个二级标题及其内容，直到遇到下一个二级标题或文件结束
        # 使用更具兼容性的 awk 逻辑
        awk '/^## / { if (p) exit; p=1; print; next } p { print }' "$changelog_file"
        echo "--------------------------------------"
    fi
}

NOTE() {
    cat "$MODPATH/NOTE.txt"
    echo ""
    echo "* 按音量 + 进入下一步, 按音量 - 退出"
    echo "* 继续则表明你已理解并接受所有风险"

    if [ "$(button_listener)" = "0" ]; then
        echo "- 已确认进入下一步"
    else
        abort "- 已退出"
    fi
}

# 测试前台最大亮度
TEST_UI_MAX_BRI() {
    echo ""
    echo "- 开始测试前台最大亮度"
    echo ""

    sleep 1
    echo "******** 请关闭自动亮度 ********"
    echo "* 按音量 + 进入下一步, 按音量 - 退出"

    if [ "$(button_listener)" = "0" ]; then
        echo "- 已确认进入下一步"
    else
        abort "- 已退出"
    fi

    # 调整亮度前, 记录当前亮度用于之后恢复
    restore_bri="$(cat "$now_bri_file")"
    echo ""

    sleep 1
    echo "******** 请将屏幕亮度调至最大 ********"
    echo "* 按音量 + 进入下一步, 按音量 - 退出"

    if [ "$(button_listener)" = "0" ]; then
        echo "- 已确认进入下一步"
    else
        abort "- 已退出"
    fi

    ui_max_bri="$(cat "$now_bri_file")"
    echo "- 前台最大亮度: [ $ui_max_bri ]"
    echo -n "$ui_max_bri" >"$mod_config/ui_max_bri.txt"

    echo ""
    echo "- 峰值最大亮度由节点文件获得: [ $max_bri ]"
    echo "- 若不符合预期, 请稍后到配置文件或 Web UI 更改"
    echo -n "$max_bri" >"$mod_config/max_bri.txt"

    echo ""
    echo "- 测试完成"
    echo "- 正在为你恢复亮度..."
    echo -n "$restore_bri" >"$now_bri_file"
}

# 结束
END() {
    echo ""
    sleep 1
    echo "******** 模块策略:"
    echo "- 当亮度达到 [ $(cat "$mod_config/ui_max_bri.txt") ] 时, 自动提升至 [ $(cat "$mod_config/max_bri.txt") ]"
    echo "- 配置目录: /data/adb/modules/LuminPro/config"
    echo "- 也可以使用 Web UI 进行配置"

    echo ""
    echo "* 模块已刷入, 请重启手机"
    echo "- 感谢您的使用"
    echo "- 作者: 酷安 @于乐yule"
    echo ""

    sleep 1
    exit 0
}

# 导入旧配置
IMPORT_OLD_CONFIG() {
    if [ -d "$old_config" ] &&
        [ -s "$old_config/ui_max_bri.txt" ] &&
        [ -s "$old_config/max_bri.txt" ]; then

        echo ""
        sleep 1
        echo "- 检测到已有配置:"
        echo "  - 前台最大亮度: $(cat "$old_config/ui_max_bri.txt")"
        echo "  - 峰值最大亮度: $(cat "$old_config/max_bri.txt")"
        if [ -s "$old_config/sleep_time.txt" ]; then
            echo "  - 休眠时间: $(cat "$old_config/sleep_time.txt")"
        fi
        if [ -s "$old_config/auto_bri_sleep.txt" ]; then
            echo "  - 自动亮度时休眠: $(cat "$old_config/auto_bri_sleep.txt" | sed 's/1/开启/;s/0/关闭/')"
        fi
        if [ -s "$old_config/steps_num.txt" ]; then
            echo "  - 亮度提升步数: $(cat "$old_config/steps_num.txt")"
        fi
        if [ -s "$old_config/log_max_size.txt" ]; then
            echo "  - 日志大小限制: $(cat "$old_config/log_max_size.txt") KB"
        fi
        if [ -s "$old_config/sleep_time.txt" ]; then
            echo "  - 休眠时间: $(cat "$old_config/sleep_time.txt")"
        fi
        echo ""
        echo "* 按音量 + 沿用旧配置, 按音量 - 重新测试"

        if [ "$(button_listener)" = "0" ]; then
            echo "- 已沿用旧配置"
            cp -f "$old_config/ui_max_bri.txt" "$mod_config/"
            cp -f "$old_config/max_bri.txt" "$mod_config/"
            [ -e "$old_config/sleep_time.txt" ] && cp -f "$old_config/sleep_time.txt" "$mod_config/" || echo "1900-0600" >"$mod_config/sleep_time.txt"
            [ -s "$old_config/auto_bri_sleep.txt" ] && cp -f "$old_config/auto_bri_sleep.txt" "$mod_config/"
            [ -s "$old_config/steps_num.txt" ] && cp -f "$old_config/steps_num.txt" "$mod_config/"
            [ -s "$old_config/log_max_size.txt" ] && cp -f "$old_config/log_max_size.txt" "$mod_config/"

            # 迁移旧的路径配置（如果存在）
            mkdir -p "$mod_path_config"
            if [ -d "$old_path_config" ]; then
                [ -s "$old_path_config/now_bri_file.txt" ] && cp -f "$old_path_config/now_bri_file.txt" "$mod_path_config/"
                [ -s "$old_path_config/max_bri_file.txt" ] && cp -f "$old_path_config/max_bri_file.txt" "$mod_path_config/"
            else
                # 创建默认路径配置
                echo -n "$DEFAULT_NOW_BRI_FILE" >"$mod_path_config/now_bri_file.txt"
                echo -n "$DEFAULT_MAX_BRI_FILE" >"$mod_path_config/max_bri_file.txt"
            fi

            # 版本迁移逻辑
            local old_version_code
            old_version_code="$(grep_get_prop versionCode "/data/adb/modules/LuminPro/module.prop")"
            if [ "$old_version_code" = "2101" ] && [ ! -d "$old_config/.backup" ]; then
                echo "- 检测到从 2101 版本升级, 正在补全备份目录..."
                mkdir -p "$mod_config/.backup"
                cp -f "$mod_config/"*.txt "$mod_config/.backup/" 2>/dev/null
            else
                # 正常备份同步
                mkdir -p "$mod_config/.backup"
                [ -d "$old_config/.backup" ] && cp -rf "$old_config/.backup/." "$mod_config/.backup/"
            fi
            return 0
        else
            echo "- 将重新测试"
            return 1
        fi
    fi
    return 1
}

# 初始化默认配置文件
INIT_CONFIG() {
    mkdir -p "$mod_config"
    mkdir -p "$mod_path_config"

    # 仅在文件不存在时才创建，保留任何已存在的配置
    [ ! -f "$mod_config/ui_max_bri.txt" ] && touch "$mod_config/ui_max_bri.txt"
    [ ! -f "$mod_config/max_bri.txt" ] && touch "$mod_config/max_bri.txt"
    [ ! -f "$mod_config/sleep_time.txt" ] && touch "$mod_config/sleep_time.txt"
    [ ! -f "$mod_config/auto_bri_sleep.txt" ] && touch "$mod_config/auto_bri_sleep.txt"
    [ ! -f "$mod_config/steps_num.txt" ] && touch "$mod_config/steps_num.txt"
    [ ! -f "$mod_config/log_max_size.txt" ] && touch "$mod_config/log_max_size.txt"

    # 初始化设备路径配置 (仅在文件不存在时使用默认值，保留用户自定义配置)
    [ ! -f "$mod_path_config/now_bri_file.txt" ] && echo -n "$DEFAULT_NOW_BRI_FILE" >"$mod_path_config/now_bri_file.txt"
    [ ! -f "$mod_path_config/max_bri_file.txt" ] && echo -n "$DEFAULT_MAX_BRI_FILE" >"$mod_path_config/max_bri_file.txt"
}

# 补全缺失设置并设定默认值
ENSURE_DEFAULTS() {
    [ ! -s "$mod_config/sleep_time.txt" ] && echo "1900-0600" >"$mod_config/sleep_time.txt"
    [ ! -s "$mod_config/auto_bri_sleep.txt" ] && echo "1" >"$mod_config/auto_bri_sleep.txt"
    [ ! -s "$mod_config/steps_num.txt" ] && echo "50" >"$mod_config/steps_num.txt"
    [ ! -s "$mod_config/log_max_size.txt" ] && echo "500" >"$mod_config/log_max_size.txt"
}

# 创建备份 (用于 WebUI 恢复默认)
CREATE_BACKUP() {
    mkdir -p "$mod_config/.backup"
    cp -f "$mod_config/ui_max_bri.txt" "$mod_config/.backup/"
    cp -f "$mod_config/max_bri.txt" "$mod_config/.backup/"
    cp -f "$mod_config/sleep_time.txt" "$mod_config/.backup/"
    cp -f "$mod_config/auto_bri_sleep.txt" "$mod_config/.backup/"
    cp -f "$mod_config/steps_num.txt" "$mod_config/.backup/"
    cp -f "$mod_config/log_max_size.txt" "$mod_config/.backup/"
}

# 主函数
MAIN() {
    NOTE
    SHOW_CHANGELOG
    if ! IMPORT_OLD_CONFIG; then
        INIT_CONFIG
        CHECK_FILES
        TEST_UI_MAX_BRI
    fi
    ENSURE_DEFAULTS
    CREATE_BACKUP
    END
}

MAIN

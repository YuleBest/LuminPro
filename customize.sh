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

# ==========================
# 配置读取函数
# ==========================
# 优先读取旧配置，其次读取默认配置
get_config_value() {
    local config_name="$1"
    local old_file="$old_config/$config_name"
    local new_file="$mod_config/$config_name"
    local default_value="$2"

    # 1. 检查旧配置是否存在且非空
    if [ -f "$old_file" ]; then
        local old_val
        old_val="$(cat "$old_file" 2>/dev/null | tr -d ' \n')"
        if [ -n "$old_val" ]; then
            echo "$old_val"
            return
        fi
    fi

    # 2. 检查默认配置是否存在且非空
    if [ -f "$new_file" ]; then
        local new_val
        new_val="$(cat "$new_file" 2>/dev/null | tr -d ' \n')"
        if [ -n "$new_val" ]; then
            echo "$new_val"
            return
        fi
    fi

    # 3. 返回默认值
    echo "$default_value"
}

# 获取设备路径函数（与 get_config_value 相同逻辑）
get_device_path() {
    local config_name="$1"
    local default_path="$2"
    get_config_value "$config_name" "$default_path"
}

# 初始化全局变量（优先读取旧配置，其次读取默认值）
now_bri_file="$(get_device_path "path/now_bri_file.txt" "$DEFAULT_NOW_BRI_FILE")"
max_bri_file="$(get_device_path "path/max_bri_file.txt" "$DEFAULT_MAX_BRI_FILE")"

# 检查亮度节点文件
CHECK_FILES() {
    sleep 1

    echo ""
    echo "[*] 正在验证设备亮度节点..."
    echo ""

    # 验证路径是否存在
    echo "- 当前亮度节点: $now_bri_file"
    echo "- 最大亮度节点: $max_bri_file"
    echo ""

    if [ -f "$now_bri_file" ] && [ -f "$max_bri_file" ]; then
        echo "[OK] 找到亮度节点文件"
    else
        echo "[X] 未找到亮度节点文件"
        if [ ! -f "$now_bri_file" ]; then
            echo "    - 当前亮度节点不存在: $now_bri_file"
        fi
        if [ ! -f "$max_bri_file" ]; then
            echo "    - 最大亮度节点不存在: $max_bri_file"
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
        abort "[X] 安装中止：无法找到设备亮度节点"
    fi

    now_bri="$(cat "$now_bri_file")"
    max_bri_sys="$(cat "$max_bri_file")"

    echo "[OK] 当前亮度: $now_bri"
    echo "[OK] 系统最大亮度: $max_bri_sys"
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
        echo "========================================"
        echo "[*] 本次更新日志:"
        # 提取第一个二级标题及其内容，直到遇到下一个二级标题或文件结束
        # 使用更具兼容性的 awk 逻辑
        awk '/^## / { if (p) exit; p=1; print; next } p { print }' "$changelog_file"
        echo "========================================"
    fi
}

NOTE() {
    cat "$MODPATH/NOTE.txt"
    echo ""
    echo "[i] 按音量 + 进入下一步, 按音量 - 退出"
    echo "[i] 继续则表明你已理解并接受所有风险"

    if [ "$(button_listener)" = "0" ]; then
        echo "[OK] 已确认进入下一步"
    else
        abort "[X] 已退出"
    fi
}

# 测试前台最大亮度
TEST_UI_MAX_BRI() {
    echo ""
    echo "[*] 开始测试前台最大亮度"
    echo ""

    sleep 1
    echo "======== 请关闭自动亮度 ========"
    echo "[i] 按音量 + 进入下一步, 按音量 - 退出"

    if [ "$(button_listener)" = "0" ]; then
        echo "[OK] 已确认进入下一步"
    else
        abort "[X] 已退出"
    fi

    # 调整亮度前, 记录当前亮度用于之后恢复
    restore_bri="$(cat "$now_bri_file")"
    echo ""

    sleep 1
    echo "======== 请将屏幕亮度调至最大 ========"
    echo "[i] 按音量 + 进入下一步, 按音量 - 退出"

    if [ "$(button_listener)" = "0" ]; then
        echo "[OK] 已确认进入下一步"
    else
        abort "[X] 已退出"
    fi

    ui_max_bri="$(cat "$now_bri_file")"
    echo "[OK] 前台最大亮度: [ $ui_max_bri ]"

    # 保存到旧配置和新配置
    echo -n "$ui_max_bri" >"$old_config/ui_max_bri.txt"
    echo -n "$ui_max_bri" >"$mod_config/ui_max_bri.txt"

    echo ""
    echo "[i] 峰值最大亮度由节点文件获得: [ $max_bri_sys ]"
    echo "[i] 若不符合预期, 请稍后到配置文件或 Web UI 更改"

    # 保存到旧配置和新配置
    echo -n "$max_bri_sys" >"$old_config/max_bri.txt"
    echo -n "$max_bri_sys" >"$mod_config/max_bri.txt"

    echo ""
    echo "[OK] 测试完成"
    echo "[*] 正在为你恢复亮度..."
    echo -n "$restore_bri" >"$now_bri_file"
}

# 结束
END() {
    echo ""
    sleep 1

    # 读取最终配置
    local final_max_bri
    local final_ui_max_bri
    final_max_bri="$(get_config_value "max_bri.txt" "")"
    final_ui_max_bri="$(get_config_value "ui_max_bri.txt" "")"

    # 检查是否需要重新测试
    if [ -z "$final_max_bri" ] || [ -z "$final_ui_max_bri" ]; then
        echo ""
        echo "[!] ======== 配置不完整 ========"
        if [ -z "$final_max_bri" ]; then
            echo "[X] 峰值最大亮度: 未配置"
        else
            echo "[OK] 峰值最大亮度: $final_max_bri"
        fi
        if [ -z "$final_ui_max_bri" ]; then
            echo "[X] 前台最大亮度: 未配置"
        else
            echo "[OK] 前台最大亮度: $final_ui_max_bri"
        fi
        echo ""
        echo "[!] 检测到配置缺失，需要重新进行亮度测试。"
        echo "[i] 请在模块安装后的重启后，通过以下方式补全配置："
        echo "    1. 使用 Web UI 手工输入"
        echo "    2. 编辑配置文件: /data/adb/modules/LuminPro/config/"
        echo "    3. 重新刷入新的压缩包（会重新运行此脚本）"
        echo ""
        echo "[i] 或按音量 + 现在进行测试, 按音量 - 跳过"
        if [ "$(button_listener)" = "0" ]; then
            echo "[*] 正在进行测试..."
            TEST_UI_MAX_BRI
            final_max_bri="$(get_config_value "max_bri.txt" "")"
            final_ui_max_bri="$(get_config_value "ui_max_bri.txt" "")"
        fi
    fi

    echo ""
    echo "======== 模块策略 ========"
    echo "[*] 当亮度达到 [ $final_ui_max_bri ] 时，自动提升至 [ $final_max_bri ]"
    echo "[i] 配置目录: /data/adb/modules/LuminPro/config"
    echo "[i] 也可以使用 Web UI 进行配置"

    echo ""
    echo "[OK] 模块已刷入，请重启手机"
    echo "[i] 感谢您的使用"
    echo "[i] 作者: 酷安 @于乐yule"
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
        echo "[i] 检测到已有配置:"
        echo "    - 前台最大亮度: $(cat "$old_config/ui_max_bri.txt")"
        echo "    - 峰值最大亮度: $(cat "$old_config/max_bri.txt")"
        if [ -s "$old_config/sleep_time.txt" ]; then
            echo "    - 休眠时间: $(cat "$old_config/sleep_time.txt")"
        fi
        if [ -s "$old_config/auto_bri_sleep.txt" ]; then
            echo "    - 自动亮度时休眠: $(cat "$old_config/auto_bri_sleep.txt" | sed 's/1/开启/;s/0/关闭/')"
        fi
        if [ -s "$old_config/steps_num.txt" ]; then
            echo "    - 亮度提升步数: $(cat "$old_config/steps_num.txt")"
        fi
        if [ -s "$old_config/log_max_size.txt" ]; then
            echo "    - 日志大小限制: $(cat "$old_config/log_max_size.txt") KB"
        fi
        echo ""
        echo "[?] 按音量 + 沿用旧配置, 按音量 - 重新测试"

        if [ "$(button_listener)" = "0" ]; then
            echo "[OK] 已沿用旧配置"
            cp -f "$old_config/ui_max_bri.txt" "$mod_config/"
            cp -f "$old_config/max_bri.txt" "$mod_config/"
            if [ -e "$old_config/sleep_time.txt" ]; then
                cp -f "$old_config/sleep_time.txt" "$mod_config/"
            else
                touch "$mod_config/sleep_time.txt"
            fi
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
                echo "[i] 检测到从 2101 版本升级，正在补全备份目录..."
                mkdir -p "$mod_config/.backup"
                cp -f "$mod_config/"*.txt "$mod_config/.backup/" 2>/dev/null
            else
                # 正常备份同步
                mkdir -p "$mod_config/.backup"
                [ -d "$old_config/.backup" ] && cp -rf "$old_config/.backup/." "$mod_config/.backup/"
            fi
            return 0
        else
            echo "[*] 将重新测试"
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
    [ ! -f "$mod_config/sleep_time.txt" ] && touch "$mod_config/sleep_time.txt"
    [ ! -s "$mod_config/auto_bri_sleep.txt" ] && echo "1" >"$mod_config/auto_bri_sleep.txt"
    [ ! -s "$mod_config/steps_num.txt" ] && echo "50" >"$mod_config/steps_num.txt"
    [ ! -s "$mod_config/log_max_size.txt" ] && echo "500" >"$mod_config/log_max_size.txt"
}

# 机型兼容性校验
CHECK_DEVICE_COMPATIBILITY() {
    local model prefix
    model="$(getprop ro.product.model)"
    prefix="$(echo "$model" | cut -c 1-9)"

    if [ "$prefix" = "25128PNA1" ] || [ "$prefix" = "2512BPNDA" ]; then
        echo ""
        echo "[!] 您可能是 Xiaomi 17 Ultra 用户，建议您使用 '0' 事件作为监测对象，否则模块可能不生效"
        echo "[?] 是否将 inotifyd 监测事件修改为 '0'? (按音量 + 确认，按音量 - 跳过)"
        if [ "$(button_listener)" = "0" ]; then
            echo -n "0" >"$mod_config/inotify_events.txt"
            echo "[OK] 已设置为 0 事件监测"
        else
            echo "[*] 已跳过配置更改"
        fi
        sleep 1
    fi
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
    CHECK_DEVICE_COMPATIBILITY
    CREATE_BACKUP
    END
}

MAIN

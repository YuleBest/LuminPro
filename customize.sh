#!/system/bin/sh
#shellcheck shell=ash

now_bri_file="/sys/class/backlight/panel0-backlight/brightness"
max_bri_file="/sys/class/backlight/panel0-backlight/max_brightness"
mod_config="$MODPATH/config"
old_config="/data/adb/modules/LuminPro/config"

# 创建配置目录
[ -d "$mod_config" ] || mkdir -p "$mod_config"

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

# 检查亮度节点文件
CHECK_FILES() {
    sleep 1
    if [ -f "$now_bri_file" ] && [ -f "$max_bri_file" ]; then
        echo "- 找到亮度节点文件"
    else
        echo "x 未找到亮度节点文件"
        abort "x 暂不支持您的设备"
    fi

    now_bri="$(cat "$now_bri_file")"
    max_bri="$(cat "$max_bri_file")"

    echo "- 当前亮度: $now_bri"
    echo "- 最大亮度: $max_bri"
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
        echo ""
        echo "* 按音量 + 沿用旧配置, 按音量 - 重新测试"

        if [ "$(button_listener)" = "0" ]; then
            echo "- 已沿用旧配置"
            cp -f "$old_config/ui_max_bri.txt" "$mod_config/"
            cp -f "$old_config/max_bri.txt" "$mod_config/"
            [ -s "$old_config/sleep_time.txt" ] && cp -f "$old_config/sleep_time.txt" "$mod_config/"
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
    touch "$mod_config/ui_max_bri.txt"
    touch "$mod_config/max_bri.txt"
    touch "$mod_config/sleep_time.txt"
    echo "1900-0600" >"$mod_config/sleep_time.txt"
}

# 主函数
MAIN() {
    NOTE
    if ! IMPORT_OLD_CONFIG; then
        INIT_CONFIG
        CHECK_FILES
        TEST_UI_MAX_BRI
    fi
    END
}

MAIN

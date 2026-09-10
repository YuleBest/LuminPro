#!/system/bin/sh
#shellcheck shell=ash

# ==========================
# ARM64 架构检查
# ==========================
ARCH=$(getprop ro.product.cpu.abi)
if [ "$ARCH" != "arm64-v8a" ]; then
    ui_print "********************************"
    ui_print " 本模块仅支持 ARM64 设备！"
    ui_print " 当前架构: $ARCH"
    ui_print "********************************"
    abort "不支持的架构: $ARCH"
fi

# 默认设备路径
DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"
DEFAULT_MAX_BRI_FILE="/sys/class/backlight/panel0-backlight/max_brightness"

mod_config="$MODPATH/config"
old_config="/data/adb/modules/LuminPro/config"

# Go 二进制（已随模块提取），负责全部 JSON 配置读写
BIN="$MODPATH/bin/luminpro"
CONFIG_FILE="$mod_config/config.json"

mkdir -p "$mod_config"
chmod 755 "$BIN" 2>/dev/null

# 亮度节点校验结果: 1 = 默认节点不可用 (安装继续, 但功能不启用)
NODE_MISSING=0

# ==========================
# 工具函数
# ==========================

# 读取配置字段，缺失或为空时返回默认值
cfg_get() {
    local key="$1" default="$2" val
    val="$("$BIN" config get "$key" 2>/dev/null)"
    if [ -n "$val" ]; then
        echo "$val"
    else
        echo "$default"
    fi
}

# 取正值字段（0 视为未配置，输出空）
cfg_pos() {
    local v
    v="$(cfg_get "$1" 0)"
    case "$v" in
    '' | 0) echo "" ;;
    *) echo "$v" ;;
    esac
}

# 从 key=value 输出中提取字段（供 config inspect / summary 使用）
field() {
    sed -n "s/^$1=//p" | head -n 1
}

# 0/1 转中文
onoff() {
    [ "$1" = "1" ] && echo "开启" || echo "关闭"
}

# ==========================
# 安装流程函数
# ==========================

btn() {
    while :; do
        local c
        c="$(getevent -qlc 1 | awk '{ print $3 }')"
        case "$c" in
        KEY_VOLUMEUP)
            echo "0"
            return
            ;;
        KEY_VOLUMEDOWN)
            echo "1"
            return
            ;;
        esac
    done
}

SHOW_CHANGELOG() {
    local f="$MODPATH/changelog.md"
    [ -f "$f" ] || return
    echo "========================================"
    echo " ✦ 本次更新日志:"
    awk '/^## / { if (p) exit; p=1; print; next } p { print }' "$f"
    echo "========================================"
}

NOTE() {
    cat "$MODPATH/NOTE.txt"
    echo ""
    echo " ❆ 按音量 + 进入下一步, 按音量 - 退出"
    echo " ❆ 继续则表明你已理解并接受所有风险"
    [ "$(btn)" = "0" ] && echo " ✦ 已确认" || abort " ✗ 已退出"
}

CHECK_FILES() {
    sleep 1
    now_bri_file="$(cfg_get now_bri_file "$DEFAULT_NOW_BRI_FILE")"
    max_bri_file="$(cfg_get max_bri_file "$DEFAULT_MAX_BRI_FILE")"

    echo ""
    echo " ✦ 正在验证设备亮度节点..."
    echo " ✦ 当前亮度节点: $now_bri_file"
    echo " ✦ 最大亮度节点: $max_bri_file"
    echo ""

    if [ -f "$now_bri_file" ] && [ -f "$max_bri_file" ]; then
        echo " ✦ 找到亮度节点文件"
        echo " ✦ 当前亮度: $(cat "$now_bri_file")"
        echo " ✦ 系统最大亮度: $(cat "$max_bri_file")"
        return 0
    fi

    # 节点缺失不再中止安装: 继续安装, 但重启后功能不会启用 (见 service.sh)
    [ ! -f "$now_bri_file" ] && echo " ✗ 当前亮度节点不存在: $now_bri_file"
    [ ! -f "$max_bri_file" ] && echo " ✗ 最大亮度节点不存在: $max_bri_file"
    echo ""
    echo " ◇ 设备默认亮度节点不可用, 将继续安装但功能不会启用"
    echo " ◇ 安装后可在 Web UI 配置正确的亮度节点路径, 然后重启模块启用"
    echo " ◇ 查找路径: find /sys -name '*brightness*' 2>/dev/null"
    NODE_MISSING=1
    return 1
}

TEST_UI_MAX_BRI() {
    echo ""
    echo " ✿ 开始测试前台最大亮度"
    echo ""
    sleep 1

    echo "======== 请关闭自动亮度 ========"
    echo " ❆ 按音量 + 进入下一步, 按音量 - 退出"
    [ "$(btn)" = "0" ] && echo " ✦ 已确认" || abort " ✗ 已退出"

    local restore_bri
    restore_bri="$(cat "$now_bri_file")"
    echo ""
    sleep 1

    echo "======== 请将屏幕亮度调至最大 ========"
    echo " ❆ 按音量 + 进入下一步, 按音量 - 退出"
    [ "$(btn)" = "0" ] && echo " ✦ 已确认" || abort " ✗ 已退出"

    local measured_ui measured_max
    measured_ui="$(cat "$now_bri_file")"
    measured_max="$(cat "$max_bri_file")"
    echo " ✦ 前台最大亮度: [ $measured_ui ]"
    echo " ✦ 峰值最大亮度由节点文件获得: [ $measured_max ]"
    echo " ✦ 若不符合预期，请稍后到 Web UI 更改"

    "$BIN" config set "ui_max_bri=$measured_ui" "max_bri=$measured_max" >/dev/null 2>&1

    echo ""
    echo " ✦ 测试完成"
    echo " ✦ 正在恢复亮度..."
    echo -n "$restore_bri" >"$now_bri_file"
}

# 导入旧配置（支持 JSON 格式和旧 txt 格式）
IMPORT_OLD_CONFIG() {
    local out format v

    # 让 Go 侧判断是否存在可用旧配置并输出字段
    out="$("$BIN" config inspect "$old_config" 2>/dev/null)" || return 1
    format="$(echo "$out" | field format)"

    # 1. 已有 JSON 格式
    if [ "$format" = "json" ]; then
        echo ""
        sleep 1
        echo " ✦ 检测到已有 JSON 配置:"
        echo "    - 前台最大亮度: $(echo "$out" | field ui_max_bri)"
        echo "    - 峰值最大亮度: $(echo "$out" | field max_bri)"
        v="$(echo "$out" | field sleep_time)"
        [ -n "$v" ] && echo "    - 休眠时间: $v"
        echo ""
        echo " ❆ 按音量 + 沿用旧配置, 按音量 - 重新测试"
        if [ "$(btn)" = "0" ]; then
            "$BIN" config migrate "$old_config" >/dev/null 2>&1
            echo " ✦ 已导入 JSON 配置"
            return 0
        fi
        echo " ❆ 将重新测试"
        return 1
    fi

    # 2. 旧 txt 格式迁移
    if [ "$format" = "txt" ]; then
        echo ""
        sleep 1
        echo " ✦ 检测到旧格式配置，将迁移至 JSON:"
        echo "    - 前台最大亮度: $(echo "$out" | field ui_max_bri)"
        echo "    - 峰值最大亮度: $(echo "$out" | field max_bri)"
        v="$(echo "$out" | field sleep_time)"
        [ -n "$v" ] && echo "    - 休眠时间: $v"
        v="$(echo "$out" | field auto_bri_sleep)"
        [ -n "$v" ] && echo "    - 自动亮度时休眠: $(onoff "$v")"
        v="$(echo "$out" | field steps_num)"
        [ -n "$v" ] && echo "    - 亮度步数: $v"
        v="$(echo "$out" | field log_max_size)"
        [ -n "$v" ] && echo "    - 日志限制: $v KB"
        v="$(echo "$out" | field blacklist_count)"
        [ "$v" != "0" ] && [ -n "$v" ] && echo "    - 黑名单: $v 个"
        echo ""
        echo " ❆ 按音量 + 沿用旧配置, 按音量 - 重新测试"
        if [ "$(btn)" = "0" ]; then
            "$BIN" config migrate "$old_config" >/dev/null 2>&1
            "$BIN" config remove-old-txt "$old_config" >/dev/null 2>&1
            echo " ✦ 配置已迁移至 JSON, 旧文件已清理"
            return 0
        fi
        echo " ❆ 将重新测试"
        return 1
    fi

    return 1
}

# 初始化默认配置
INIT_CONFIG() {
    mkdir -p "$mod_config"
    "$BIN" config init 2>/dev/null
}

# 补全缺失字段
ENSURE_DEFAULTS() {
    "$BIN" config ensure 2>/dev/null
}

# 机型兼容性校验
CHECK_DEVICE_COMPATIBILITY() {
    local model prefix
    model="$(getprop ro.product.model)"
    prefix="$(echo "$model" | cut -c 1-9)"

    if [ "$prefix" = "25128PNA1" ] || [ "$prefix" = "2512BPNDA" ]; then
        echo ""
        echo "  ✿ 您可能是 Xiaomi 17 Ultra 用户，建议使用 '0' 事件作为监测对象"
        echo "  ✿ 是否将监听事件修改为 '0'? (音量 + 确认，音量 - 跳过)"
        if [ "$(btn)" = "0" ]; then
            "$BIN" config set inotify_events=0 >/dev/null 2>&1
            echo " ✦ 已设置为 0 事件监测"
        else
            echo " ✦ 已跳过"
        fi
        sleep 1
    fi
}

# 创建备份（供 WebUI 恢复默认用）
CREATE_BACKUP() {
    mkdir -p "$mod_config/.backup"
    cp -f "$CONFIG_FILE" "$mod_config/.backup/config.json"
}

END() {
    echo ""
    sleep 1

    local summary
    summary="$("$BIN" config summary 2>/dev/null)"

    # 确保 now_bri_file / max_bri_file 已设置（import 路径可能未调用 CHECK_FILES）
    : "${now_bri_file:=$(cfg_get now_bri_file "$DEFAULT_NOW_BRI_FILE")}"
    : "${max_bri_file:=$(cfg_get max_bri_file "$DEFAULT_MAX_BRI_FILE")}"

    local final_ui final_max
    final_ui="$(cfg_pos ui_max_bri)"
    final_max="$(cfg_pos max_bri)"

    if [ -z "$final_max" ] || [ -z "$final_ui" ]; then
        if [ "$NODE_MISSING" = "1" ]; then
            echo ""
            echo "======== 亮度节点不可用 ========"
            echo " ✕ 已跳过亮度校准 (节点不存在, 无法读写亮度)"
            echo " ❆ 安装后请在 Web UI 配置亮度节点路径并校准亮度值"
            echo " ❆ 配置完成后点击「重启模块」即可启用模块功能"
        else
            echo ""
            echo "======== 配置不完整 ========"
            [ -z "$final_max" ] && echo " ✕ 峰值最大亮度: 未配置" || echo " ✦ 峰值最大亮度: $final_max"
            [ -z "$final_ui" ] && echo " ✕ 前台最大亮度: 未配置" || echo " ✦ 前台最大亮度: $final_ui"
            echo ""
            echo " ❆ 配置缺失, 请重启后通过 Web UI 手动配置"
            echo " ❆ 或按音量 + 现在进行测试, 按音量 - 跳过"
            if [ "$(btn)" = "0" ]; then
                TEST_UI_MAX_BRI
                final_ui="$(cfg_pos ui_max_bri)"
                final_max="$(cfg_pos max_bri)"
                summary="$("$BIN" config summary 2>/dev/null)"
            fi
        fi
    fi

    local steps log_size auto_bri disp_hdr st inotify bl_count now_path max_path
    steps="$(echo "$summary" | field steps_num)"
    log_size="$(echo "$summary" | field log_max_size)"
    auto_bri="$(echo "$summary" | field auto_bri_sleep)"
    disp_hdr="$(echo "$summary" | field display_hdr_sleep)"
    st="$(echo "$summary" | field sleep_time)"
    inotify="$(echo "$summary" | field inotify_events)"
    now_path="$(echo "$summary" | field now_bri_file)"
    max_path="$(echo "$summary" | field max_bri_file)"
    bl_count="$(echo "$summary" | field blacklist_count)"

    echo ""
    echo "======== 将要应用的配置 ========"
    echo " - 前台最大亮度:   $final_ui"
    echo " - 峰值最大亮度:   $final_max"
    echo " - 亮度渐变步数:   $steps"
    echo " - 日志大小上限:   ${log_size} KB"
    echo " - 自动亮度时跳过: $(onoff "$auto_bri")"
    echo " - HDR 内容时跳过: $(onoff "$disp_hdr")"
    echo " - 兼容模式 (轮询): $(onoff "$(echo "$summary" | field compatibility_mode)")"
    if [ -n "$st" ]; then
        echo " - 休眠时段:       $st"
    else
        echo " - 休眠时段:       未配置"
    fi
    echo " - 监听事件:  $inotify"
    echo " - 当前亮度节点:   $now_path"
    echo " - 最大亮度节点:   $max_path"
    [ ! -f "$now_path" ] && echo " ⚠ 当前亮度节点不存在, 重启后功能将不会启用"
    echo " - 黑名单应用:     ${bl_count} 个"
    echo "==============================="
    echo " ❆ 配置文件: /data/adb/modules/LuminPro/config/config.json"
    echo " ❆ 也可以使用 Web UI 进行配置"
    if [ "$NODE_MISSING" = "1" ]; then
        echo ""
        echo "======== ⚠ 模块功能未启用 ========"
        echo " ✗ 设备默认亮度节点不可用, 本次安装不会开启亮度提升"
        echo " ❆ 请在 Web UI「配置」中填写正确的亮度节点路径并保存"
        echo " ❆ 然后点击「重启模块」即可启用, 无需重新刷入"
    fi
    echo ""
    echo " ✦ 模块已刷入，请重启手机"
    echo " ❆ 感谢您的使用"
    echo " ❆ 作者: 酷安 @于乐yule"
    echo ""
    sleep 1
    exit 0
}

MAIN() {
    NOTE
    SHOW_CHANGELOG
    if ! IMPORT_OLD_CONFIG; then
        INIT_CONFIG
        CHECK_FILES
        if [ "$NODE_MISSING" = "1" ]; then
            echo ""
            echo " ⚠ 亮度节点不可用, 跳过亮度校准"
        else
            TEST_UI_MAX_BRI
        fi
    fi
    ENSURE_DEFAULTS
    CHECK_DEVICE_COMPATIBILITY
    CREATE_BACKUP
    END
}

MAIN

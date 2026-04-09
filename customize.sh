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

# jq 二进制（已随模块提取）
JQ="$MODPATH/bin/jq"
CONFIG_FILE="$mod_config/config.json"

mkdir -p "$mod_config"
chmod 755 "$JQ" 2>/dev/null

# ==========================
# 工具函数
# ==========================

# 从当前 config.json 读取字段值
cfg_get() {
    local key="$1" default="$2"
    local val
    if val=$("$JQ" -re ".${key}" "$CONFIG_FILE" 2>/dev/null); then
        echo "$val"
    else
        echo "$default"
    fi
}

# 从旧 txt 文件读取值（迁移用）
read_old_txt() {
    local file="$old_config/$1"
    local default="$2"
    if [ -f "$file" ]; then
        local val
        val="$(cat "$file" 2>/dev/null | tr -d ' \n')"
        [ -n "$val" ] && echo "$val" || echo "$default"
    else
        echo "$default"
    fi
}

# 用 cfg_* 变量写入 config.json
write_config_json() {
    "$JQ" -n \
        --arg ui_max_bri "${cfg_ui_max_bri:-0}" \
        --arg max_bri "${cfg_max_bri:-0}" \
        --arg steps_num "${cfg_steps_num:-50}" \
        --arg log_max_size "${cfg_log_max_size:-512}" \
        --arg auto_bri_sleep "${cfg_auto_bri_sleep:-1}" \
        --arg display_hdr_sleep "${cfg_display_hdr_sleep:-0}" \
        --arg sleep_time "${cfg_sleep_time:-}" \
        --arg inotify_events "${cfg_inotify_events:-c}" \
        --arg now_bri_file "${cfg_now_bri_file:-$DEFAULT_NOW_BRI_FILE}" \
        --arg max_bri_file "${cfg_max_bri_file:-$DEFAULT_MAX_BRI_FILE}" \
        --argjson blacklist_apps "${cfg_blacklist_apps:-[]}" \
        '{
            ui_max_bri:        ($ui_max_bri        | tonumber),
            max_bri:           ($max_bri           | tonumber),
            steps_num:         ($steps_num         | tonumber),
            log_max_size:      ($log_max_size       | tonumber),
            auto_bri_sleep:    ($auto_bri_sleep     | tonumber),
            display_hdr_sleep: ($display_hdr_sleep  | tonumber),
            sleep_time:        $sleep_time,
            inotify_events:    $inotify_events,
            now_bri_file:      $now_bri_file,
            max_bri_file:      $max_bri_file,
            blacklist_apps:    $blacklist_apps
        }' >"$CONFIG_FILE"
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
    echo "[*] 本次更新日志:"
    awk '/^## / { if (p) exit; p=1; print; next } p { print }' "$f"
    echo "========================================"
}

NOTE() {
    cat "$MODPATH/NOTE.txt"
    echo ""
    echo "[i] 按音量 + 进入下一步, 按音量 - 退出"
    echo "[i] 继续则表明你已理解并接受所有风险"
    [ "$(btn)" = "0" ] && echo "[OK] 已确认" || abort "[X] 已退出"
}

CHECK_FILES() {
    sleep 1
    now_bri_file="$(cfg_get now_bri_file "$DEFAULT_NOW_BRI_FILE")"
    max_bri_file="$(cfg_get max_bri_file "$DEFAULT_MAX_BRI_FILE")"

    echo ""
    echo "[*] 正在验证设备亮度节点..."
    echo "- 当前亮度节点: $now_bri_file"
    echo "- 最大亮度节点: $max_bri_file"
    echo ""

    if [ -f "$now_bri_file" ] && [ -f "$max_bri_file" ]; then
        echo "[OK] 找到亮度节点文件"
    else
        [ ! -f "$now_bri_file" ] && echo "[X] 当前亮度节点不存在: $now_bri_file"
        [ ! -f "$max_bri_file" ] && echo "[X] 最大亮度节点不存在: $max_bri_file"
        echo ""
        echo "设备不支持默认路径，刷入后请通过 Web UI 手动配置亮度节点"
        echo "查找路径: find /sys -name '*brightness*' 2>/dev/null"
        abort "[X] 安装中止：无法找到设备亮度节点"
    fi

    echo "[OK] 当前亮度: $(cat "$now_bri_file")"
    echo "[OK] 系统最大亮度: $(cat "$max_bri_file")"
}

TEST_UI_MAX_BRI() {
    echo ""
    echo "[*] 开始测试前台最大亮度"
    echo ""
    sleep 1

    echo "======== 请关闭自动亮度 ========"
    echo "[i] 按音量 + 进入下一步, 按音量 - 退出"
    [ "$(btn)" = "0" ] && echo "[OK] 已确认" || abort "[X] 已退出"

    local restore_bri
    restore_bri="$(cat "$now_bri_file")"
    echo ""
    sleep 1

    echo "======== 请将屏幕亮度调至最大 ========"
    echo "[i] 按音量 + 进入下一步, 按音量 - 退出"
    [ "$(btn)" = "0" ] && echo "[OK] 已确认" || abort "[X] 已退出"

    local measured_ui measured_max
    measured_ui="$(cat "$now_bri_file")"
    measured_max="$(cat "$max_bri_file")"
    echo "[OK] 前台最大亮度: [ $measured_ui ]"
    echo "[i] 峰值最大亮度由节点文件获得: [ $measured_max ]"
    echo "[i] 若不符合预期，请稍后到 Web UI 更改"

    # 写入 JSON
    "$JQ" ".ui_max_bri = ($measured_ui | tonumber) | .max_bri = ($measured_max | tonumber)" \
        "$CONFIG_FILE" >"$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

    echo ""
    echo "[OK] 测试完成"
    echo "[*] 正在恢复亮度..."
    echo -n "$restore_bri" >"$now_bri_file"
}

# 导入旧配置（支持 JSON 格式和旧 txt 格式）
IMPORT_OLD_CONFIG() {
    # 1. 已有 JSON 格式
    if [ -f "$old_config/config.json" ]; then
        local old_ui
        old_ui=$("$JQ" -re '.ui_max_bri' "$old_config/config.json" 2>/dev/null || echo "0")
        if [ "${old_ui:-0}" -gt 0 ] 2>/dev/null; then
            echo ""
            sleep 1
            echo "[i] 检测到已有 JSON 配置:"
            echo "    - 前台最大亮度: $old_ui"
            echo "    - 峰值最大亮度: $("$JQ" -re '.max_bri' "$old_config/config.json" 2>/dev/null)"
            local old_st
            old_st=$("$JQ" -re '.sleep_time // empty' "$old_config/config.json" 2>/dev/null)
            [ -n "$old_st" ] && echo "    - 休眠时间: $old_st"
            echo ""
            echo "[?] 按音量 + 沿用旧配置, 按音量 - 重新测试"
            if [ "$(btn)" = "0" ]; then
                cp -f "$old_config/config.json" "$CONFIG_FILE"
                # 若旧 JSON 缺少 blacklist_apps 字段，尝试从 blacklist_apps.txt 补入
                if ! "$JQ" -e '.blacklist_apps' "$CONFIG_FILE" >/dev/null 2>&1; then
                    local bl_arr
                    if [ -s "$old_config/blacklist_apps.txt" ]; then
                        bl_arr=$("$JQ" -Rs 'split("\n") | map(select(length > 0))' \
                            "$old_config/blacklist_apps.txt" 2>/dev/null || echo '[]')
                    else
                        bl_arr='[]'
                    fi
                    local tmp_cfg="$CONFIG_FILE.tmp"
                    "$JQ" --argjson bl "$bl_arr" '. + {blacklist_apps: $bl}' \
                        "$CONFIG_FILE" >"$tmp_cfg" && mv -f "$tmp_cfg" "$CONFIG_FILE"
                fi
                echo "[OK] 已导入 JSON 配置"
                return 0
            else
                echo "[*] 将重新测试"
                return 1
            fi
        fi
        return 1
    fi

    # 2. 旧 txt 格式迁移
    if [ -d "$old_config" ] && [ -s "$old_config/ui_max_bri.txt" ] && [ -s "$old_config/max_bri.txt" ]; then
        echo ""
        sleep 1
        echo "[i] 检测到旧格式配置，将迁移至 JSON:"
        echo "    - 前台最大亮度: $(cat "$old_config/ui_max_bri.txt")"
        echo "    - 峰值最大亮度: $(cat "$old_config/max_bri.txt")"
        [ -s "$old_config/sleep_time.txt" ] && echo "    - 休眠时间: $(cat "$old_config/sleep_time.txt")"
        [ -s "$old_config/auto_bri_sleep.txt" ] && echo "    - 自动亮度时休眠: $(cat "$old_config/auto_bri_sleep.txt" | sed 's/1/开启/;s/0/关闭/')"
        [ -s "$old_config/steps_num.txt" ] && echo "    - 亮度步数: $(cat "$old_config/steps_num.txt")"
        [ -s "$old_config/log_max_size.txt" ] && echo "    - 日志限制: $(cat "$old_config/log_max_size.txt") KB"
        [ -s "$old_config/blacklist_apps.txt" ] && echo "    - 黑名单: $(wc -l <"$old_config/blacklist_apps.txt" | tr -d ' ') 个"
        echo ""
        echo "[?] 按音量 + 沿用旧配置, 按音量 - 重新测试"
        if [ "$(btn)" = "0" ]; then
            cfg_ui_max_bri="$(read_old_txt ui_max_bri.txt '0')"
            cfg_max_bri="$(read_old_txt max_bri.txt '0')"
            cfg_steps_num="$(read_old_txt steps_num.txt '50')"
            cfg_log_max_size="$(read_old_txt log_max_size.txt '512')"
            cfg_auto_bri_sleep="$(read_old_txt auto_bri_sleep.txt '1')"
            cfg_display_hdr_sleep="$(read_old_txt display_hdr_sleep.txt '0')"
            cfg_sleep_time="$(read_old_txt sleep_time.txt '')"
            cfg_inotify_events="$(read_old_txt inotify_events.txt 'c')"
            cfg_now_bri_file="$(read_old_txt path/now_bri_file.txt "$DEFAULT_NOW_BRI_FILE")"
            cfg_max_bri_file="$(read_old_txt path/max_bri_file.txt "$DEFAULT_MAX_BRI_FILE")"

            # 黑名单转 JSON 数组
            if [ -s "$old_config/blacklist_apps.txt" ]; then
                cfg_blacklist_apps=$("$JQ" -Rs 'split("\n") | map(select(length > 0))' \
                    "$old_config/blacklist_apps.txt" 2>/dev/null || echo '[]')
            else
                cfg_blacklist_apps='[]'
            fi

            write_config_json

            # 删除旧 txt 配置文件
            rm -f "$old_config/"*.txt 2>/dev/null
            rm -rf "$old_config/path" 2>/dev/null
            echo "[OK] 配置已迁移至 JSON，旧文件已清理"
            return 0
        else
            echo "[*] 将重新测试"
            return 1
        fi
    fi

    return 1
}

# 初始化默认配置
INIT_CONFIG() {
    mkdir -p "$mod_config"
    if [ ! -f "$CONFIG_FILE" ]; then
        cfg_ui_max_bri=0
        cfg_max_bri=0
        cfg_steps_num=50
        cfg_log_max_size=512
        cfg_auto_bri_sleep=1
        cfg_display_hdr_sleep=0
        cfg_sleep_time=""
        cfg_inotify_events="c"
        cfg_now_bri_file="$DEFAULT_NOW_BRI_FILE"
        cfg_max_bri_file="$DEFAULT_MAX_BRI_FILE"
        cfg_blacklist_apps="[]"
        write_config_json
    fi
}

# 补全缺失字段
ENSURE_DEFAULTS() {
    "$JQ" '
        .steps_num         = (.steps_num         // 50) |
        .log_max_size      = (.log_max_size       // 512) |
        .auto_bri_sleep    = (.auto_bri_sleep     // 1) |
        .display_hdr_sleep = (.display_hdr_sleep  // 0) |
        .sleep_time        = (.sleep_time         // "") |
        .inotify_events    = (.inotify_events     // "c") |
        .blacklist_apps    = (.blacklist_apps     // [])
    ' "$CONFIG_FILE" >"$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
}

# 机型兼容性校验
CHECK_DEVICE_COMPATIBILITY() {
    local model prefix
    model="$(getprop ro.product.model)"
    prefix="$(echo "$model" | cut -c 1-9)"

    if [ "$prefix" = "25128PNA1" ] || [ "$prefix" = "2512BPNDA" ]; then
        echo ""
        echo "[!] 您可能是 Xiaomi 17 Ultra 用户，建议使用 '0' 事件作为监测对象"
        echo "[?] 是否将 inotifyd 监测事件修改为 '0'? (音量 + 确认，音量 - 跳过)"
        if [ "$(btn)" = "0" ]; then
            "$JQ" '.inotify_events = "0"' "$CONFIG_FILE" >"$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
            echo "[OK] 已设置为 0 事件监测"
        else
            echo "[*] 已跳过"
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

    # 确保 now_bri_file / max_bri_file 已设置（import 路径可能未调用 CHECK_FILES）
    : "${now_bri_file:=$(cfg_get now_bri_file "$DEFAULT_NOW_BRI_FILE")}"
    : "${max_bri_file:=$(cfg_get max_bri_file "$DEFAULT_MAX_BRI_FILE")}"

    local final_ui final_max
    final_ui=$("$JQ" -re 'if .ui_max_bri > 0 then .ui_max_bri else empty end' "$CONFIG_FILE" 2>/dev/null)
    final_max=$("$JQ" -re 'if .max_bri > 0 then .max_bri else empty end' "$CONFIG_FILE" 2>/dev/null)

    if [ -z "$final_max" ] || [ -z "$final_ui" ]; then
        echo ""
        echo "[!] ======== 配置不完整 ========"
        [ -z "$final_max" ] && echo "[X] 峰值最大亮度: 未配置" || echo "[OK] 峰值最大亮度: $final_max"
        [ -z "$final_ui" ] && echo "[X] 前台最大亮度: 未配置" || echo "[OK] 前台最大亮度: $final_ui"
        echo ""
        echo "[i] 配置缺失，请重启后通过 Web UI 手动配置"
        echo "[i] 或按音量 + 现在进行测试, 按音量 - 跳过"
        if [ "$(btn)" = "0" ]; then
            TEST_UI_MAX_BRI
            final_ui=$("$JQ" -re 'if .ui_max_bri > 0 then .ui_max_bri else empty end' "$CONFIG_FILE" 2>/dev/null)
            final_max=$("$JQ" -re 'if .max_bri > 0 then .max_bri else empty end' "$CONFIG_FILE" 2>/dev/null)
        fi
    fi

    echo ""
    echo "======== 将要应用的配置 ========"
    echo "[*] 前台最大亮度:   $final_ui"
    echo "[*] 峰值最大亮度:   $final_max"

    local steps log_size auto_bri disp_hdr st inotify bl_count now_path max_path
    steps=$("$JQ" -re '.steps_num' "$CONFIG_FILE" 2>/dev/null || echo "50")
    log_size=$("$JQ" -re '.log_max_size' "$CONFIG_FILE" 2>/dev/null || echo "512")
    auto_bri=$("$JQ" -re '.auto_bri_sleep' "$CONFIG_FILE" 2>/dev/null || echo "1")
    disp_hdr=$("$JQ" -re '.display_hdr_sleep' "$CONFIG_FILE" 2>/dev/null || echo "0")
    st=$("$JQ" -re '.sleep_time // empty' "$CONFIG_FILE" 2>/dev/null)
    inotify=$("$JQ" -re '.inotify_events' "$CONFIG_FILE" 2>/dev/null || echo "c")
    now_path=$("$JQ" -re '.now_bri_file' "$CONFIG_FILE" 2>/dev/null || echo "$DEFAULT_NOW_BRI_FILE")
    max_path=$("$JQ" -re '.max_bri_file' "$CONFIG_FILE" 2>/dev/null || echo "$DEFAULT_MAX_BRI_FILE")
    bl_count=$("$JQ" -re '.blacklist_apps | length' "$CONFIG_FILE" 2>/dev/null || echo "0")

    echo "[*] 亮度渐变步数:   $steps"
    echo "[*] 日志大小上限:   ${log_size} KB"
    if [ "$auto_bri" = "1" ]; then
        echo "[*] 自动亮度时跳过: 开启"
    else
        echo "[*] 自动亮度时跳过: 关闭"
    fi
    if [ "$disp_hdr" = "1" ]; then
        echo "[*] HDR 内容时跳过: 开启"
    else
        echo "[*] HDR 内容时跳过: 关闭"
    fi
    if [ -n "$st" ]; then
        echo "[*] 休眠时段:       $st"
    else
        echo "[*] 休眠时段:       未配置"
    fi
    echo "[*] inotifyd 事件:  $inotify"
    echo "[*] 当前亮度节点:   $now_path"
    echo "[*] 最大亮度节点:   $max_path"
    echo "[*] 黑名单应用:     ${bl_count} 个"
    echo "==============================="
    echo "[i] 配置文件: /data/adb/modules/LuminPro/config/config.json"
    echo "[i] 也可以使用 Web UI 进行配置"
    echo ""
    echo "[OK] 模块已刷入，请重启手机"
    echo "[i] 感谢您的使用"
    echo "[i] 作者: 酷安 @于乐yule"
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
        TEST_UI_MAX_BRI
    fi
    ENSURE_DEFAULTS
    CHECK_DEVICE_COMPATIBILITY
    CREATE_BACKUP
    END
}

MAIN

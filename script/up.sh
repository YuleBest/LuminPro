#!/system/bin/sh
#shellcheck shell=ash
# 亮度提升脚本

MODDIR="${0%/*/*}"
CONFIG_FILE="$MODDIR/config/config.json"
JQ="$MODDIR/bin/jq"
PID_DIR="$MODDIR/pid"
flag_file="$PID_DIR/up.flag"
stop_file="$PID_DIR/stop.flag"
log_file="$MODDIR/service.log"
pause_file="$PID_DIR/daemon.pause"

DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"

get_cfg() {
    local key="$1" default="$2"
    local val
    if val=$("$JQ" -re ".${key}" "$CONFIG_FILE" 2>/dev/null); then
        echo "$val"
    else
        echo "$default"
    fi
}

now_bri_file="$(get_cfg now_bri_file "$DEFAULT_NOW_BRI_FILE")"

_log() {
    local level="${2:-INFO}"

    case "$1" in
    "日志超限"*) ;;
    *) if [ -f "$stop_file" ]; then return; fi ;;
    esac

    local max_size
    max_size="$(get_cfg log_max_size 500)"
    if [ -f "$log_file" ]; then
        local cur_size
        cur_size=$(du -k "$log_file" | cut -f1)
        if [ "$cur_size" -ge "$max_size" ]; then
            printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "up" "WARN" "日志超限 (${cur_size}KB / ${max_size}KB)，已自动重置" >"$log_file"
        fi
    fi
    printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "up" "$level" "$1" >>"$log_file"
}

_log "收到亮度变更通知 (PID: $$)" "INFO"

if [ -f "$stop_file" ]; then
    _log "服务已暂停，跳过本次处理" "WARN"
    exit 0
fi

touch "$flag_file"

# 读取配置
ui_max_bri="$(get_cfg ui_max_bri 0)"
max_bri="$(get_cfg max_bri 0)"
sleep_time="$(get_cfg sleep_time '')"
auto_bri_sleep="$(get_cfg auto_bri_sleep 1)"
display_hdr_sleep="$(get_cfg display_hdr_sleep 0)"
steps_num="$(get_cfg steps_num 50)"

# 解析休眠时间
sleep_start="${sleep_time%-*}"
sleep_end="${sleep_time#*-}"

IS_SLEEP_TIME() {
    local now
    now="$(date '+%H%M')"
    [ -z "$sleep_start" ] || [ -z "$sleep_end" ] && return 1
    [ "$sleep_start" = "$sleep_end" ] && return 1
    if [ "$sleep_start" -gt "$sleep_end" ]; then
        [ "$now" -ge "$sleep_start" ] || [ "$now" -lt "$sleep_end" ]
    else
        [ "$now" -ge "$sleep_start" ] && [ "$now" -lt "$sleep_end" ]
    fi
}

target_bri="$max_bri"

update_all() {
    local step
    start_bri="$(cat "$now_bri_file")"
    bri_diff="$((target_bri - start_bri))"
    step_value="$((bri_diff / steps_num))"

    if [ "$step_value" -eq 0 ]; then
        _log "差値过小，直接设定亮度: $target_bri" "INFO"
        echo -n "$target_bri" >"$now_bri_file" && return 0 || return 1
    fi

    _log "开始渐变调整: $start_bri → $target_bri ($steps_num 步)" "INFO"
    for step in $(seq 1 "$steps_num"); do
        echo -n $((start_bri + step * step_value)) >"$now_bri_file"
        sleep 0.02
    done
    echo -n "$target_bri" >"$now_bri_file" && return 0 || return 1
}

CHECK_BRI() {
    local cycle_num now_bri
    # shellcheck disable=SC2034
    for cycle_num in $(seq 1 10); do
        now_bri="$(cat "$now_bri_file")"
        if [ "$now_bri" -ge "$ui_max_bri" ] && [ "$now_bri" -lt "$target_bri" ]; then
            _log "触发提升: 当前亮度 $now_bri ≥ 阈値 $ui_max_bri，目标 $target_bri" "INFO"
            if update_all; then
                _log "亮度提升完成 ($target_bri)" "SUCCESS"
                return 0
            else
                _log "亮度提升失败: 无法写入亮度节点" "ERROR"
                return 1
            fi
        fi
        sleep 0.3
    done
    _log "检测超时: 亮度未持续达到提升阈値" "INFO"
    return 1
}

MAIN() {
    if IS_SLEEP_TIME; then
        _log "处于休眠时段 ($sleep_start-$sleep_end)，跳过提升" "INFO"
        rm -f "$flag_file"
        return
    fi

    if [ "$auto_bri_sleep" = "1" ]; then
        local mode
        mode="$(settings get system screen_brightness_mode 2>/dev/null)"
        if [ "$mode" = "1" ]; then
            _log "自动亮度已启用，跳过提升" "INFO"
            rm -f "$flag_file"
            return
        fi
    fi

    # 黑名单检测（从 JSON 数组读取）
    local blacklist_len
    blacklist_len=$("$JQ" -r '.blacklist_apps | length' "$CONFIG_FILE" 2>/dev/null || echo "0")
    if [ "${blacklist_len:-0}" -gt 0 ]; then
        local current_focus current_app
        current_focus="$(dumpsys window | grep mCurrentFocus | sed 's/.*u[0-9][0-9]* //' | sed 's/}.*//')"
        current_app="${current_focus%%/*}"
        if [ -n "$current_focus" ] &&
            "$JQ" -re --arg f "$current_focus" --arg a "$current_app" \
                '.blacklist_apps | map(. == $f or . == $a) | any' \
                "$CONFIG_FILE" >/dev/null 2>&1; then
            _log "当前前台 ($current_focus) 在黑名单中，跳过提升" "INFO"
            rm -f "$flag_file"
            return
        fi
    fi

    # 显示 HDR 内容时休眠
    if [ "$display_hdr_sleep" = "1" ]; then
        local hdr_flag_file="$PID_DIR/hdr.flag"
        if [ -f "$hdr_flag_file" ]; then
            local flag_time now
            flag_time="$(cat "$hdr_flag_file")"
            now="$(date +%s)"
            if awk "BEGIN{exit !(($now - $flag_time) < 2)}" 2>/dev/null; then
                _log "HDR 冷却期内，跳过提升" "INFO"
                rm -f "$flag_file"
                return
            else
                rm -f "$hdr_flag_file"
            fi
        fi
        local hdr_ratio
        local hdr_cache_file="$PID_DIR/.hdr_ratio_cache"
        hdr_ratio="$(dumpsys display 2>/dev/null | sed -n 's/.*hdrSdrRatio \([0-9.]*\).*/\1/p' | head -n 1)"
        if echo "$hdr_ratio" | grep -qE '^[0-9]+\.[0-9]+$'; then
            echo -n "$hdr_ratio" >"$hdr_cache_file"
        elif [ -f "$hdr_cache_file" ]; then
            hdr_ratio="$(cat "$hdr_cache_file")"
            _log "HDR 比率读取为空，使用缓存值: $hdr_ratio" "INFO"
        fi
        if echo "$hdr_ratio" | grep -qE '^[0-9]+\.[0-9]+$'; then
            local hdr_ratio_rounded
            hdr_ratio_rounded="$(awk "BEGIN{printf \"%.2f\", $hdr_ratio}")"
            if awk "BEGIN{exit !($hdr_ratio_rounded > 1.00)}" 2>/dev/null; then
                _log "检测到 HDR 内容 (比率: $hdr_ratio_rounded)，跳过提升" "INFO"
                date +%s >"$hdr_flag_file"
                rm -f "$flag_file"
                return
            fi
        fi
    fi

    _log "正在检测亮度变化..." "INFO"
    CHECK_BRI
    rm -f "$flag_file"

}

MAIN
exit 0

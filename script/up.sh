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

_log "收到 inotifyd 事件通知 (PID: $$)" "INFO"
_log "正在接管控制权，清理残余进程..." "INFO"
touch "$pause_file"
killall -9 inotifyd 2>/dev/null
for p in $(pgrep -f "up.sh"); do
    [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null
done

if [ -f "$stop_file" ]; then
    _log "服务已暂停，跳过本次处理" "WARN"
    exit 0
fi

if [ -f "$flag_file" ]; then
    _log "检测到并发执行，当前进程退出" "WARN"
    exit 1
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
        rm -f "$flag_file" "$pause_file"
        return
    fi

    if [ "$auto_bri_sleep" = "1" ]; then
        local mode
        mode="$(settings get system screen_brightness_mode 2>/dev/null)"
        if [ "$mode" = "1" ]; then
            _log "自动亮度已启用，跳过提升" "INFO"
            rm -f "$flag_file" "$pause_file"
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
            rm -f "$flag_file" "$pause_file"
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
                rm -f "$flag_file" "$pause_file"
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
                rm -f "$flag_file" "$pause_file"
                return
            fi
        fi
    fi

    _log "正在检测亮度变化..." "INFO"
    CHECK_BRI
    rm -f "$flag_file"
    rm -f "$pause_file"

    # 如果监听路径变更，重启 inotifyd
    local current_now_bri cached_now_bri
    current_now_bri="$(get_cfg now_bri_file "$DEFAULT_NOW_BRI_FILE")"
    cached_now_bri="$(cat "$MODDIR/config/.cached_path" 2>/dev/null || echo "$DEFAULT_NOW_BRI_FILE")"
    if [ "$current_now_bri" != "$cached_now_bri" ]; then
        _log "检测到监听路径变更，重启 inotifyd" "INFO"
        killall -9 inotifyd 2>/dev/null
    fi
}

MAIN
exit 0

# 日志函数
_log() {
    local level="${2:-INFO}"

    case "$1" in
    "日志超限"*) ;;
    *) if [ -f "$stop_file" ]; then return; fi ;;
    esac

    local max_size
    max_size="$(cat "$CONFIG_DIR/log_max_size.txt" 2>/dev/null)"
    [ -z "$max_size" ] && max_size="500" # 默认 500 KB

    # 获取当前日志大小 (KB)
    if [ -f "$log_file" ]; then
        local cur_size
        cur_size=$(du -k "$log_file" | cut -f1)
        if [ "$cur_size" -ge "$max_size" ]; then
            printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "up" "WARN" "日志超限 (${cur_size}KB / ${max_size}KB)，已自动重置" >"$log_file"
        fi
    fi

    printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "up" "$level" "$1" >>"$log_file"
}

_log "收到 inotifyd 事件通知 (PID: $$)" "INFO"
_log "正在接管控制权，清理残余进程..." "INFO"
touch "$pause_file"
killall -9 inotifyd 2>/dev/null
for p in $(pgrep -f "up.sh"); do
    [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null
done

if [ -f "$stop_file" ]; then
    _log "服务已暂停，跳过本次处理" "WARN"
    exit 0
fi

if [ -f "$flag_file" ]; then
    _log "检测到并发执行，当前进程退出" "WARN"
    exit 1
fi
touch "$flag_file"

# 读取配置 (均为数值)
ui_max_bri="$(cat "$CONFIG_DIR/ui_max_bri.txt")"
max_bri="$(cat "$CONFIG_DIR/max_bri.txt")"
sleep_time="$(cat "$CONFIG_DIR/sleep_time.txt" 2>/dev/null)"
auto_bri_sleep="$(cat "$CONFIG_DIR/auto_bri_sleep.txt" 2>/dev/null)"
display_hdr_sleep="$(cat "$CONFIG_DIR/display_hdr_sleep.txt" 2>/dev/null)"

# 解析休眠时间 (格式: HHMM-HHMM, 例如 1900-0600)
sleep_start="${sleep_time%-*}" # 1900
sleep_end="${sleep_time#*-}"   # 0600

# 判断当前是否处于休眠时段
IS_SLEEP_TIME() {
    local now
    now="$(date '+%H%M')" # 当前时间, 例如 "2130"

    # 未配置或格式无效则不休眠
    [ -z "$sleep_start" ] || [ -z "$sleep_end" ] && return 1
    # 起止相同表示不启用休眠
    [ "$sleep_start" = "$sleep_end" ] && return 1

    if [ "$sleep_start" -gt "$sleep_end" ]; then
        # 跨午夜: 1900-0600 → 当前 >= 19:00 或 当前 < 06:00
        [ "$now" -ge "$sleep_start" ] || [ "$now" -lt "$sleep_end" ]
    else
        # 不跨午夜: 0100-0600 → 当前 >= 01:00 且 当前 < 06:00
        [ "$now" -ge "$sleep_start" ] && [ "$now" -lt "$sleep_end" ]
    fi
}

# 目标亮度
target_bri="$max_bri"
steps_num="$(cat "$CONFIG_DIR/steps_num.txt" 2>/dev/null)"
[ -z "$steps_num" ] && steps_num="50" # 步数 (默认 50)

# 循环调整
update_all() {
    local step

    # 在调整前的这一刻读取当前亮度作为起始值
    start_bri="$(cat "$now_bri_file")"
    bri_diff="$((target_bri - start_bri))"
    step_value="$((bri_diff / steps_num))"

    # 如果步长为 0 (差值太小), 直接设置目标亮度
    if [ "$step_value" -eq 0 ]; then
        _log "差值过小，直接设定亮度: $target_bri" "INFO"
        echo -n "$target_bri" >"$now_bri_file" && return 0 || return 1
    fi

    _log "开始渐变调整: $start_bri → $target_bri ($steps_num 步)" "INFO"
    for step in $(seq 1 "$steps_num"); do
        echo -n $((start_bri + step * step_value)) >"$now_bri_file"
        sleep 0.02
    done

    # 最后一步写入目标亮度, 确保精确到位
    echo -n "$target_bri" >"$now_bri_file" && return 0 || return 1
}

# 检测亮度是否符合条件
CHECK_BRI() {
    local cycle_num
    local now_bri

    # 循环 10 次 (检查 3s)
    # shellcheck disable=SC2034
    for cycle_num in $(seq 1 10); do
        now_bri="$(cat "$now_bri_file")"
        if [ "$now_bri" -ge "$ui_max_bri" ] && [ "$now_bri" -lt "$target_bri" ]; then
            _log "触发提升: 当前亮度 $now_bri ≥ 阈值 $ui_max_bri，目标 $target_bri" "INFO"

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
    _log "检测超时: 亮度未持续达到提升阈值" "INFO"
    return 1
}

MAIN() {
    # 解析并判断休眠
    if IS_SLEEP_TIME; then
        _log "处于休眠时段 ($sleep_start-$sleep_end)，跳过提升" "INFO"
        rm -f "$flag_file" "$pause_file"
        return
    fi

    if [ "$auto_bri_sleep" = "1" ]; then
        mode="$(settings get system screen_brightness_mode 2>/dev/null)"
        if [ "$mode" = "1" ]; then
            _log "自动亮度已启用，跳过提升" "INFO"
            rm -f "$flag_file" "$pause_file"
            return
        fi
    fi

    # 黑名单应用检测（支持包名和完整 package/activity 两种格式）
    local blacklist_file="$CONFIG_DIR/blacklist_apps.txt"
    if [ -f "$blacklist_file" ] && [ -s "$blacklist_file" ]; then
        local current_focus current_app
        current_focus="$(dumpsys window | grep mCurrentFocus | sed 's/.*u0 \(.*\)}/\1/')"
        current_app="${current_focus%%/*}"
        if [ -n "$current_focus" ] && { grep -qxF "$current_focus" "$blacklist_file" || grep -qxF "$current_app" "$blacklist_file"; }; then
            _log "当前前台 ($current_focus) 在黑名单中，跳过提升" "INFO"
            rm -f "$flag_file" "$pause_file"
            return
        fi
    fi

    # 显示 HDR 内容时休眠
    if [ "$display_hdr_sleep" = "1" ]; then
        local hdr_flag_file="$PID_DIR/hdr.flag"
        # 冷却期检查：读取写入时间戳，判断是否在 2 秒内
        if [ -f "$hdr_flag_file" ]; then
            local flag_time now
            flag_time="$(cat "$hdr_flag_file")"
            now="$(date +%s)"
            if awk "BEGIN{exit !(($now - $flag_time) < 2)}" 2>/dev/null; then
                _log "HDR 冷却期内，跳过提升" "INFO"
                rm -f "$flag_file" "$pause_file"
                return
            else
                rm -f "$hdr_flag_file" # 冷却期已过，清理
            fi
        fi
        local hdr_ratio hdr_ratio_rounded
        local hdr_cache_file="$PID_DIR/.hdr_ratio_cache"
        hdr_ratio="$(dumpsys display 2>/dev/null | sed -n 's/.*hdrSdrRatio \([0-9.]*\).*/\1/p' | head -n 1)"
        if echo "$hdr_ratio" | grep -qE '^[0-9]+\.[0-9]+$'; then
            # 读取成功，更新缓存
            echo -n "$hdr_ratio" >"$hdr_cache_file"
        elif [ -f "$hdr_cache_file" ]; then
            # 读取为空，使用上次缓存
            hdr_ratio="$(cat "$hdr_cache_file")"
            _log "HDR 比率读取为空，使用缓存值: $hdr_ratio" "INFO"
        fi
        if echo "$hdr_ratio" | grep -qE '^[0-9]+\.[0-9]+$'; then
            hdr_ratio_rounded="$(awk "BEGIN{printf \"%.2f\", $hdr_ratio}")"
            if awk "BEGIN{exit !($hdr_ratio_rounded > 1.00)}" 2>/dev/null; then
                _log "检测到 HDR 内容 (比率: $hdr_ratio_rounded)，跳过提升" "INFO"
                # 写入当前时间戳作为冷却期起点（2 秒内再次触发直接跳过）
                date +%s >"$hdr_flag_file"
                rm -f "$flag_file" "$pause_file"
                return
            fi
        fi
    fi

    _log "正在检测亮度变化..." "INFO"
    # sleep 0.5
    CHECK_BRI
    rm -f "$flag_file"  # 删除成果锁
    rm -f "$pause_file" # 解锁守护进程，让它自动拉起 inotifyd

    # 如果配置文件被修改了，杀掉 inotifyd 让 daemon 重启并重新读取配置
    local current_now_bri cached_now_bri
    current_now_bri="$(cat "$PATH_CONFIG_DIR/now_bri_file.txt" 2>/dev/null || echo "$DEFAULT_NOW_BRI_FILE")"
    cached_now_bri="$(cat "$PATH_CONFIG_DIR/.cached_path" 2>/dev/null || echo "$DEFAULT_NOW_BRI_FILE")"

    if [ "$current_now_bri" != "$cached_now_bri" ]; then
        _log "检测到监听路径变更，重启 inotifyd" "INFO"
        killall -9 inotifyd 2>/dev/null
    fi
}

MAIN
exit 0

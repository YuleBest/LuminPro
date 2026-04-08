#!/system/bin/sh
#shellcheck shell=ash
# 亮度提升脚本

MODDIR="${0%/*/*}"
CONFIG_DIR="$MODDIR/config"
PATH_CONFIG_DIR="$CONFIG_DIR/path"
PID_DIR="$MODDIR/pid"
flag_file="$PID_DIR/up.flag"
stop_file="$PID_DIR/stop.flag"
log_file="$MODDIR/service.log"
pause_file="$PID_DIR/daemon.pause"

# 默认设备路径
DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"

# 读取配置函数
get_config() {
    local config_file="$1"
    local default_value="$2"
    if [ -f "$config_file" ]; then
        cat "$config_file"
    else
        echo "$default_value"
    fi
}

# 获取亮度文件路径
now_bri_file="$(get_config "$PATH_CONFIG_DIR/now_bri_file.txt" "$DEFAULT_NOW_BRI_FILE")"

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
        rm -f "$flag_file"
        return
    fi

    if [ "$auto_bri_sleep" = "1" ]; then
        mode="$(settings get system screen_brightness_mode 2>/dev/null)"
        if [ "$mode" = "1" ]; then
            _log "自动亮度已启用，跳过提升" "INFO"
            rm -f "$flag_file"
            return
        fi
    fi

    # 黑名单应用检测
    local blacklist_file="$CONFIG_DIR/blacklist_apps.txt"
    if [ -f "$blacklist_file" ] && [ -s "$blacklist_file" ]; then
        local current_app
        current_app="$(dumpsys window | grep mCurrentFocus | sed 's/.*u0 \(.*\)\/.*/\1/')"
        if [ -n "$current_app" ] && grep -qxF "$current_app" "$blacklist_file"; then
            _log "当前前台应用 ($current_app) 在黑名单中，跳过提升" "INFO"
            rm -f "$flag_file"
            return
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

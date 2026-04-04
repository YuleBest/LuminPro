#!/system/bin/sh
#shellcheck shell=ash
# 亮度提升脚本

MODDIR="${0%/*/*}"
CONFIG_DIR="$MODDIR/config"
PID_DIR="$MODDIR/pid"
flag_file="$PID_DIR/up.flag"
stop_file="$PID_DIR/stop.flag"
log_file="$MODDIR/service.log"
pause_file="$PID_DIR/daemon.pause"
now_bri_file="/sys/class/backlight/panel0-backlight/brightness"

# 日志函数
_log() {
    case "$1" in
    "日志过大"*) ;;
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
            echo "[$(date '+%d %H:%M:%S.%3N')] [up] 日志过大 ($cur_size KB), 自动重置" >"$log_file"
        fi
    fi

    printf '[%s] [up] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

_log "[$$] 收到 inotifyd 通知..."

if [ -f "$stop_file" ]; then
    _log "[$$] [拦截] 检测到 stop.flag, 服务已处于手动暂停状态"
    exit 0
fi

if [ -f "$flag_file" ]; then
    _log "[$$] [拦截] 已经有一个 up.sh (${flag_file}) 在运行, 本进程退出"
    exit 1
fi
touch "$flag_file"

# 节点文件
now_bri_file="/sys/class/backlight/panel0-backlight/brightness"

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
        _log "[$$] 步长为 0, 直接设置目标亮度: $target_bri"
        echo -n "$target_bri" >"$now_bri_file" && return 0 || return 1
    fi

    _log "[$$] 开始调整亮度: $start_bri -> $target_bri, 共 $steps_num 步, 每步 $step_value"
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

    # 循环 10 次 (检查 5s)
    # shellcheck disable=SC2034
    for cycle_num in $(seq 1 10); do
        now_bri="$(cat "$now_bri_file")"
        if [ "$now_bri" -ge "$ui_max_bri" ] && [ "$now_bri" -lt "$target_bri" ]; then
            _log "[$$] [满足提升条件] 当前亮度: $now_bri (>= $ui_max_bri), 目标提升至: $target_bri"
            _log "[$$] [抢占] 正在清理 inotifyd 和其它上报进程..."
            touch "$pause_file"
            killall -9 inotifyd 2>/dev/null
            for p in $(pgrep -f "up.sh"); do
                [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null
            done
            rm -f "$flag_file"

            if update_all; then
                _log "[$$] [成功] 亮度提升任务已完成 (已设为: $target_bri)"
                _log "--------------------"
                return 0
            else
                _log "[$$] [失败] 亮度提升过程中遇到异常"
                _log "--------------------"
                return 1
            fi
        fi
        sleep 0.5
    done
    _log "[$$] [取消] 循环检测结束, 未持续触发有效提升阈值"
    return 1
}

MAIN() {
    # 0.5 秒等待以避免 inotifyd 刚启动时的误触
    sleep 0.5

    # 解析并判断休眠
    if IS_SLEEP_TIME; then
        _log "[$$] 当前处于休眠时段 ($sleep_start-$sleep_end), 跳过本次调整"
        _log "--------------------"
        rm -f "$flag_file"
        return
    fi

    if [ "$auto_bri_sleep" = "1" ]; then
        mode="$(settings get system screen_brightness_mode 2>/dev/null)"
        if [ "$mode" = "1" ]; then
            _log "[$$] 当前为自动亮度模式, 根据设置跳过本次调整"
            _log "--------------------"
            rm -f "$flag_file"
            return
        fi
    fi

    _log "[$$] 亮度被调整, 将在 0.5s 后检测是否符合条件"
    sleep 0.5
    CHECK_BRI
    rm -f "$flag_file"  # 删除成果锁
    rm -f "$pause_file" # 解锁守护进程，让它自动拉起 inotifyd
}

MAIN
exit 0

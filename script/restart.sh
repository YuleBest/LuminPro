#!/system/bin/sh
# LuminPro 服务重启脚本

MODDIR="${0%/*/*}"
PID_DIR="$MODDIR/pid"
pid_file="$PID_DIR/inotifyd.pid"
flag_file="$PID_DIR/up.flag"
log_file="$MODDIR/service.log"
CONFIG_FILE="$MODDIR/config/config.json"
JQ="$MODDIR/bin/jq"

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

_log() {
    printf '[%s] [restart] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

_log "收到手动重启请求"

pause_file="$PID_DIR/daemon.pause"
oplock_file="$PID_DIR/oplock"

# 持操作锁：覆盖守护进程重建窗口，WebUI 据此暂停刷新并禁用写操作
mkdir -p "$PID_DIR"
echo $$ >"$oplock_file"
# shellcheck disable=SC2064
trap "rm -f '$oplock_file'" EXIT HUP INT TERM

# 1. 通知守护进程挂起，终止 lumipro 实例
_log "通知守护进程挂起，清理 lumipro 实例"
touch "$pause_file"
[ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null

# 2. 清理遗留标记
rm -f "$pid_file"
rm -f "$flag_file"
rm -f "$PID_DIR/up.lock"
_log "已清理锁文件"

# 3. 恢复守护进程 (它会自动拉起新监听)
rm -f "$pause_file"

# 4. 守护进程未运行时 (亮度节点不可用导致服务未启动)，按需拉起
if ! pgrep -f "script/daemon.sh" >/dev/null 2>&1; then
    now_bri_file="$(get_cfg now_bri_file "$DEFAULT_NOW_BRI_FILE")"
    if [ ! -f "$now_bri_file" ]; then
        _log "亮度节点不存在 ($now_bri_file)，拒绝启动服务"
        echo "亮度节点不存在: $now_bri_file，无法启动服务，请先在配置页填写正确路径" >&2
        exit 1
    fi
    _log "守护进程未运行，正在启动"
    sh "$MODDIR/script/daemon.sh" &
    _log "守护进程已启动 (PID: $!)"
else
    _log "守护进程已恢复，等待自动拉起监听"
fi

# 5. 等待新监听就绪，让操作锁覆盖守护进程重建窗口
wait_i=0
while [ "$wait_i" -lt 15 ]; do
    if [ -f "$pid_file" ]; then
        new_pid="$(cat "$pid_file" 2>/dev/null)"
        if [ "$new_pid" = "polling" ] || { [ -n "$new_pid" ] && [ -d "/proc/$new_pid" ]; }; then
            _log "新监听已就绪 (PID: $new_pid)"
            break
        fi
    fi
    sleep 0.2
    wait_i=$((wait_i + 1))
done

exit 0

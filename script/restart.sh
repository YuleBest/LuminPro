#!/system/bin/sh
# LuminPro 服务重启脚本

MODDIR="${0%/*/*}"
PID_DIR="$MODDIR/pid"
pid_file="$PID_DIR/inotifyd.pid"
flag_file="$PID_DIR/up.flag"
now_bri_file="/sys/class/backlight/panel0-backlight/brightness"
log_file="$MODDIR/service.log"

_log() {
    printf '[%s] [service.restart] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

_log "正在手动重启服务..."

# 1. 杀死正在进行的 inotifyd
if [ -f "$pid_file" ]; then
    kill -9 "$(cat "$pid_file")" 2>/dev/null
    _log "已杀死现有 inotifyd ($(cat "$pid_file"))"
fi

# 2. 清理遗留文件
rm -f "$pid_file"
rm -f "$flag_file"
_log "已清理 pid 和 flag 文件"

# 3. 重新启动 inotifyd
inotifyd "$MODDIR/script/up.sh" "$now_bri_file:c" &
inotifyd_pid="$!"
echo "$inotifyd_pid" >"$pid_file"
_log "inotifyd ($inotifyd_pid) 重新启动成功"

exit 0

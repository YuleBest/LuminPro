#!/system/bin/sh
# LuminPro 服务重启脚本

MODDIR="${0%/*/*}"
PID_DIR="$MODDIR/pid"
pid_file="$PID_DIR/inotifyd.pid"
flag_file="$PID_DIR/up.flag"
log_file="$MODDIR/service.log"

_log() {
    printf '[%s] [restart] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

_log "收到手动重启请求"

pause_file="$PID_DIR/daemon.pause"

# 1. 通知守护进程挂起，终止 lumipro 实例
_log "通知守护进程挂起，清理 lumipro 实例"
touch "$pause_file"
[ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null

# 2. 清理遗留标记
rm -f "$pid_file"
rm -f "$flag_file"
rm -f "$PID_DIR/up.lock"
_log "已清理锁文件"

# 3. 恢复守护进程 (它会自动拉起新 inotifyd)
rm -f "$pause_file"
_log "守护进程已恢复，等待自动拉起监听"

exit 0

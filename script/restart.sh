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

_log "正在手动重启服务..."

pause_file="$PID_DIR/daemon.pause"

# 1. 强制通知守护进程并执行清理
_log "通知守护进程执行全局重置..."
touch "$pause_file"
killall -9 inotifyd 2>/dev/null
for p in $(pgrep -f "up.sh"); do
    [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null
done

# 2. 清理遗留标记
rm -f "$pid_file"
rm -f "$flag_file"
_log "已清理 pid 和 flag 锁文件"

# 3. 恢复守护进程 (它会自动拉起新 inotifyd)
rm -f "$pause_file"
_log "服务正在由守护进程重新拉起..."

exit 0

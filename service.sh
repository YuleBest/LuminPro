#!/system/bin/sh
#shellcheck shell=ash

MODDIR="${0%/*}"
CONFIG_DIR="$MODDIR/config"
log_file="$MODDIR/service.log"

_log() {
    printf '[%s] [service] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

# 等待系统就绪
sleep 30

_log "LuminPro 已启动"
_log "- 前台最大亮度: $(cat "$CONFIG_DIR/ui_max_bri.txt")"
_log "- 峰值最大亮度: $(cat "$CONFIG_DIR/max_bri.txt")"
_log "- 休眠时间: $(cat "$CONFIG_DIR/sleep_time.txt")"

_log "LuminPro 启动守护监控..."
chmod 755 "$MODDIR/script/up.sh"
chmod 755 "$MODDIR/script/daemon.sh"

# 启动守护进程
sh "$MODDIR/script/daemon.sh" &
_log "- 守护进程 PID: $!"

exit 0

#!/system/bin/sh
#shellcheck shell=ash

# LuminPro 模块启动入口：等待系统就绪后拉起 Go 守护进程

MODDIR="${0%/*}"
BIN="$MODDIR/bin/luminpro"
log_file="$MODDIR/service.log"

DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"

_log() {
    local level="${2:-INFO}"
    local ll
    ll="$("$BIN" config get log_level 2>/dev/null)"
    [ -n "$ll" ] || ll="info"
    case "$ll" in
    off) return ;;
    error) case "$level" in ERROR) ;; *) return ;; esac ;;
    warn) case "$level" in ERROR | WARN) ;; *) return ;; esac ;;
    esac
    printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "service" "$level" "$1" >>"$log_file"
}

# 等待系统就绪
sleep 30

# 清理上次遗留的标记文件
rm -f "$MODDIR/pid/"*.flag "$MODDIR/pid/"*.pause "$MODDIR/pid/"*.lock "$MODDIR/pid/oplock" "$MODDIR/pid/state.json" "$MODDIR/pid/.hdr_ratio_cache"

_log "LuminPro 服务启动" "INFO"

now_bri_file="$("$BIN" config get now_bri_file 2>/dev/null)"
[ -n "$now_bri_file" ] || now_bri_file="$DEFAULT_NOW_BRI_FILE"
_log "当前亮度节点: $now_bri_file" "INFO"

# 亮度节点不存在时不启动守护进程 (节点不可用的设备允许安装但功能保持关闭)
if [ ! -f "$now_bri_file" ]; then
    _log "亮度节点不存在: $now_bri_file，模块功能未启用" "ERROR"
    _log "请配置正确的亮度节点路径后，在 Web UI 中重启模块以启用" "WARN"
    exit 0
fi

chmod 755 "$BIN"
"$BIN" daemon >>"$log_file" 2>&1 &
_log "守护进程已启动 (PID: $!)" "SUCCESS"

exit 0

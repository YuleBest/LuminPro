#!/system/bin/sh
#shellcheck shell=ash

MODDIR="${0%/*}"
CONFIG_FILE="$MODDIR/config/config.json"
JQ="$MODDIR/bin/jq"
log_file="$MODDIR/service.log"

DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"
DEFAULT_MAX_BRI_FILE="/sys/class/backlight/panel0-backlight/max_brightness"

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
    local level="${2:-INFO}"
    printf '[%s] [%s] [%-8s] %s\n' "$(date '+%m-%d %H:%M:%S')" "service" "$level" "$1" >>"$log_file"
}

# 等待系统就绪
sleep 30

# 清理上次遗留的标记文件
rm -f "$MODDIR/pid/"*.flag "$MODDIR/pid/"*.pause "$MODDIR/pid/.hdr_ratio_cache"

_log "LuminPro 服务启动" "INFO"
_log "前台最大亮度: $(get_cfg ui_max_bri 0)" "INFO"
_log "峰值最大亮度: $(get_cfg max_bri 0)" "INFO"
_log "休眠时段: $(get_cfg sleep_time '')" "INFO"

now_bri_file="$(get_cfg now_bri_file "$DEFAULT_NOW_BRI_FILE")"
max_bri_file="$(get_cfg max_bri_file "$DEFAULT_MAX_BRI_FILE")"
_log "当前亮度节点: $now_bri_file" "INFO"
_log "最大亮度节点: $max_bri_file" "INFO"

_log "正在启动守护进程" "INFO"
chmod 755 "$MODDIR/script/up.sh"
chmod 755 "$MODDIR/script/daemon.sh"

sh "$MODDIR/script/daemon.sh" &
_log "守护进程已启动 (PID: $!)" "SUCCESS"

exit 0

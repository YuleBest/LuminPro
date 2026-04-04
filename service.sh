#!/system/bin/sh
#shellcheck shell=ash

MODDIR="${0%/*}"
CONFIG_DIR="$MODDIR/config"
PATH_CONFIG_DIR="$CONFIG_DIR/path"
log_file="$MODDIR/service.log"

# 默认设备路径
DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"
DEFAULT_MAX_BRI_FILE="/sys/class/backlight/panel0-backlight/max_brightness"

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

_log() {
    printf '[%s] [service] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

# 等待系统就绪
sleep 30

_log "LuminPro 已启动"
_log "- 前台最大亮度: $(cat "$CONFIG_DIR/ui_max_bri.txt")"
_log "- 峰值最大亮度: $(cat "$CONFIG_DIR/max_bri.txt")"
_log "- 休眠时间: $(cat "$CONFIG_DIR/sleep_time.txt")"

# 读取设备路径配置
now_bri_file="$(get_config "$PATH_CONFIG_DIR/now_bri_file.txt" "$DEFAULT_NOW_BRI_FILE")"
max_bri_file="$(get_config "$PATH_CONFIG_DIR/max_bri_file.txt" "$DEFAULT_MAX_BRI_FILE")"
_log "- 当前亮度节点: $now_bri_file"
_log "- 最大亮度节点: $max_bri_file"

_log "LuminPro 启动守护监控..."
chmod 755 "$MODDIR/script/up.sh"
chmod 755 "$MODDIR/script/daemon.sh"

# 启动守护进程
sh "$MODDIR/script/daemon.sh" &
_log "- 守护进程 PID: $!"

exit 0

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
    local level="${2:-INFO}"
    printf '[%s] [%s] [%-8s] %s\n' "$(date '+%m-%d %H:%M:%S')" "service" "$level" "$1" >>"$log_file"
}

# 等待系统就绪
sleep 30

# 清理上次遗留的标记文件
rm -f "$MODDIR/pid/"*.flag "$MODDIR/pid/"*.pause "$MODDIR/pid/.hdr_ratio_cache"

_log "LuminPro 服务启动" "INFO"
_log "前台最大亮度: $(cat "$CONFIG_DIR/ui_max_bri.txt")" "INFO"
_log "峰值最大亮度: $(cat "$CONFIG_DIR/max_bri.txt")" "INFO"
_log "休眠时段: $(cat "$CONFIG_DIR/sleep_time.txt")" "INFO"

# 读取设备路径配置
now_bri_file="$(get_config "$PATH_CONFIG_DIR/now_bri_file.txt" "$DEFAULT_NOW_BRI_FILE")"
max_bri_file="$(get_config "$PATH_CONFIG_DIR/max_bri_file.txt" "$DEFAULT_MAX_BRI_FILE")"
_log "当前亮度节点: $now_bri_file" "INFO"
_log "最大亮度节点: $max_bri_file" "INFO"

_log "正在启动守护进程" "INFO"
chmod 755 "$MODDIR/script/up.sh"
chmod 755 "$MODDIR/script/daemon.sh"

# 启动守护进程
sh "$MODDIR/script/daemon.sh" &
_log "守护进程已启动 (PID: $!)" "SUCCESS"

exit 0

#!/system/bin/sh
#shellcheck shell=ash
# LuminPro 守护进程

REAL_PATH="$(readlink -f "$0")"
SCRIPT_DIR="$(dirname "$REAL_PATH")"
MODDIR="$(dirname "$SCRIPT_DIR")"

PID_DIR="$MODDIR/pid"
CONFIG_FILE="$MODDIR/config/config.json"
JQ="$MODDIR/bin/jq"
pid_file="$PID_DIR/inotifyd.pid"
stop_file="$PID_DIR/stop.flag"
pause_file="$PID_DIR/daemon.pause"
log_file="$MODDIR/service.log"
config_cache_file="$PID_DIR/.config_cache"

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

get_config_hash() {
    local now_file events
    now_file="$(get_cfg now_bri_file "$DEFAULT_NOW_BRI_FILE")"
    events="$(get_cfg inotify_events "c")"
    echo "${now_file}|${events}"
}

_log() {
    local level="${2:-INFO}"
    local ll
    ll="$(get_cfg log_level "info")"
    case "$ll" in
    off) return ;;
    error) case "$level" in ERROR) ;; *) return ;; esac ;;
    warn) case "$level" in ERROR | WARN) ;; *) return ;; esac ;;
    esac
    printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "daemon" "$level" "$1" >>"$log_file"
}

mkdir -p "$PID_DIR"
_log "守护进程已启动" "INFO"

while true; do
    if [ -f "$stop_file" ]; then
        [ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null
        rm -f "$pid_file"
        _log "检测到停止信号，守护进程挂起" "WARN"
        sleep 5
        continue
    fi

    if [ -f "$pause_file" ]; then
        [ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null
        rm -f "$pid_file"
        sleep 1
        continue
    fi

    current_config="$(get_config_hash)"

    if [ -f "$config_cache_file" ]; then
        cached_config="$(cat "$config_cache_file")"
        if [ "$current_config" != "$cached_config" ]; then
            _log "检测到配置变更，重启监听进程" "INFO"
            [ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null
            rm -f "$pid_file"
            echo "$current_config" >"$config_cache_file"
            sleep 1
            continue
        fi
    else
        echo "$current_config" >"$config_cache_file"
    fi

    _log "正在启动 lumipro 监听" "INFO"
    now_bri_file="${current_config%|*}"
    inotify_events="${current_config#*|}"
    debug_mode="$(get_cfg debug_mode "0")"

    # 缓存当前监听路径（供参考）
    echo -n "$now_bri_file" >"$MODDIR/config/.cached_path"

    if [ "$debug_mode" = "1" ]; then
        "$MODDIR/bin/lumipro" --debug "$MODDIR/script/up.sh" "$now_bri_file:$inotify_events" >>"$log_file" 2>&1 &
    else
        "$MODDIR/bin/lumipro" "$MODDIR/script/up.sh" "$now_bri_file:$inotify_events" >>"$log_file" 2>&1 &
    fi
    inotify_pid=$!
    echo "$inotify_pid" >"$pid_file"
    _log "lumipro 已启动 (PID: $inotify_pid), 监听: $now_bri_file, 事件: $inotify_events" "SUCCESS"

    wait "$inotify_pid"
    _log "lumipro 进程 (PID: $inotify_pid) 已退出，即将重启" "WARN"

    sleep 0.5
done

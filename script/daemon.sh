#!/system/bin/sh
# LuminPro 守护进程 (Watchdog)

# 使用 readlink 获取脚本真实绝对路径
REAL_PATH="$(readlink -f "$0")"
SCRIPT_DIR="$(dirname "$REAL_PATH")"
MODDIR="$(dirname "$SCRIPT_DIR")"

PID_DIR="$MODDIR/pid"
CONFIG_DIR="$MODDIR/config"
PATH_CONFIG_DIR="$CONFIG_DIR/path"
pid_file="$PID_DIR/inotifyd.pid"
stop_file="$PID_DIR/stop.flag"
pause_file="$PID_DIR/daemon.pause"
log_file="$MODDIR/service.log"
config_cache_file="$PID_DIR/.config_cache"

# 默认设备路径
DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"

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

# 获取当前配置的哈希值（用于检测配置变化）
get_config_hash() {
    local now_file="$(get_config "$PATH_CONFIG_DIR/now_bri_file.txt" "$DEFAULT_NOW_BRI_FILE")"
    echo "$now_file"
}

# 日志函数
_log() {
    local level="${2:-INFO}"
    printf '[%s] [%-8s] [%-8s] %s\n' "$(date '+%m-%d %H:%M:%S')" "daemon" "$level" "$1" >>"$log_file"
}

# 确保环境就绪
mkdir -p "$PID_DIR"

_log "守护进程启动，开始监控配置文件..." "INFO"

while true; do
    # 检查是否需要手动停止或暂时挂起
    if [ -f "$stop_file" ]; then
        # 全局停止，杀掉现有并等待
        [ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null
        rm -f "$pid_file"
        _log "检测到停止信号，已暂停" "WARN"
        sleep 5
        continue
    fi

    if [ -f "$pause_file" ]; then
        # 暂时挂起（由 up.sh 处理中），杀掉现有并等待
        [ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null
        rm -f "$pid_file"
        sleep 1
        continue
    fi

    # 获取当前配置
    current_config="$(get_config_hash)"

    # 检查配置是否改变
    if [ -f "$config_cache_file" ]; then
        cached_config="$(cat "$config_cache_file")"
        if [ "$current_config" != "$cached_config" ]; then
            _log "✓ 配置文件已更新，重启监听进程..." "WARN"
            [ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null
            rm -f "$pid_file"
            echo "$current_config" >"$config_cache_file"
            sleep 1
            continue
        fi
    else
        # 第一次启动或缓存不存在，保存当前配置
        echo "$current_config" >"$config_cache_file"
    fi

    # 正常启动并监听
    _log "→ 启动 inotifyd 监听..." "INFO"
    now_bri_file="$current_config"

    # 更新缓存，让 up.sh 知道当前监听的是哪个文件
    echo -n "$now_bri_file" >"$PATH_CONFIG_DIR/.cached_path"

    # 启动并重定向 (不再使用子进程管道以保证 PID 抓取准确)
    inotifyd "$MODDIR/script/up.sh" "$now_bri_file:c" >>"$log_file" 2>&1 &

    inotify_pid=$!
    echo "$inotify_pid" >"$pid_file"
    _log "✓ inotifyd 已启动 (PID: $inotify_pid)" "SUCCESS"
    _log "  监听文件: $now_bri_file" "INFO"

    # 3. 通过 wait 阻塞，实时感知进程死亡 (兼容所有 BusyBox 环境)
    wait "$inotify_pid"
    _log "⚠ 监听进程 ($inotify_pid) 已退出，将在 1 秒后重启..." "WARN"

    sleep 0.5
done

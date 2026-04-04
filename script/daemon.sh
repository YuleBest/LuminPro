#!/system/bin/sh
# LuminPro 守护进程 (Watchdog)

# 使用 readlink 获取脚本真实绝对路径
REAL_PATH="$(readlink -f "$0")"
SCRIPT_DIR="$(dirname "$REAL_PATH")"
MODDIR="$(dirname "$SCRIPT_DIR")"

PID_DIR="$MODDIR/pid"
pid_file="$PID_DIR/inotifyd.pid"
stop_file="$PID_DIR/stop.flag"
pause_file="$PID_DIR/daemon.pause"
log_file="$MODDIR/service.log"
now_bri_file="/sys/class/backlight/panel0-backlight/brightness"

# 日志函数
_log() {
    printf '[%s] [daemon] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

# 确保环境就绪
mkdir -p "$PID_DIR"

while true; do
    # 检查是否需要手动停止或暂时挂起
    if [ -f "$stop_file" ]; then
        # 全局停止，杀掉现有并等待
        [ -f "$pid_file" ] && kill -9 "$(cat "$pid_file")" 2>/dev/null
        rm -f "$pid_file"
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

    # 正常启动并监听
    _log "启动 inotifyd 监听任务..."

    # 启动并重定向 (不再使用子进程管道以保证 PID 抓取准确)
    inotifyd "$MODDIR/script/up.sh" "$now_bri_file:c" >>"$log_file" 2>&1 &

    inotify_pid=$!
    echo "$inotify_pid" >"$pid_file"

    # 3. 通过 wait 阻塞，实时感知进程死亡 (兼容所有 BusyBox 环境)
    wait "$inotify_pid"
    _log "监听进程 ($inotify_pid) 已退出 (Code: $?)"

    sleep 0.5
done

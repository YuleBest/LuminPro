#!/system/bin/sh
#shellcheck shell=ash

MODDIR="${0%/*}"
CONFIG_DIR="$MODDIR/config"
PID_DIR="$MODDIR/pid"

now_bri_file="/sys/class/backlight/panel0-backlight/brightness"

# 配置文件路径
ui_max_bri_file="$CONFIG_DIR/ui_max_bri.txt"
max_bri_file="$CONFIG_DIR/max_bri.txt"
sleep_time_file="$CONFIG_DIR/sleep_time.txt"

pid_file="$PID_DIR/inotifyd.pid"
log_file="$MODDIR/service.log"

# inotifyd 用法:
# inotifyd 程序 文件[:掩码] ...
#
# 当文件发生与 掩码(MASK) 匹配的文件系统事件时，运行 程序(PROG)：
#   程序 事件 文件 [目录文件]
# 如果 程序(PROG) 为 "-"，则事件将发送到标准输出 (stdout)。
#
# 以下是针对“此文件”的事件：
#   a  已访问 (accessed)    c  已修改 (modified)    e  元数据更改 (metadata change)  w  已关闭 (可写)
#   r  已打开 (opened)      D  已删除 (deleted)     M  已移动 (moved)            0  已关闭 (不可写)
#   u  已卸载 (unmounted)   o  溢出 (overflow)      x  不可监控 (unwatchable)
#
# 以下是针对“此目录中”的文件事件：
#   m  移入 (moved in)      y  移出 (moved out)     n  已创建 (created)          d  已删除 (deleted)
# 当所有文件都发生 x 事件时，inotifyd 将退出（在等待程序运行结束后）。

# 监控当前亮度文件的日志
# # inotifyd - /sys/class/backlight/panel0-backlight/brightness
# c       /sys/class/backlight/panel0-backlight/brightness   # 已修改
# r       /sys/class/backlight/panel0-backlight/brightness   # 已打开
# a       /sys/class/backlight/panel0-backlight/brightness   # 已访问
# 0       /sys/class/backlight/panel0-backlight/brightness   # 已关闭(不可写)
# -- 经过了 1 亮度值的调整 --
# c       /sys/class/backlight/panel0-backlight/brightness
# r       /sys/class/backlight/panel0-backlight/brightness
# a       /sys/class/backlight/panel0-backlight/brightness
# 0       /sys/class/backlight/panel0-backlight/brightness
# ...

_log() {
    printf '[%s] [service] %s\n' "$(date '+%d %H:%M:%S.%3N')" "$1" >>"$log_file"
}

# 等待系统就绪
sleep 30

_log "LuminPro 已启动"
_log "- 前台最大亮度: $(cat "$ui_max_bri_file")"
_log "- 峰值最大亮度: $(cat "$max_bri_file")"
_log "- 休眠时间: $(cat "$sleep_time_file")"

mkdir -p "$PID_DIR"
[ -f "$pid_file" ] && rm -f "$pid_file"
[ -f "$PID_DIR/up.flag" ] && rm -f "$PID_DIR/up.flag"
chmod 755 "$MODDIR/script/up.sh"

# 启动 inotifyd 监控
inotifyd "$MODDIR/script/up.sh" "$now_bri_file:c" &
inotifyd_pid="$!"
echo "$inotifyd_pid" >"$pid_file"

exit 0

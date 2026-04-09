#!/system/bin/sh
#shellcheck shell=ash

# LuminPro 手动提升/恢复亮度触发脚本

MODDIR="$(dirname "$(readlink -f "$0")")"
CONFIG_FILE="$MODDIR/config/config.json"
JQ="$MODDIR/bin/jq"
PID_DIR="$MODDIR/pid"
BOOST_FLAG="$PID_DIR/boost.flag"

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

now_bri_file="$(get_cfg now_bri_file "$DEFAULT_NOW_BRI_FILE")"

if [ ! -f "$now_bri_file" ]; then
    exit 1
fi

if [ -f "$BOOST_FLAG" ]; then
    restore_bri="$(cat "$BOOST_FLAG" 2>/dev/null | tr -d ' \n')"
    [ -n "$restore_bri" ] && echo -n "$restore_bri" >"$now_bri_file" 2>/dev/null
    rm -f "$BOOST_FLAG"
else
    max_bri="$(get_cfg max_bri '')"
    if [ -z "$max_bri" ] || [ "$max_bri" = "0" ]; then
        exit 1
    fi
    now_bri="$(cat "$now_bri_file" 2>/dev/null | tr -d ' \n')"
    mkdir -p "$PID_DIR"
    echo -n "$now_bri" >"$BOOST_FLAG"
    echo -n "$max_bri" >"$now_bri_file" 2>/dev/null
fi

exit 0

# 默认设备路径
DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"

# 读取配置的路径，如果不存在则回退至默认值
if [ -f "$PATH_CONFIG_DIR/now_bri_file.txt" ]; then
    now_bri_file="$(cat "$PATH_CONFIG_DIR/now_bri_file.txt" 2>/dev/null | tr -d ' \n')"
fi
[ -z "$now_bri_file" ] && now_bri_file="$DEFAULT_NOW_BRI_FILE"

# 确保节点存在
if [ ! -f "$now_bri_file" ]; then
    exit 1
fi

if [ -f "$BOOST_FLAG" ]; then
    restore_bri="$(cat "$BOOST_FLAG" 2>/dev/null | tr -d ' \n')"
    if [ -n "$restore_bri" ]; then
        echo -n "$restore_bri" >"$now_bri_file" 2>/dev/null
    fi
    rm -f "$BOOST_FLAG"
else
    max_bri="$(cat "$CONFIG_DIR/max_bri.txt" 2>/dev/null | tr -d ' \n')"
    if [ -z "$max_bri" ]; then
        exit 1
    fi

    # 读取当前亮度并存档
    now_bri="$(cat "$now_bri_file" 2>/dev/null | tr -d ' \n')"

    mkdir -p "$PID_DIR"
    echo -n "$now_bri" >"$BOOST_FLAG"

    # 执行写入将亮度设定为峰值极限
    echo -n "$max_bri" >"$now_bri_file" 2>/dev/null
fi

exit 0

#!/system/bin/sh
# 快速切换脚本

MODDIR="/data/adb/modules/LuminPro"
PID_DIR="$MODDIR/pid"
STOP_FLAG="$PID_DIR/stop.flag"
UP_FLAG="$PID_DIR/up.flag"

# 切换逻辑
if [ -f "$STOP_FLAG" ]; then
    rm -f "$STOP_FLAG"
    echo "LuminPro: 服务已启用"
else
    touch "$STOP_FLAG"
    rm -f "$UP_FLAG"
    echo "LuminPro: 服务已暂停"
fi

exit 0

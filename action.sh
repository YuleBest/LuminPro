#!/system/bin/sh
#shellcheck shell=ash
# 快速启停切换（管理器「操作」按钮 / WebUI 调用）

MODDIR="/data/adb/modules/LuminPro"
PID_DIR="$MODDIR/pid"
STOP_FLAG="$PID_DIR/stop.flag"

if [ -f "$STOP_FLAG" ]; then
    rm -f "$STOP_FLAG"
    echo "LuminPro: 服务已启用"
else
    touch "$STOP_FLAG"
    echo "LuminPro: 服务已暂停"
fi

exit 0

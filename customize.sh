SKIPUNZIP=0
now_bri_file="/sys/devices/virtual/mi_display/disp_feature/disp-DSI-0/brightness_clone"
max_bri_file="/sys/devices/virtual/mi_display/disp_feature/disp-DSI-0/max_brightness_clone"
touch $MODPATH/modenable

error() {
    echo "! $1"
    echo "! 安装出现错误"
    abort
}

# 检查系统文件是否存在
if [ ! -f $now_bri_file ] && [ ! -f $max_bri_file ]; then
    error "系统文件不存在 $now_bri_file，您的设备不支持本模块"
fi

echo "⚠️ 刷入过程中，手机屏幕可能会变亮，这是正常现象"
. "$MODPATH/script/setup.sh"
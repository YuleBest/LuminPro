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

if [ -f "/sdcard/峰值亮度.txt" ]; then
    max_bri_file="/sdcard/峰值亮度.txt"
fi

if [ ! -f $max_bri_file ]; then
    echo "🤔 未找到记录峰值亮度的文件，你需要使用手动设定亮度模式"
    echo "😃 请根据教程获取你手机的峰值亮度，然后在 /sdcard/峰值亮度.txt 里填写你手机的峰值亮度，再重新刷入哦"
    touch /sdcard/峰值亮度.txt
    abort ""
fi

. "$MODPATH/script/setup.sh"
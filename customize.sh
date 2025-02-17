# By Yule

# 定义变量
bri_file="/sys/class/backlight/panel0-backlight/brightness"
max_bri_file="/sys/class/backlight/panel0-backlight/max_brightness"
max_test=0

button_listener() {
    local choose
    local branch
    while :; do
        choose="$(getevent -qlc 1 | awk '{ print $3 }')"
        case "$choose" in
            KEY_VOLUMEUP) branch="0" ;;
            KEY_VOLUMEDOWN) branch="1" ;;
            *) continue ;;
        esac
        echo "$branch"
        break
    done
}

# 检查亮度文件是否存在
check_bri_file() {
    if [[ ! -f $bri_file ]]; then
        echo " x 没有找到必要依赖文件: $bri_file"
        echo " x 退出安装流程"
        abort
    else
        echo " - 找到了必要依赖文件: $bri_file"
    fi
    
    if [[ ! -f $max_bri_file ]]; then
        echo " ! 没有找到非必要依赖文件: $max_bri_file"
        echo " ! 使用备用测试模式"
        max_test=1
    else
        echo " - 找到了非必要依赖文件: $max_bri_file"
        max_bri="$(cat $max_bri_file)"
    fi
}

touch /data/adb/modules/LuminPro/DONT-RUN
cat $MODPATH/NOTE.txt
echo ""
echo " [音量上键] 我了解并同意以上使用协议"
echo " [音量下键] 我不同意以上使用协议"

for i in $(seq 1 20); do
    echo ""
done

if [[ $(button_listener) == 0 ]]; then
    echo " - 你按下了音量上键"
    sleep 1
else
    abort
fi

echo "-----------------------------"
for i in $(seq 1 50); do
    echo ""
done

mkdir $MODPATH/yule

echo ""
echo " - 请在 10 秒内完成以下操作"
echo " [1] 下拉通知栏，关闭自动亮度"
echo " [2] 把亮度条拉满"
echo " [3] 完成后点击音量上键"
echo " - 正等待音量键响应……"
for i in $(seq 1 20); do
    echo ""
done

if [[ $(button_listener) == 0 ]]; then
    echo " - 你按下了音量上键"
    sleep 1
else
    echo " x 按键错误"
    abort
fi
echo ""

FD_BRI="$(cat $bri_file)"
echo -n "$FD_BRI" > $MODPATH/yule/FDBRI
echo " ~ 前台亮度测试完毕：$FD_BRI"

# 测试峰值亮度
if [[ $max_test == 1 ]]; then
    echo " - 开始测试峰值亮度"
    echo " - 屏幕可能会短暂变亮，属于正常现象"

    echo -n "10000" > $bri_file
    sleep 4
    MAXBRI="$(cat $bri_file)"
else
    MAXBRI="$(cat $max_bri_file)"
fi

echo -n "$MAXBRI" > $MODPATH/yule/MAXBRI
echo " ~ 峰值亮度测试完毕：$MAXBRI"
echo ""

sleep 1
echo " - 模块策略："
echo "   亮度达到 $FD_BRI 时，提升到 $MAXBRI"
echo ""
rm -f /data/adb/modules/LuminPro/DONT-RUN

# 刷入完成
echo " ~ 刷入完成，感谢您的使用"
echo "   设置：  /data/adb/modules/LuminPro/CONFIG.prop"
echo "   反馈：  /data/adb/modules/LuminPro/feedback.sh"
for i in $(seq 1 20); do
    echo ""
done

exit 0
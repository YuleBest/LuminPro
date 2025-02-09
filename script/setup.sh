# By Yule
now_bri_file="/sys/devices/virtual/mi_display/disp_feature/disp-DSI-0/brightness_clone"

error() {
    echo "❓ $1"
    echo "❌ 安装出现错误"
    exit 1
}

# 获取 Magisk 版本以决定要不要使用 action.sh
magisk_version=$(magisk -V)
if [ $magisk_version -ge "28000" ]; then
    echo "😚 Magisk 版本符合要求，开启 action.sh"
    cp $MODPATH/script/action.sh $MODPATH/
else
    echo "😅 Magisk 版本不符合要求，不开启 action.sh"
fi

# 提示用户把亮度拉满进行测试
echo ""
echo "😎 将进行亮度测试"
echo "1️⃣ 请下拉控制中心，关闭自动亮度后将亮度拉满"
echo "2️⃣ 等待几秒"
for i in $(seq 0 10); do
    time=$(expr 10 - $i)
    echo "- $time 秒后应用当前亮度"
    sleep 1
done
echo ""

now_bri=$(cat $now_bri_file)
lim_bri="$now_bri"
[ -f $max_bri_file ] && max_bri=$(cat $max_bri_file)
echo ""
echo "🤓 手机前台亮度限制为: $lim_bri"
break

if [ -f "/sdcard/峰值亮度.txt" ]; then
    $max_bri=$(cat "/sdcard/峰值亮度.txt")
fi
echo "🤗 手机峰值亮度为:    $max_bri"

echo -n $now_bri > $MODPATH/brightness/now
echo -n $lim_bri > $MODPATH/brightness/lim
echo -n $max_bri > $MODPATH/brightness/max
touch $MODDIR/modenable

echo "✅ 安装完成，请重启手机 ✅"
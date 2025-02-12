# By Yule
now_bri_file="/sys/devices/virtual/mi_display/disp_feature/disp-DSI-0/brightness_clone"

error() {
    echo "❓ $1"
    echo "❌ 安装出现错误"
    exit 1
}

# 提示用户把亮度拉满进行测试
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
echo ""
echo "🤓 手机前台亮度限制为: $lim_bri"
break

echo "😎 进行峰值亮度测试，手机屏幕会变亮"
echo -n "30000" > $now_bri_file
sleep 2
max_bri=$(cat $now_bri_file)

echo "🤗 手机峰值亮度为:    $max_bri"
echo -n "$lim_bri" > $now_bri_file

echo -n $now_bri > $MODPATH/brightness/now
echo -n $lim_bri > $MODPATH/brightness/lim
echo -n $max_bri > $MODPATH/brightness/max
touch $MODDIR/modenable

echo "✅ 安装完成，请重启手机 ✅"
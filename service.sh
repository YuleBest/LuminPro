#!/system/bin/sh
# 服务脚本
# By Yule
sleep 1

# 定义一些要使用的变量
MODDIR=${0%/*}
dec_file_temp="$MODDIR/more/module.prop.template"
dec_file_tempb="$MODDIR/more/module.prop.template.b"
dec_file="$MODDIR/module.prop"
now_bri_file="/sys/devices/virtual/mi_display/disp_feature/disp-DSI-0/brightness_clone"
max_bri_file="$MODDIR/brightness/max"
lim_bri_file="$MODDIR/brightness/lim"
lim_bri=$(cat $lim_bri_file)
touch $MODDIR/modenable
inj_bri=''

# 读取配置
. $MODDIR/config.prop
echo $MODDIR > $MODDIR/script/moddir

# 所有输出导出到日志
exec >> "$MODDIR/service.sh.log" 2>&1

# 识别是否自定义了亮度
custom_check() {
    if [ $customize_limbrightness = "default" ]; then
        lim_bri="$(cat $lim_bri_file)"
    else
        lim_bri="$customize_limbrightness"
    fi
    if [ $customize_maxbrightness = "default" ]; then
        max_bri="$(cat $max_bri_file)"
    else
        max_bri="$customize_maxbrightness"
    fi
}

dec_up() {
    cp $dec_file_temp $dec_file_tempb
    echo -n "$1" >> $dec_file_tempb
    cp $dec_file_tempb $dec_file
}

dec_success() {
    dec_up "模块状态 调整完成 | 当前亮度 ${now_bri} | 前台最高 ${lim_bri} | 峰值亮度 ${max_bri} | 刷新间隔 ${flash_interval}s"
}

dec_failure() {
    dec_up "模块状态 调整失败，请检查日志 ${MODDIR}/service.sh.log | 当前亮度 ${now_bri} | 前台最高 ${lim_bri} | 极限亮度 ${max_bri} | 刷新间隔 ${flash_interval}s"
}

bri_up() {
    now_bri=$(cat "$now_bri_file")
    inj_bri=$((now_bri + eve_bri))
    echo -n "$inj_bri" > "$now_bri_file"
    # echo "$now_bri"
}

bri_promot() {
    mod_info="调整中"
    dif_bri=$((max_bri - now_bri))
    eve_bri=$((dif_bri / 50))
    for step in $(seq 1 50); do
        bri_up
    done
    now_bri=$(cat $now_bri_file)
    if [ $now_bri -lt $max_bri ]; then
        echo -n "$max_bri" > $now_bri_file
    fi
}

# 循环检查
while true; do
    . $MODDIR/config.prop
    custom_check
    now_bri=$(cat $now_bri_file)
    lim_bri=$(cat $lim_bri_file)

    if [ -f $MODDIR/modenable ]; then
        mod_info="😋启用"
    else
        mod_info="😭关闭"
    fi
    dec_up "模块状态 ${mod_info} | 当前亮度 ${now_bri} | 前台最高 ${lim_bri} | 峰值亮度 ${max_bri} | 刷新间隔 ${flash_interval}s"

    if [ -f $MODDIR/modenable ] && [ $now_bri -eq $lim_bri ]; then
        bri_promot
        if [ $? -eq 0 ]; then
            dec_success
        else
            dec_failure
        fi
    fi
    # echo $now_bri
    echo -n $now_bri > $MODDIR/brightness/now
    sleep $flash_interval
done
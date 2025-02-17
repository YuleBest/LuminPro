#!/system/bin/sh
# By Yule

# 配置参数
MODDIR=${0%/*}
FDBRI=$(cat $MODDIR/yule/FDBRI)
MAXBRI=$(cat $MODDIR/yule/MAXBRI)
BRI_PATH="/sys/class/backlight/panel0-backlight/brightness"
. $MODDIR/CONFIG.prop

# 日志记录函数
log() {
    echo "[$(date "+%m-%d %T")] [$1] : $2" >> $MODDIR/service.log
}

# 模块介绍更新函数
dec_up() {
    sed -i '$ d' $MODDIR/module.prop
    echo -n "description=" >> $MODDIR/module.prop
    echo -n "$1" >> $MODDIR/module.prop
}

# 个性化处理
CONFIG_UPDATE() {
    . $MODDIR/CONFIG.prop
    if [[ -z $custom_max_bri || $custom_max_bri == 0 ]]; then
        log "I" "检测到 custom_max_bri 为 0 或空，这次循环用的是默认值 $MAXBRI"
    else
        log "I" "检测到 custom_max_bri 为 $custom_max_bri，这次循环用的是自定义值哦"
        MAXBRI=$custom_max_bri
    fi
    if [[ -z $custom_thr_bri || $custom_thr_bri == 0 ]]; then
        log "I" "检测到 custom_thr_bri 为 0 或空，这次循环用的是默认值 $FDBRI"
    else
        log "I" "检测到 custom_thr_bri 为 $custom_thr_bri，这次循环用的是自定义值哦"
        FDBRI=$custom_thr_bri
    fi
    if [[ -z $boost_wait_time || $boost_wait_time == "" ]]; then
        log "W" "boost_wait_time 参数无效，已重置为 30"
        boost_wait_time=30
    fi
    if [[ -z $flash_wait_time || $flash_wait_time == "" ]]; then
        log "W" "flash_wait_time 参数无效，已重置为 3"
        flash_wait_time=3
    fi
    if [[ $bri_update_mode != 1 && $bri_update_mode != 2 ]]; then
        log "W" "bri_update_mode 参数无效，已重置为 1"
        boost_wait_time=1
    fi
}

# 提升亮度处理
# 我们需要更平滑的体验 (^ｰ^)
UPDATE_CALCULATION() {
    FOOTSTEP=$(( ( $MAXBRI - $FDBRI ) / $step_num ))
    log "I" "调整步长 FOOTSTEP 为 $FOOTSTEP"
}

BRI_UPDATE() {
    local NOWBRI
    NOWBRI=$FDBRI
    if [[ $bri_update_mode == 1 ]]; then
        log "GO" "bri_update_mode 为 $bri_update_mode，亮度从 $FDBRI 提升到 $MAXBRI"
    elif [[ $bri_update_mode == 2 ]]; then
        log "GO" "bri_update_mode 为 $bri_update_mode，亮度分 $step_num 步从 $FDBRI 提升到 $MAXBRI"
        for step in $(seq 1 $step_num); do
            NOWBRI=$(( $NOWBRI + $FOOTSTEP ))
            echo -n "$NOWBRI" > $BRI_PATH
        done
    fi
    echo -n "$MAXBRI" > $BRI_PATH
}

# 亮度检查函数 (条件反馈)
BRI_CHECK() {
    local NOWBRI DIFBRI now_hour
    . $MODDIR/CONFIG.prop
    # 爬取当前值
    NOWBRI=$(cat $BRI_PATH)
    # 这里选择计算差值，而不是直接比较
    DIFBRI=$(( $FDBRI - $NOWBRI ))
        # 检测了 差值为小于0 且 现亮度小于等于激发亮度的十分之九 且 现亮度大于0(亮屏)
    if [[ $DIFBRI -le 0 && $NOWBRI -le $(( $MAXBRI * 9 / 10 )) && $NOWBRI -gt 0 ]]; then
        if [[ $sleep_start == 25 || $sleep_stop == 25 || -z $sleep_start || -z $sleep_stop ]]; then
            log "I" "时间规则未设置，不进行时间判断"
            ADJUSTMENT=1
        else
            # 这里通过for循环来进行遍历检测时间段
            for now_hour in $(seq $sleep_start $sleep_stop); do
                if [[ $(date +%H) == $now_hour ]]; then
                    ADJUSTMENT=0
                else
                    ADJUSTMENT=1
                fi
            done
        fi
    else
        ADJUSTMENT=0
    fi
    log "I" "NOWBRI 为 $NOWBRI，DIFBRI 为 $DIFBRI，now_hour 为 $now_hour，休眠规则为 $sleep_start 到 $sleep_stop 时，ADJUSTMENT 状态机设定为 $ADJUSTMENT"
}

# 日志清理函数
# 当日志达到 10000 字节就归档，归档的日志数达到 5 个就删除时间戳最小的
log_cleaner() {
    local log_size log_count min_file
    # 确保归档目录存在
    [ ! -d "$MODDIR/log-arch" ] && mkdir -p "$MODDIR/log-arch"
    # 计算当前日志文件大小
    log_size=$(wc -c < "$MODDIR/service.log")
    # 如果日志文件超过 100000 字节，进行归档
    if [[ $log_size -gt 100000 ]]; then
        archive_name="log-$(date '+%Y%m%d-%H%M%S').log"
        mv "$MODDIR/service.log" "$MODDIR/log-arch/$archive_name"
        log "I" "日志已归档为 $archive_name"
    fi
    # 统计归档日志数量
    log_count=$(find "$MODDIR/log-arch" -type f | wc -l)
    # 如果归档日志超过 5 个，删除最旧的
    if [[ $log_count -gt 5 ]]; then
        min_file=$(ls -t "$MODDIR/log-arch" | tail -n 1)
        rm -f "$MODDIR/log-arch/$min_file"
        log "I" "删除了最旧的归档日志 $min_file"
    fi
    # 删除 7 天前的日志
    find "$MODDIR/log-arch" -type f -mtime +7 -exec rm {} \;
}

CONFIG_UPDATE
log "I" "模块启动成功，将在 $boost_wait_time 秒后开始主循环喵"
sleep $boost_wait_time

# 主循环
# 这样一来，主循环的工作就简单多了喵
while true; do
    if  [[ ! -f $MODDIR/DONT-RUN ]]; then
        dec_up "[模块状态] 正常 | [当前亮度] $(cat $BRI_PATH) | [提升规则] $FDBRI → $MAXBRI | [刷新间隔] $flash_wait_time 秒"
        CONFIG_UPDATE
        UPDATE_CALCULATION
        ADJUSTMENT=0
        BRI_CHECK
        log_cleaner
        # 观察状态机
        if [[ $ADJUSTMENT == 1 ]]; then
            log "START" "满足条件，开始调整亮度"
            BRI_UPDATE
            log "STOP" "亮度调整完毕"
        else
            log "SKIP" "不满足条件，等待下次循环"
        fi
        log "OVER" "循环结束，$flash_wait_time 秒后开启下一次循环~"
    fi
    sleep $flash_wait_time
done
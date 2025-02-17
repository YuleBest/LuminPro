SCRDIR="$(dirname $(readlink -f $0))"
mkdir -p $SCRDIR/feedback

echo -e "获取设备信息"
getprop > $SCRDIR/feedback/phone-info.prop

echo -e "复制日志"
cp $SCRDIR/service.log $SCRDIR/feedback/service.log

echo -e "打包"
cd $SCRDIR/feedback
tar -cf /sdcard/feedback.tar .

echo -e ""
echo -e "请将 /sdcard/feedback.tar 发送给作者，这样才可以帮你有效解决问题！"
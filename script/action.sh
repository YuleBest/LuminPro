MODDIR=${0%/*}

if [ -f $MODDIR/modenable ]; then
    rm -f $MODDIR/modenable
    echo "- 已关闭模块"
else
    touch $MODDIR/modenable
    echo "- 已开启模块"
fi
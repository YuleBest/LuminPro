#!/system/bin/sh
MODDIR=${0%/*}
DRF="$MODDIR/DONT-RUN"
if [[ -f $DRF ]]; then
    rm -f $DRF
    echo "- 已启用模块"
else
    touch $DRF
    echo "- 已禁用模块"
fi
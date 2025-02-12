#!/bin/sh
SCRDIR="$(dirname $(readlink -f $0))"
MODDIR="$(dirname $(dirname $(readlink -f $0)))"
bri_max="$(cat $MODDIR/brightness/max)"
bri_now_f="/sys/devices/virtual/mi_display/disp_feature/disp-DSI-0/brightness_clone"
bri_now="$(cat $bri_now_f)"

# echo $SCRDIR
# echo $MODDIR
# echo $bri_max

echo "$bri_now" > $SCRDIR/latest-bri
echo -n "$bri_max" > $bri_now_f

exit 0
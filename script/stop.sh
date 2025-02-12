#!/bin/sh
SCRDIR="$(dirname $(readlink -f $0))"
MODDIR="$(dirname $(dirname $(readlink -f $0)))"
latest_bri=$(cat $SCRDIR/latest-bri)
bri_now_f="/sys/devices/virtual/mi_display/disp_feature/disp-DSI-0/brightness_clone"
bri_now="$(cat $bri_now_f)"

if [ $bri_now -gt $latest_bri ]; then
    echo -n "$latest_bri" > $bri_now_f
fi
rm -f $SCRDIR/latest-bri

exit 0
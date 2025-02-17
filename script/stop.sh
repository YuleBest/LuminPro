#!/bin/sh

SCRDIR="$(dirname $(readlink -f $0))"
MODDIR="$(dirname $(dirname $(readlink -f $0)))"
MAXBRI="$(cat $MODDIR/yule/MAXBRI)"
BRI_PATH="/sys/class/backlight/panel0-backlight/brightness"

echo -n "500" > $BRI_PATH
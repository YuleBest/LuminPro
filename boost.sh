#!/system/bin/sh
#shellcheck shell=ash

# LuminPro 手动提升/恢复亮度（转发到 Go 实现）

MODDIR="$(dirname "$(readlink -f "$0")")"
exec "$MODDIR/bin/luminpro" boost

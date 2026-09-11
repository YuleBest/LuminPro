#!/system/bin/sh
#shellcheck shell=ash

# LuminPro 服务重启脚本（转发到 Go 实现）

MODDIR="${0%/*/*}"
exec "$MODDIR/bin/luminpro" restart

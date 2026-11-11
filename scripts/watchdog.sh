#!/bin/bash
# Standalone Watchdog untuk Systemd cpns-bot
# Berjalan ringan, mengecek status systemd dan port 3055, TIDAK PERNAH spawn node langsung.

if ! systemctl is-active --quiet cpns-bot; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WATCHDOG] cpns-bot service inactive, restarting via systemctl..." >> /root/CPNS/watchdog.log
    systemctl restart cpns-bot
    exit 0
fi

# Cek apakah HTTP status 3055 merespon
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3055/status)
if [ "$HTTP_CODE" != "200" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WATCHDOG] Web portal unresponsive (code: $HTTP_CODE), restarting via systemctl..." >> /root/CPNS/watchdog.log
    systemctl restart cpns-bot
fi

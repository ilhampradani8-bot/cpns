#!/bin/bash
# DEPRECATED RUNNER SCRIPT
# CPNS Bot sekarang 100% dikelola secara native via Systemd (cpns-bot.service).
# File ini diamankan agar tidak memicu double process atau socket conflict jika terpanggil.

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Script run_daemon.sh deprecated. Mengalihkan ke systemctl start cpns-bot..." >> /root/CPNS/bot.log
systemctl start cpns-bot

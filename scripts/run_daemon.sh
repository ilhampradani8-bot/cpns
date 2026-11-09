#!/bin/bash
# Runner 24/7 untuk Bot WhatsApp CPNS di UTM
DIR="/root/CPNS"
cd "$DIR" || exit 1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Memulai Daemon Bot WhatsApp CPNS..." >> /root/CPNS/bot.log

while true; do
  node index.js >> /root/CPNS/bot.log 2>&1
  EXIT_CODE=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot berhenti (exit code: $EXIT_CODE). Restart dalam 5 detik..." >> /root/CPNS/bot.log
  sleep 5
done


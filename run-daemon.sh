#!/usr/bin/env bash
# CPNS Bot WhatsApp Daemon Runner
# Menjalankan bot di background dengan auto-restart jika terputus

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

LOG_FILE="$DIR/bot.log"
PID_FILE="$DIR/bot.pid"

case "$1" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "⚠️ Bot CPNS sudah berjalan (PID: $(cat "$PID_FILE"))."
      exit 0
    fi
    echo "🚀 Memulai Bot CPNS di background..."
    nohup node index.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "✅ Bot CPNS aktif dengan PID $(cat "$PID_FILE"). Log: $LOG_FILE"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      echo "🛑 Menghentikan Bot CPNS (PID: $PID)..."
      kill "$PID" 2>/dev/null || true
      rm -f "$PID_FILE"
      echo "✅ Bot CPNS telah dihentikan."
    else
      echo "⚠️ File PID tidak ditemukan. Mencari proses node index.js..."
      pkill -f "node index.js" || true
    fi
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "🟢 Bot CPNS AKTIF (PID: $(cat "$PID_FILE"))."
    else
      echo "🔴 Bot CPNS NON-AKTIF."
    fi
    ;;
  logs)
    tail -f -n 50 "$LOG_FILE"
    ;;
  *)
    echo "Penggunaan: $0 {start|stop|status|logs}"
    exit 1
    ;;
esac


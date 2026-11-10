const { execFile } = require('child_process');
const path = require('path');
const whitelist = require('./whitelist');

const PYTHON_SCRIPT = path.join(__dirname, '../scripts/fetch_google_alerts.py');

// State tracker
let isRunning = false;
let checkInterval = null;

/**
 * Execute Python IMAP fetcher
 * @param {boolean} previewOnly - If true, don't mark items as processed in DB
 * @returns {Promise<{success: boolean, count: number, items: Array}>}
 */
function runPythonFetcher(previewOnly = false) {
  return new Promise((resolve) => {
    const args = previewOnly ? ['--preview'] : [];
    execFile('python3', [PYTHON_SCRIPT, ...args], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[GoogleAlert] Python execution error:', error.message);
        return resolve({ success: false, error: error.message, items: [] });
      }
      try {
        const data = JSON.parse(stdout);
        return resolve(data);
      } catch (parseErr) {
        console.error('[GoogleAlert] JSON parse error from python:', parseErr.message, stdout);
        return resolve({ success: false, error: parseErr.message, items: [] });
      }
    });
  });
}

/**
 * Format a single article into a neat WhatsApp message with summary
 */
function formatAlertMessage(article) {
  const wibTime = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const summary = article.ai_summary || article.summary || '_(Rangkuman tidak tersedia)_';

  return (
    `📢 *GOOGLE ALERT: UPDATE BERITA CPNS TERBARU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *Update:* ${wibTime} WIB\n\n` +
    `📰 *${article.title}*\n\n` +
    `💡 *Intisari Berita (AI Summary):*\n` +
    `${summary}\n\n` +
    `🔗 *Sumber Lengkap:*\n` +
    `${article.url}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Asisten CPNS Hub • Rangkuman AI Groq 24/7_`
  );
}

/**
 * Format multiple articles into one daily digest message if several arrive at once
 */
function formatDigestMessage(articles) {
  const wibTime = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  let msg =
    `📢 *GOOGLE ALERTS: RANGKUMAN HARIAN BERITA CPNS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *Edisi Harian:* ${wibTime} WIB\n` +
    `📊 *Total Update:* ${articles.length} Artikel Terpilih\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  articles.slice(0, 4).forEach((art, index) => {
    const summary = art.ai_summary || art.summary || '';
    msg += `📌 *${index + 1}. ${art.title}*\n`;
    if (summary) {
      msg += `💡 *Rangkuman Mendalam (AI Groq):*\n${summary}\n`;
    }
    msg += `🔗 *Sumber Resmi:* ${art.url}\n\n`;
  });

  msg +=
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Asisten CPNS Hub • Edisi Harian Otomatis 24/7_`;

  return msg;
}

/**
 * Check for new Google Alerts and send to all registered CPNS groups
 */
async function checkAndBroadcastAlerts(sock, forcePreview = false) {
  if (isRunning) return;
  isRunning = true;

  try {
    const wl = whitelist.loadWhitelist();
    const groupJids = Object.keys(wl.groups || {});
    if (groupJids.length === 0) {
      isRunning = false;
      return;
    }

    console.log('[GoogleAlert] 🔍 Memeriksa email Google Alerts CPNS...');
    const result = await runPythonFetcher(forcePreview);

    if (result.success && Array.isArray(result.items) && result.items.length > 0) {
      console.log(`[GoogleAlert] 📬 Ditemukan ${result.items.length} berita alert CPNS baru!`);

      // Kirim dalam bentuk digest atau per artikel jika hanya 1-2 artikel
      const broadcastTexts = [];
      if (result.items.length <= 2) {
        for (const art of result.items) {
          broadcastTexts.push(formatAlertMessage(art));
        }
      } else {
        broadcastTexts.push(formatDigestMessage(result.items));
      }

      for (const text of broadcastTexts) {
        for (const jid of groupJids) {
          try {
            await sock.sendMessage(jid, { text });
            console.log(`[GoogleAlert] ✅ Terkirim ke grup ${jid}`);
            await new Promise(r => setTimeout(r, 1500)); // Delay antar grup
          } catch (sendErr) {
            console.error(`[GoogleAlert] Gagal kirim ke ${jid}:`, sendErr.message);
          }
        }
      }
    } else {
      console.log('[GoogleAlert] Tidak ada berita baru atau semua sudah terkirim sebelumnya.');
    }
  } catch (err) {
    console.error('[GoogleAlert] Error pada checkAndBroadcastAlerts:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Manual fetch for user request in chat (e.g. ketik "berita cpns")
 */
async function getLatestNewsForChat() {
  const result = await runPythonFetcher(true); // Preview only
  if (!result.success || !result.items || result.items.length === 0) {
    return null;
  }
  return formatDigestMessage(result.items.slice(0, 3));
}

/**
 * Start background scheduler:
 * - Checks every 30 minutes
 * - Also checks at 07:00 WIB and 18:00 WIB daily
 */
function startAlertWorker(sock) {
  if (checkInterval) clearInterval(checkInterval);

  console.log('[GoogleAlert] 📬 Background Google Alert Worker aktif (Cek berkala & jadwal harian).');

  // Cek pertama kali setelah bot running 30 detik
  setTimeout(() => {
    checkAndBroadcastAlerts(sock, false);
  }, 30000);

  // Interval per 30 menit
  checkInterval = setInterval(() => {
    checkAndBroadcastAlerts(sock, false);
  }, 30 * 60 * 1000);
}

module.exports = {
  checkAndBroadcastAlerts,
  getLatestNewsForChat,
  startAlertWorker,
  formatAlertMessage,
  formatDigestMessage
};


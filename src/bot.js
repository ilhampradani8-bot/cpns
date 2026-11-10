const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('./commandHandler');
const alarmService = require('./alarmService');
const googleAlertService = require('./googleAlertService');
const webServer = require('./webServer');
const messageQueue = require('./messageQueue');

// Anti-crash
process.on('uncaughtException', (err) => {
  console.error('[CPNS-Bot Anti-Crash] Exception:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CPNS-Bot Anti-Crash] Rejection:', reason?.message || reason);
});

// Single instance lock
const LOCK_FILE = '/tmp/cpns-bot.lock';
function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      if (!isNaN(existingPid) && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0);
          console.error(`[ProcessLock] 🛑 Terdeteksi bot CPNS lain (PID ${existingPid}) sedang berjalan!`);
          process.exit(0);
        } catch (_) {}
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  } catch (_) {}
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      if (pid === process.pid) fs.unlinkSync(LOCK_FILE);
    }
  } catch (_) {}
}

acquireLock();
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

const AUTH_DIR = path.join(__dirname, '../auth_info');
const CONFIG_PATH = path.join(__dirname, '../config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (_) {
    return { pairingCode: { enabled: false, phoneNumber: '' } };
  }
}

// Inisialisasi Web Server Login (Port 3055)
let webServerInstance = null;
try {
  webServerInstance = webServer.startWebServer(3055);
} catch (e) {
  console.log('[WebServer] Web server sudah berjalan atau port in use.');
}

async function startBot() {
  const config = loadConfig();
  console.log('==============================================');
  console.log('📚 MEMULAI BOT WHATSAPP CPNS (UTM HOST)...');
  console.log('==============================================');

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1043857760];
    let isLatest = true;
    try {
      const v = await fetchLatestBaileysVersion();
      if (v?.version) {
        version = v.version;
        isLatest = v.isLatest;
      }
    } catch (_) {
      console.log('[Baileys] Jaringan offline saat cek versi Baileys, memakai fallback versi cache.');
    }
    console.log(`[Baileys] Versi: ${version.join('.')} (Latest: ${isLatest})`);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: true,
      getMessage: async () => undefined
    });

  // Pasang handler request pairing code dari web UI
  webServer.setPairingRequestHandler(async (phoneNumber) => {
    return await sock.requestPairingCode(phoneNumber);
  });

  // Pairing code mode via CLI flag
  const usePairing = process.argv.includes('--pairing') || config.pairingCode?.enabled;
  if (usePairing && !sock.authState.creds.registered) {
    let phoneNumber = config.pairingCode?.phoneNumber;
    if (phoneNumber) {
      phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          webServer.setPairingCode(code);
          console.log('\n==============================================');
          console.log(`🔑 PAIRING CODE BOT CPNS: [ ${code} ]`);
          console.log('Buka WhatsApp HP > Perangkat Tertaut > Tautkan dengan nomor telepon');
          console.log('==============================================\n');
        } catch (err) {
          console.error('[PairingCode] Gagal request code:', err.message);
        }
      }, 3000);
    }
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      webServer.setQr(qr);
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║               SCAN QR CODE LOGIN BOT CPNS                  ║');
      console.log('╠════════════════════════════════════════════════════════════╣');
      qrcode.generate(qr, { small: true });
      console.log('\n🌐 Atau buka di browser: http://localhost:3055');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      const reason = (lastDisconnect?.error)?.output?.payload?.message || lastDisconnect?.error?.message || 'Unknown';
      console.log(`[Koneksi] Putus: ${reason}. Rekoneksi: ${shouldReconnect}`);
      webServer.setDisconnected(reason);

      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log('❌ Sesi logout. Hapus folder auth_info lalu jalankan ulang.');
      }
    } else if (connection === 'open') {
      console.log('✅ BOT WHATSAPP CPNS BERHASIL AKTIF & TERHUBUNG!');
      console.log(`🆔 ID Bot: ${sock.user?.id || 'Connected'}`);
      console.log('🤖 Menunggu perintah CRUD di grup CPNS / testing pribadi...');
      console.log('----------------------------------------------');
      webServer.setConnected(sock.user?.id || 'Connected');
      // Aktifkan background alarm scheduler
      alarmService.startAlarmWorker(sock);
      // Aktifkan background Google Alerts monitor
      googleAlertService.startAlertWorker(sock);
    }
  });

  // Event pesan masuk dengan Anti-Duplicate, Anti-Stale, & Sequential Queue
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type === 'notify' && Array.isArray(m.messages)) {
        for (const msg of m.messages) {
          if (messageQueue.shouldProcessMessage(msg)) {
            const jid = msg.key?.remoteJid;
            if (jid) {
              messageQueue.enqueue(jid, () => handleMessage(sock, msg));
            }
          }
        }
      }
    } catch (err) {
      console.error('[MessageUpsert Error]:', err.message);
    }
  });

  return sock;
  } catch (err) {
    console.error('[CPNS-Bot Start Error]:', err?.message || err);
    console.log('[CPNS-Bot] Menjadwalkan start ulang dalam 5 detik...');
    setTimeout(startBot, 5000);
    return null;
  }
}

module.exports = { startBot };


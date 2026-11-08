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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function startBot() {
  const config = loadConfig();
  console.log('==============================================');
  console.log('📚 MEMULAI BOT WHATSAPP CPNS (CRUD SYSTEM)...');
  console.log('==============================================');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
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

  // Pairing code mode
  const usePairing = process.argv.includes('--pairing') || config.pairingCode?.enabled;
  if (usePairing && !sock.authState.creds.registered) {
    let phoneNumber = config.pairingCode?.phoneNumber;
    if (!phoneNumber) {
      phoneNumber = await question('\n📱 Masukkan Nomor WhatsApp untuk Bot CPNS (contoh: 628123456789): ');
    }
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log('\n==============================================');
        console.log(`🔑 PAIRING CODE BOT CPNS: [ ${code} ]`);
        console.log('Buka WhatsApp HP > Perangkat Tertaut > Tautkan dengan nomor telepon');
        console.log('==============================================\n');
      } catch (err) {
        console.error('[PairingCode] Gagal request code:', err.message);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairing) {
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║               SCAN QR CODE LOGIN BOT CPNS                  ║');
      console.log('╠════════════════════════════════════════════════════════════╣');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      const reason = (lastDisconnect?.error)?.output?.payload?.message || lastDisconnect?.error?.message || 'Unknown';
      console.log(`[Koneksi] Putus: ${reason}. Rekoneksi: ${shouldReconnect}`);

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
    }
  });

  // Event pesan masuk
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe) {
            await handleMessage(sock, msg);
          }
        }
      }
    } catch (err) {
      console.error('[MessageUpsert Error]:', err.message);
    }
  });

  return sock;
}

module.exports = { startBot };


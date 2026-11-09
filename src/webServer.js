const http = require('http');

let currentQr = null;
let currentPairingCode = null;
let botStatus = 'Memulai...';
let connectedUser = null;
let requestPairingFn = null;

function setQr(qr) {
  currentQr = qr;
  currentPairingCode = null;
  botStatus = 'Menunggu Scan QR Code...';
}

function setPairingCode(code) {
  currentPairingCode = code;
  botStatus = 'Menunggu Input Pairing Code di HP...';
}

function setConnected(user) {
  currentQr = null;
  currentPairingCode = null;
  botStatus = 'Terhubung';
  connectedUser = user;
}

function setDisconnected(reason) {
  currentQr = null;
  botStatus = `Terputus: ${reason}`;
  connectedUser = null;
}

function setPairingRequestHandler(fn) {
  requestPairingFn = fn;
}

function startWebServer(port = 3055) {
  const server = http.createServer(async (req, res) => {
    // API Status JSON
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: botStatus,
        hasQr: !!currentQr,
        qr: currentQr,
        pairingCode: currentPairingCode,
        connectedUser
      }));
    }

    // Request Pairing Code via Web
    if (req.url === '/request-pairing' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const phone = String(parsed.phoneNumber || '').replace(/[^0-9]/g, '');
          if (!phone || phone.length < 9) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Nomor telepon tidak valid.' }));
          }
          if (typeof requestPairingFn === 'function') {
            const code = await requestPairingFn(phone);
            setPairingCode(code);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, code }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Handler pairing belum siap.' }));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: err.message }));
        }
      });
      return;
    }

    // Halaman UI Utama
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const qrImageUrl = currentQr
      ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=15&data=${encodeURIComponent(currentQr)}`
      : '';

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Bot WhatsApp CPNS Hub</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #38bdf8; }
    p.subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .status-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 24px;
      background: ${connectedUser ? '#065f46' : '#854d0e'};
      color: ${connectedUser ? '#6ee7b7' : '#fef08a'};
    }
    .qr-container {
      background: #ffffff;
      padding: 16px;
      border-radius: 12px;
      display: inline-block;
      margin-bottom: 20px;
    }
    .qr-container img { display: block; width: 280px; height: 280px; }
    .pairing-box {
      background: #0f172a;
      border: 1px dashed #38bdf8;
      border-radius: 12px;
      padding: 16px;
      margin: 20px 0;
    }
    .pairing-code {
      font-family: monospace;
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 4px;
      color: #38bdf8;
      margin: 8px 0;
    }
    .input-group {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
    input[type="text"] {
      flex: 1;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid #475569;
      border-radius: 8px;
      color: #f8fafc;
      font-size: 14px;
    }
    button {
      padding: 10px 18px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover { background: #1d4ed8; }
    .instructions {
      text-align: left;
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.6;
      margin-top: 24px;
      border-top: 1px solid #334155;
      padding-top: 16px;
    }
    .instructions ol { padding-left: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📚 Bot WhatsApp CPNS Hub</h1>
    <p class="subtitle">Central Workspace UTM (Port 3055)</p>

    <div class="status-badge" id="badge">● ${botStatus}</div>

    ${connectedUser ? `
      <div style="background: #064e3b; border: 1px solid #059669; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
        <h3 style="color: #6ee7b7; margin-bottom: 8px;">✅ Berhasil Terhubung!</h3>
        <p style="font-size: 14px; color: #a7f3d0;">ID: <code>${connectedUser}</code></p>
        <p style="font-size: 13px; color: #6ee7b7; margin-top: 12px;">Bot siap merespon pesan di grup CPNS dan menjalankan alarm pengingat!</p>
      </div>
    ` : `
      ${currentPairingCode ? `
        <div class="pairing-box">
          <p style="font-size: 13px; color: #94a3b8;">Kode Tautan WhatsApp Anda:</p>
          <div class="pairing-code">${currentPairingCode}</div>
          <p style="font-size: 12px; color: #cbd5e1;">Buka WA > Perangkat Tertaut > Tautkan dengan nomor telepon</p>
        </div>
      ` : (currentQr ? `
        <div class="qr-container">
          <img src="${qrImageUrl}" alt="Scan QR Code WhatsApp" />
        </div>
        <p style="font-size: 13px; color: #cbd5e1; margin-bottom: 16px;">Scan QR code di atas menggunakan aplikasi WhatsApp di HP Anda.</p>
      ` : `
        <div style="padding: 40px; color: #94a3b8;">
          <p>⏳ Sedang menyiapkan sesi WhatsApp...</p>
        </div>
      `)}

      <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #334155;">
        <p style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">Atau gunakan <b>Pairing Code</b> tanpa scan kamera:</p>
        <div class="input-group">
          <input type="text" id="phoneInput" placeholder="Contoh: 628123456789" />
          <button onclick="requestPairing()">Minta Kode</button>
        </div>
      </div>
    `}

    <div class="instructions">
      <b>Cara Menghubungkan:</b>
      <ol>
        <li>Buka WhatsApp di ponsel Anda.</li>
        <li>Buka <b>Setelan / Pengaturan > Perangkat Tertaut</b>.</li>
        <li>Pilih <b>Tautkan Perangkat</b> lalu arahkan kamera ke QR code di atas.</li>
        <li>Atau pilih <i>"Tautkan dengan nomor telepon saja"</i> dan masukkan kode pairing 8 digit.</li>
      </ol>
    </div>
  </div>

  <script>
    async function checkStatus() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        if (data.status === 'Terhubung' && !location.search.includes('connected')) {
          location.search = '?connected=1';
        }
      } catch (_) {}
    }
    setInterval(checkStatus, 3000);

    async function requestPairing() {
      const phone = document.getElementById('phoneInput').value.trim();
      if (!phone) return alert('Silakan masukkan nomor telepon!');
      try {
        const res = await fetch('/request-pairing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: phone })
        });
        const data = await res.json();
        if (data.success) {
          alert('Kode pairing berhasil dibuat: ' + data.code);
          location.reload();
        } else {
          alert('Gagal: ' + data.message);
        }
      } catch (e) {
        alert('Terjadi kesalahan: ' + e.message);
      }
    }
  </script>
</body>
</html>`;

    res.end(html);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 [Web Login QR] Panel login aktif di: http://localhost:${port} atau http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = {
  startWebServer,
  setQr,
  setPairingCode,
  setConnected,
  setDisconnected,
  setPairingRequestHandler
};


const { startBot } = require('./src/bot');

async function supervise() {
  while (true) {
    try {
      await startBot();
      break;
    } catch (err) {
      console.error('[CPNS-Bot Supervisor] Start gagal:', err?.message || err);
      console.log('[CPNS-Bot Supervisor] Menunggu 5 detik sebelum coba lagi...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

supervise();


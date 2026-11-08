const { startBot } = require('./src/bot');

startBot().catch(err => {
  console.error('[CPNS-Bot Fatal]', err);
});


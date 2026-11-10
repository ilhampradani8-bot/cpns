/**
 * Message Queue & Memory Manager for CPNS WhatsApp Bot
 * 1. Anti-Duplicate: Dedup recent message IDs (LRU Set, max 2000).
 * 2. Anti-Stale: Skip messages with timestamp older than MAX_AGE_SECONDS (e.g. 90s).
 * 3. Sequential Queue: Process incoming messages per JID sequentially to avoid race conditions.
 * 4. Memory Monitor: Monitor memory usage and auto-clean stale data.
 */

const MAX_PROCESSED_IDS = 2000;
const MAX_MESSAGE_AGE_SEC = 300; // Toleransi hingga 5 menit (mencegah pesan drop saat restart/reboot singkat)

const processedMsgIds = new Set();
const msgIdOrder = [];

// Per-JID FIFO queue
const chatQueues = new Map();

/**
 * Check whether message is valid to process (Not duplicate, Not stale)
 */
function shouldProcessMessage(msg) {
  if (!msg || !msg.key || msg.key.fromMe) return false;

  const msgId = msg.key.id;
  if (!msgId) return false;

  // 1. Anti-Duplicate Check
  if (processedMsgIds.has(msgId)) {
    return false;
  }

  // 2. Anti-Stale / Catch-up Check (Pencegahan pesan kemarin dibalas pagi ini)
  const msgTime = typeof msg.messageTimestamp === 'number'
    ? msg.messageTimestamp
    : (msg.messageTimestamp?.low || 0);

  if (msgTime > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - msgTime;
    if (ageSec > MAX_MESSAGE_AGE_SEC) {
      console.log(`[MessageQueue] ⏩ Mengabaikan pesan usang ID: ${msgId} (usia: ${ageSec} detik)`);
      return false;
    }
  }

  // Catat ID ke Set deduplikasi
  processedMsgIds.add(msgId);
  msgIdOrder.push(msgId);
  if (msgIdOrder.length > MAX_PROCESSED_IDS) {
    const oldest = msgIdOrder.shift();
    processedMsgIds.delete(oldest);
  }

  return true;
}

/**
 * Enqueue message handler per chat JID so they are processed in order without race conditions
 */
function enqueue(jid, task) {
  if (!chatQueues.has(jid)) {
    chatQueues.set(jid, Promise.resolve());
  }

  const previousPromise = chatQueues.get(jid);
  const nextPromise = previousPromise
    .then(async () => {
      try {
        await task();
      } catch (err) {
        console.error(`[MessageQueue Error in ${jid}]:`, err?.message || err);
      }
    })
    .finally(() => {
      // Bersihkan queue jika sudah tidak ada tugas tertunda
      if (chatQueues.get(jid) === nextPromise) {
        chatQueues.delete(jid);
      }
    });

  chatQueues.set(jid, nextPromise);
  return nextPromise;
}

/**
 * Memory Management & Stats
 */
function getMemoryStats() {
  const mem = process.memoryUsage();
  return {
    rssMb: (mem.rss / (1024 * 1024)).toFixed(1),
    heapUsedMb: (mem.heapUsed / (1024 * 1024)).toFixed(1),
    heapTotalMb: (mem.heapTotal / (1024 * 1024)).toFixed(1),
    processedIdsCount: processedMsgIds.size,
    activeQueuesCount: chatQueues.size
  };
}

module.exports = {
  shouldProcessMessage,
  enqueue,
  getMemoryStats
};

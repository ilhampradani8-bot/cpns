const fs = require('fs');
const path = require('path');

const PRIMARY_DATA_DIR = '/root/CPNS/data';
const FALLBACK_DATA_DIR = path.join(__dirname, '../../data/cpns');
const DATA_DIR = fs.existsSync(PRIMARY_DATA_DIR) ? PRIMARY_DATA_DIR : (fs.existsSync(FALLBACK_DATA_DIR) ? FALLBACK_DATA_DIR : path.join(__dirname, '../data'));
const ALARM_PATH = path.join(DATA_DIR, 'alarm_data.json');

const DAYS_NAME = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAlarms() {
  ensureDataDir();
  try {
    if (fs.existsSync(ALARM_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ALARM_PATH, 'utf-8'));
      if (Array.isArray(parsed.alarms)) return parsed;
    }
    const fallbackPath = path.join(FALLBACK_DATA_DIR, 'alarm_data.json');
    if (fs.existsSync(fallbackPath)) {
      const parsed = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
      if (Array.isArray(parsed.alarms)) {
        saveAlarms(parsed);
        return parsed;
      }
    }
  } catch (err) {
    console.error('[AlarmService] Gagal membaca data alarm:', err.message);
  }
  return { nextId: 1, alarms: [] };
}

function saveAlarms(data) {
  ensureDataDir();
  const tmp = `${ALARM_PATH}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, ALARM_PATH);
    return true;
  } catch (err) {
    console.error('[AlarmService] Gagal menyimpan data alarm:', err.message);
    if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

/**
 * Mendapatkan waktu sekarang dalam zona waktu Asia/Jakarta (WIB) secara presisi 100%
 * Mengabaikan perbedaan zona waktu host mesin (misal UTM Malaysia UTC+8 atau VPS UTC+0).
 */
function getWibNow() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', weekday: 'short' });
  const dayStr = dayFormatter.format(new Date());
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = days.indexOf(dayStr);

  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10);
  const day = parseInt(map.day, 10);
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);

  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const timeStr = `${map.hour}:${map.minute}`;
  const totalMinutes = hour * 60 + minute;

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek,
    dateStr,
    timeStr,
    totalMinutes
  };
}

function getTodayWibString() {
  return getWibNow().dateStr;
}

/**
 * Parsing teks jadwal mentah
 * Contoh input:
 * - "senin, 19:30"
 * - "15-11-2026, 08:00"
 * - "besok 14:00"
 * - "setiap hari 20:00"
 * - "19:30"
 */
function parseSchedule(scheduleRaw) {
  const raw = String(scheduleRaw || '').trim().toLowerCase();

  // 1. Ekstrak jam (HH:mm atau HH.mm)
  const timeMatch = raw.match(/(\b[0-2]?[0-9][:.][0-5][0-9]\b)/);
  if (!timeMatch) return null;
  const time = timeMatch[1].replace('.', ':').padStart(5, '0');

  // 2. Ekstrak tanggal (DD-MM-YYYY atau YYYY-MM-DD atau DD/MM/YYYY)
  const dateMatch = raw.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\b/) ||
                    raw.match(/\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/);

  const daysMap = {
    'minggu': 0, 'ahad': 0,
    'senin': 1,
    'selasa': 2,
    'rabu': 3,
    'kamis': 4,
    'jumat': 5,
    'sabtu': 6
  };

  let dayOfWeek = null;
  for (const [dayName, dayIndex] of Object.entries(daysMap)) {
    if (new RegExp('\\b' + dayName + '\\b', 'i').test(raw)) {
      dayOfWeek = dayIndex;
      break;
    }
  }

  const isDaily = /\b(setiap\s*hari|tiap\s*hari|daily)\b/i.test(raw);
  const isTomorrow = /\bbesok\b/i.test(raw);

  let scheduleType = 'daily';
  let targetDate = null;

  if (dateMatch) {
    scheduleType = 'date';
    if (dateMatch[3] && dateMatch[3].length === 4) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3];
      targetDate = `${year}-${month}-${day}`;
    } else {
      const year = dateMatch[1];
      const month = dateMatch[2].padStart(2, '0');
      const day = dateMatch[3].padStart(2, '0');
      targetDate = `${year}-${month}-${day}`;
    }
  } else if (isTomorrow) {
    scheduleType = 'date';
    const wib = getWibNow();
    const d = new Date(Date.UTC(wib.year, wib.month - 1, wib.day + 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    targetDate = `${y}-${m}-${day}`;
  } else if (dayOfWeek !== null) {
    scheduleType = 'weekly';
  } else if (isDaily) {
    scheduleType = 'daily';
  } else {
    scheduleType = 'daily';
  }

  return { scheduleType, targetDate, dayOfWeek, time };
}

/**
 * Parsing teks perintah alarm
 * Contoh:
 * alarm (senin, 19:30) metode (3x) pesan (Tryout Akbar)
 * alarm (15-11-2026, 08:00) metode (2x) pesan (Ujian SKD)
 * alarm 19:30 metode 3x pesan Belajar TIU
 */
function parseAlarmCommand(text) {
  // Pola 1: alarm (...) metode (...) pesan (...)
  let match = text.match(/^alarm\s*[\(\[]([^\)\]]+)[\)\]]\s*metode\s*[\(\[]([^\)\]]+)[\)\]]\s*pesan\s*[\(\[]([\s\S]+)[\)\]]$/i);
  if (match) {
    return { scheduleRaw: match[1].trim(), methodRaw: match[2].trim(), message: match[3].trim() };
  }

  // Pola 2: alarm (...) metode (...) pesan ...
  match = text.match(/^alarm\s*[\(\[]([^\)\]]+)[\)\]]\s*metode\s*[\(\[]([^\)\]]+)[\)\]]\s*pesan\s+([\s\S]+)$/i);
  if (match) {
    return { scheduleRaw: match[1].trim(), methodRaw: match[2].trim(), message: match[3].trim() };
  }

  // Pola 3: alarm ... metode ... pesan ...
  match = text.match(/^alarm\s+([\s\S]+?)\s+metode\s+([0-9xX]+)\s+pesan\s+([\s\S]+)$/i);
  if (match) {
    return { scheduleRaw: match[1].trim(), methodRaw: match[2].trim(), message: match[3].trim() };
  }

  // Pola 4: alarm (...) pesan (...) [default metode 3x]
  match = text.match(/^alarm\s*[\(\[]([^\)\]]+)[\)\]]\s*pesan\s*[\(\[]([\s\S]+)[\)\]]$/i);
  if (match) {
    return { scheduleRaw: match[1].trim(), methodRaw: '3x', message: match[2].trim() };
  }

  // Pola 5: alarm ... pesan ...
  match = text.match(/^alarm\s+([\s\S]+?)\s+pesan\s+([\s\S]+)$/i);
  if (match) {
    return { scheduleRaw: match[1].trim(), methodRaw: '3x', message: match[2].trim() };
  }

  return null;
}

/**
 * Normalisasi metode: '1x' | '2x' | '3x' | '4x'
 */
function normalizeMethod(raw) {
  const clean = String(raw || '').toLowerCase().replace(/[^0-9x]/g, '');
  if (clean === '1' || clean === '1x') return '1x';
  if (clean === '2' || clean === '2x') return '2x';
  if (clean === '4' || clean === '4x') return '4x';
  return '3x'; // default 3x
}

function getMethodLabel(method) {
  switch (method) {
    case '1x': return '1x (Tepat Waktu)';
    case '2x': return '2x (H-15m & Tepat Waktu)';
    case '3x': return '3x (H-30m, H-15m & Tepat Waktu)';
    case '4x': return '4x (H-45m, H-30m, H-15m & Tepat Waktu)';
    default: return '3x (H-30m, H-15m & Tepat Waktu)';
  }
}

/**
 * Simpan alarm baru ke database JSON
 */
function createAlarm({ targetJid, isGroup, creatorJid, scheduleRaw, message, methodRaw }) {
  const schedule = parseSchedule(scheduleRaw);
  if (!schedule) {
    throw new Error('Format waktu jadwal tidak valid. Cantumkan jam (misal 19:30) serta hari atau tanggal.');
  }
  if (!message || !message.trim()) {
    throw new Error('Pesan pengingat tidak boleh kosong.');
  }

  const method = normalizeMethod(methodRaw);
  const data = loadAlarms();

  const newAlarm = {
    id: data.nextId++,
    targetJid,
    isGroup,
    creatorJid,
    scheduleRaw: scheduleRaw.trim(),
    scheduleType: schedule.scheduleType, // 'date' | 'weekly' | 'daily'
    targetDate: schedule.targetDate, // YYYY-MM-DD
    dayOfWeek: schedule.dayOfWeek, // 0-6
    time: schedule.time, // HH:mm
    method,
    message: message.trim(),
    active: true,
    triggeredStages: [],
    createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
  };

  data.alarms.push(newAlarm);
  saveAlarms(data);
  return newAlarm;
}

/**
 * Hapus / Batalkan alarm berdasarkan ID dan targetJid
 */
function deleteAlarm(id, targetJid) {
  const data = loadAlarms();
  const numId = parseInt(id, 10);
  const index = data.alarms.findIndex(a => a.id === numId && a.targetJid === targetJid);
  if (index === -1) {
    return { success: false, message: `Alarm dengan ID #${id} tidak ditemukan.` };
  }

  const deleted = data.alarms.splice(index, 1)[0];
  saveAlarms(data);
  return { success: true, alarm: deleted };
}

/**
 * Ambil daftar alarm aktif untuk grup / chat tertentu
 */
function getAlarmsByJid(targetJid) {
  const data = loadAlarms();
  return data.alarms.filter(a => a.targetJid === targetJid && a.active);
}

/**
 * Format string display jadwal
 */
function formatScheduleDisplay(alarm) {
  if (alarm.scheduleType === 'date') {
    const [y, m, d] = (alarm.targetDate || '').split('-');
    return `📅 ${d}/${m}/${y} Pukul ${alarm.time} WIB`;
  } else if (alarm.scheduleType === 'weekly') {
    const dayName = DAYS_NAME[alarm.dayOfWeek] || 'Hari';
    return `🔄 Setiap Hari ${dayName} Pukul ${alarm.time} WIB`;
  } else {
    return `☀️ Setiap Hari Pukul ${alarm.time} WIB`;
  }
}

/**
 * Menghitung timestamp milidetik (Epoch UTC) target berikutnya berdasarkan WIB (+07:00)
 */
function getNextOccurrenceEpochMs(alarm) {
  const wib = getWibNow();
  if (alarm.scheduleType === 'date') {
    if (!alarm.targetDate || !alarm.time) return null;
    return new Date(`${alarm.targetDate}T${alarm.time}:00+07:00`).getTime();
  } else if (alarm.scheduleType === 'daily') {
    let candidate = new Date(`${wib.dateStr}T${alarm.time}:00+07:00`).getTime();
    if (Date.now() - candidate > 15 * 60 * 1000) {
      const tomorrow = new Date(Date.UTC(wib.year, wib.month - 1, wib.day + 1));
      const y = tomorrow.getUTCFullYear();
      const m = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
      const d = String(tomorrow.getUTCDate()).padStart(2, '0');
      candidate = new Date(`${y}-${m}-${d}T${alarm.time}:00+07:00`).getTime();
    }
    return candidate;
  } else if (alarm.scheduleType === 'weekly') {
    const diffDays = (alarm.dayOfWeek - wib.dayOfWeek + 7) % 7;
    const targetD = new Date(Date.UTC(wib.year, wib.month - 1, wib.day + diffDays));
    const y = targetD.getUTCFullYear();
    const m = String(targetD.getUTCMonth() + 1).padStart(2, '0');
    const d = String(targetD.getUTCDate()).padStart(2, '0');
    let candidate = new Date(`${y}-${m}-${d}T${alarm.time}:00+07:00`).getTime();
    if (Date.now() - candidate > 15 * 60 * 1000) {
      const nextWeekD = new Date(Date.UTC(wib.year, wib.month - 1, wib.day + diffDays + 7));
      const ny = nextWeekD.getUTCFullYear();
      const nm = String(nextWeekD.getUTCMonth() + 1).padStart(2, '0');
      const nd = String(nextWeekD.getUTCDate()).padStart(2, '0');
      candidate = new Date(`${ny}-${nm}-${nd}T${alarm.time}:00+07:00`).getTime();
    }
    return candidate;
  }
  return null;
}

/**
 * Core Alarm Worker Checker: Dijalankan berkala untuk mengecek & membunyikan alarm
 * Berbasis waktu WIB (Asia/Jakarta)
 */
async function checkAndTriggerAlarms(sock) {
  if (!sock) return;

  const data = loadAlarms();
  if (!data.alarms || data.alarms.length === 0) return;

  let hasUpdates = false;

  for (const alarm of data.alarms) {
    if (!alarm.active) continue;

    const targetMs = getNextOccurrenceEpochMs(alarm);
    if (!targetMs) continue;

    const diffMs = targetMs - Date.now();
    const diffMinutes = Math.round(diffMs / 60000);

    // Tentukan tahapan alarm berdasarkan metode (tiap 15 menit)
    let stages = [];
    if (alarm.method === '1x') {
      stages = [
        { stage: 'h-0', diff: 0, label: 'WAKTU TIBA' }
      ];
    } else if (alarm.method === '2x') {
      stages = [
        { stage: 'h-15', diff: 15, label: 'H-15 MENIT' },
        { stage: 'h-0', diff: 0, label: 'WAKTU TIBA' }
      ];
    } else if (alarm.method === '4x') {
      stages = [
        { stage: 'h-45', diff: 45, label: 'H-45 MENIT' },
        { stage: 'h-30', diff: 30, label: 'H-30 MENIT' },
        { stage: 'h-15', diff: 15, label: 'H-15 MENIT' },
        { stage: 'h-0', diff: 0, label: 'WAKTU TIBA' }
      ];
    } else {
      // Default 3x (setiap 15 menit)
      stages = [
        { stage: 'h-30', diff: 30, label: 'H-30 MENIT' },
        { stage: 'h-15', diff: 15, label: 'H-15 MENIT' },
        { stage: 'h-0', diff: 0, label: 'WAKTU TIBA' }
      ];
    }

    if (!Array.isArray(alarm.triggeredStages)) alarm.triggeredStages = [];

    // Target date key untuk identifier stage unik (WIB)
    const targetDateKey = new Date(targetMs + (7 * 3600 * 1000)).toISOString().slice(0, 10);

    // 3. Evaluasi setiap stage
    for (const st of stages) {
      // Toleransi range selisih waktu: cocok jika diffMinutes tepat atau selisih 1-2 menit
      const isMatched = (diffMinutes <= st.diff && diffMinutes >= st.diff - 2);
      const stageKey = `${targetDateKey}_${st.stage}`;

      if (isMatched && !alarm.triggeredStages.includes(stageKey)) {
        alarm.triggeredStages.push(stageKey);
        hasUpdates = true;

        try {
          const isMainAlert = (st.stage === 'h-0');

          let mentions = [];
          if (alarm.isGroup && isMainAlert) {
            try {
              const meta = await sock.groupMetadata(alarm.targetJid);
              const botNum = (sock.user?.id || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
              mentions = (meta.participants || [])
                .map(p => p.id)
                .filter(id => !id.includes(botNum));
            } catch (_) {}
          }

          let stageNotice = '';
          if (st.stage === 'h-45') stageNotice = '⚠️ *[PENGINGAT H-45 MENIT]*';
          else if (st.stage === 'h-30') stageNotice = '⚠️ *[PENGINGAT H-30 MENIT]*';
          else if (st.stage === 'h-15') stageNotice = '⏳ *[PENGINGAT H-15 MENIT]*';
          else stageNotice = '🚨 *[WAKTU BELAJAR TIBA!]*';

          let alertText =
            `⏰ *[ALARM JADWAL BELAJAR CPNS]*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${stageNotice}\n\n` +
            `📝 *Agenda / Catatan:*\n` +
            `"${alarm.message}"\n\n` +
            `⏰ Waktu Target: *${alarm.time} WIB*\n` +
            `🔔 Metode: *${getMethodLabel(alarm.method)}*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

          if (isMainAlert && mentions.length > 0) {
            alertText += `📢 _Panggilan belajar untuk seluruh anggota grup!_ ✨\n`;
          } else {
            alertText += `💡 _Bersiap dan siapkan modul materi Anda!_ 🚀\n`;
          }

          await sock.sendMessage(alarm.targetJid, {
            text: alertText,
            mentions: mentions.length > 0 ? mentions : undefined
          });

          console.log(`[Alarm Triggered] ID #${alarm.id} (${st.label}) -> ${alarm.targetJid}`);
        } catch (sendErr) {
          console.error(`[Alarm Send Error] ID #${alarm.id}:`, sendErr.message);
        }

        // Jika one-time date alarm dan stage puncak 'h-0' selesai, non-aktifkan alarm
        if (alarm.scheduleType === 'date' && st.stage === 'h-0') {
          alarm.active = false;
        }
      }
    }
  }

  if (hasUpdates) {
    saveAlarms(data);
  }
}

let workerInterval = null;
function startAlarmWorker(sock) {
  if (workerInterval) clearInterval(workerInterval);
  // Jalankan tiap 25 detik
  workerInterval = setInterval(() => {
    checkAndTriggerAlarms(sock).catch(err => {
      console.error('[AlarmWorker Error]:', err.message);
    });
  }, 25000);
  console.log('[AlarmService] ⏰ Background Alarm Worker aktif (Cek per 25 detik WIB).');
}

module.exports = {
  createAlarm,
  deleteAlarm,
  getAlarmsByJid,
  parseSchedule,
  parseAlarmCommand,
  getMethodLabel,
  formatScheduleDisplay,
  checkAndTriggerAlarms,
  startAlarmWorker,
  loadAlarms,
  getWibNow,
  DAYS_NAME
};

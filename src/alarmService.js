const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
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

function getWibDate() {
  const now = new Date();
  const wibStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  return new Date(wibStr);
}

function getTodayWibString() {
  const w = getWibDate();
  const y = w.getFullYear();
  const m = String(w.getMonth() + 1).padStart(2, '0');
  const d = String(w.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
    const tomorrow = getWibDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    targetDate = `${y}-${m}-${d}`;
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
    case '3x': return '3x (H-30m, H-10m, & Tepat Waktu)';
    case '4x': return '4x (H-1 Jam, H-30m, H-10m, & Tepat Waktu)';
    default: return '3x (H-30m, H-10m, & Tepat Waktu)';
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
 * Hapus alarm berdasarkan ID
 */
function deleteAlarm(alarmId, targetJid) {
  const data = loadAlarms();
  const idx = data.alarms.findIndex(a => a.id === parseInt(alarmId, 10) && (a.targetJid === targetJid || !targetJid));
  if (idx === -1) return { success: false, reason: 'not_found' };

  const removed = data.alarms.splice(idx, 1)[0];
  saveAlarms(data);
  return { success: true, alarm: removed };
}

/**
 * Ambil daftar alarm aktif untuk grup / chat tertentu
 */
function getAlarmsByJid(targetJid) {
  const data = loadAlarms();
  return data.alarms.filter(a => a.active && (!targetJid || a.targetJid === targetJid));
}

/**
 * Format teks jadwal untuk tampilan pengguna
 */
function formatScheduleDisplay(alarm) {
  if (alarm.scheduleType === 'date') {
    return `📅 Tanggal: ${alarm.targetDate} Pukul ${alarm.time} WIB`;
  } else if (alarm.scheduleType === 'weekly') {
    const dayName = DAYS_NAME[alarm.dayOfWeek] || 'Hari';
    return `🔄 Setiap Hari ${dayName} Pukul ${alarm.time} WIB`;
  } else {
    return `☀️ Setiap Hari Pukul ${alarm.time} WIB`;
  }
}

/**
 * Core Alarm Worker Checker: Dijalankan berkala untuk mengecek & membunyikan alarm
 */
async function checkAndTriggerAlarms(sock) {
  if (!sock) return;

  const data = loadAlarms();
  if (!data.alarms || data.alarms.length === 0) return;

  const nowWib = getWibDate();
  const todayStr = getTodayWibString();
  const currentDayOfWeek = nowWib.getDay();
  const currentHour = nowWib.getHours();
  const currentMinute = nowWib.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  let hasUpdates = false;

  for (const alarm of data.alarms) {
    if (!alarm.active) continue;

    // 1. Cek apakah hari ini jadwalnya cocok
    let isTodayScheduled = false;
    if (alarm.scheduleType === 'date') {
      isTodayScheduled = (alarm.targetDate === todayStr);
    } else if (alarm.scheduleType === 'weekly') {
      isTodayScheduled = (alarm.dayOfWeek === currentDayOfWeek);
    } else if (alarm.scheduleType === 'daily') {
      isTodayScheduled = true;
    }

    if (!isTodayScheduled) continue;

    // 2. Hitung selisih menit dengan target waktu
    const [targetH, targetM] = alarm.time.split(':').map(n => parseInt(n, 10));
    const targetTotalMinutes = targetH * 60 + targetM;
    const diffMinutes = targetTotalMinutes - currentTotalMinutes;

    // Tentukan tahapan alarm berdasarkan metode
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
        { stage: 'h-60', diff: 60, label: 'H-1 JAM' },
        { stage: 'h-30', diff: 30, label: 'H-30 MENIT' },
        { stage: 'h-10', diff: 10, label: 'H-10 MENIT' },
        { stage: 'h-0', diff: 0, label: 'WAKTU TIBA' }
      ];
    } else {
      // Default 3x
      stages = [
        { stage: 'h-30', diff: 30, label: 'H-30 MENIT' },
        { stage: 'h-10', diff: 10, label: 'H-10 MENIT' },
        { stage: 'h-0', diff: 0, label: 'WAKTU TIBA' }
      ];
    }

    if (!Array.isArray(alarm.triggeredStages)) alarm.triggeredStages = [];

    // 3. Evaluasi setiap stage
    for (const st of stages) {
      // Toleransi range selisih waktu 0..1 menit
      const isMatched = (diffMinutes === st.diff || (diffMinutes <= st.diff && diffMinutes >= st.diff - 1));
      const stageKey = `${todayStr}_${st.stage}`;

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
              mentions = (meta.participants || []).map(p => p.id).filter(j => !j.includes(botNum));
            } catch (_) {}
          }

          let alertText = '';
          if (isMainAlert) {
            alertText =
              `⏰ *ALARM CPNS BERBUNYI! (${st.label})*\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `⏱️ *Waktu:* ${alarm.time} WIB\n` +
              `📢 *Agenda Pengingat:* \n` +
              `*${alarm.message}*\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `🔔 _Waktu kegiatan telah tiba. Harap segera bersiap dan berkumpul!_`;
          } else {
            alertText =
              `⏳ *PENGINGAT AWAL CPNS (${st.label})*\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `⏱️ *Target Waktu:* ${alarm.time} WIB (Kurang ~${st.diff} menit lagi)\n` +
              `📢 *Agenda:* \n` +
              `*${alarm.message}*\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `💡 _Pemberitahuan awal tahap ${st.label}. Siapkan materi Anda!_`;
          }

          await sock.sendMessage(alarm.targetJid, {
            text: alertText,
            mentions: mentions.length ? mentions : undefined
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
  DAYS_NAME
};

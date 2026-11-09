const assert = require('assert');
const alarmService = require('../src/alarmService');

console.log('⏰ Memulai pengujian unit logika ALARM & WIB PARSER...');

// 1. Test getWibNow
const wibNow = alarmService.getWibNow();
console.log('✅ Current WIB Time:', wibNow);
assert(typeof wibNow.hour === 'number');
assert(typeof wibNow.minute === 'number');
assert(typeof wibNow.dateStr === 'string');
assert(typeof wibNow.totalMinutes === 'number');
assert(wibNow.dayOfWeek >= 0 && wibNow.dayOfWeek <= 6);

// 2. Test Parser Pola Command
const parsedCmd1 = alarmService.parseAlarmCommand('alarm (senin, 19:30) metode (3x) pesan (Tryout Akbar TIU)');
assert(parsedCmd1 !== null);
assert.strictEqual(parsedCmd1.scheduleRaw, 'senin, 19:30');
assert.strictEqual(parsedCmd1.methodRaw, '3x');
assert.strictEqual(parsedCmd1.message, 'Tryout Akbar TIU');

const parsedCmd2 = alarmService.parseAlarmCommand('alarm 11-11-2026 01:30 metode 3x pesan BELAJAR RUTIN SKD CPNS - GABOLEH PANCEEEEEEEEEEEEEEEE');
assert(parsedCmd2 !== null);
assert.strictEqual(parsedCmd2.scheduleRaw, '11-11-2026 01:30');
assert.strictEqual(parsedCmd2.methodRaw, '3x');
assert.strictEqual(parsedCmd2.message, 'BELAJAR RUTIN SKD CPNS - GABOLEH PANCEEEEEEEEEEEEEEEE');

// 3. Test Parser Schedule Waktu
const schedWeekly = alarmService.parseSchedule('senin, 19:30');
assert.strictEqual(schedWeekly.scheduleType, 'weekly');
assert.strictEqual(schedWeekly.dayOfWeek, 1);
assert.strictEqual(schedWeekly.time, '19:30');

const schedDaily = alarmService.parseSchedule('setiap hari 20:00');
assert.strictEqual(schedDaily.scheduleType, 'daily');
assert.strictEqual(schedDaily.time, '20:00');

const schedDate = alarmService.parseSchedule('11-11-2026 01:30');
assert.strictEqual(schedDate.scheduleType, 'date');
assert.strictEqual(schedDate.targetDate, '2026-11-11');
assert.strictEqual(schedDate.time, '01:30');

// 4. Test Method Labels (Tiap 15 Menit)
assert.strictEqual(alarmService.getMethodLabel('1x'), '1x (Tepat Waktu)');
assert.strictEqual(alarmService.getMethodLabel('2x'), '2x (H-15m & Tepat Waktu)');
assert.strictEqual(alarmService.getMethodLabel('3x'), '3x (H-30m, H-15m & Tepat Waktu)');
assert.strictEqual(alarmService.getMethodLabel('4x'), '4x (H-45m, H-30m, H-15m & Tepat Waktu)');

// 5. Test Create & Delete Alarm
const newAlarm = alarmService.createAlarm({
  targetJid: 'group_test_123@g.us',
  isGroup: true,
  creatorJid: 'user_test@s.whatsapp.net',
  scheduleRaw: '11-11-2026 01:30',
  message: 'BELAJAR RUTIN SKD CPNS - GABOLEH PANCEEEEEEEEEEEEEEEE',
  methodRaw: '3x'
});
console.log('✅ Alarm Created:', newAlarm.id, newAlarm.scheduleRaw, newAlarm.method, newAlarm.targetDate);
assert(newAlarm.id > 0);
assert.strictEqual(newAlarm.method, '3x');
assert.strictEqual(newAlarm.targetDate, '2026-11-11');

// Verify retrieval
const activeAlarms = alarmService.getAlarmsByJid('group_test_123@g.us');
assert(activeAlarms.length >= 1);
assert(activeAlarms.some(a => a.id === newAlarm.id));

// Verify display
const display = alarmService.formatScheduleDisplay(newAlarm);
console.log('✅ Display formatted:', display);
assert(display.includes('11/11/2026'));
assert(display.includes('01:30 WIB'));

// Cleanup
const delRes = alarmService.deleteAlarm(newAlarm.id, 'group_test_123@g.us');
assert.strictEqual(delRes.success, true);
assert.strictEqual(alarmService.getAlarmsByJid('group_test_123@g.us').length, 0);

console.log('🎉 SEMUA TES LOGIKA ALARM (WIB & 15 MENIT) LULUS 100%!');


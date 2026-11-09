const db = require('../src/database');
const assert = require('assert');

console.log('🧪 Memulai pengujian unit logika CRUD CPNS...');

// 1. Test Save Baru
const item1 = db.saveItem('twk pancasila', 'Pancasila adalah dasar negara dengan 5 sila.');
console.log('✅ Save item 1:', item1);
assert.strictEqual(item1.item.id, 1);
assert.strictEqual(item1.item.callName, 'twk pancasila');

// 2. Test Save Baru Item 2
const item2 = db.saveItem('tiu silogisme', 'Semua manusia fana. Socrates manusia -> Socrates fana.');
console.log('✅ Save item 2:', item2);
assert.strictEqual(item2.item.id, 2);

// 3. Test Panggil Daftar
const all = db.getAllItems();
console.log('✅ Ambil semua daftar:', all.length, 'items');
assert.strictEqual(all.length, 2);

// 4. Test Ambil per nama panggilan & nomor
const getByCall = db.getItem('twk pancasila');
assert(getByCall !== null);
assert.strictEqual(getByCall.id, 1);

const getById = db.getItem('2');
assert(getById !== null);
assert.strictEqual(getById.callName, 'tiu silogisme');

// 5. Test Edit Nama Panggilan
const editNameRes = db.editCallName('twk pancasila', 'pilar kebangsaan');
console.log('✅ Edit nama:', editNameRes);
assert.strictEqual(editNameRes.success, true);
assert.strictEqual(db.getItem('pilar kebangsaan').id, 1);
assert.strictEqual(db.getItem('twk pancasila'), null);

// 6. Test Edit Isi Konten
const editContentRes = db.editContent('pilar kebangsaan', 'Isi baru: 4 Pilar Kebangsaan RI.');
console.log('✅ Edit isi:', editContentRes);
assert.strictEqual(editContentRes.success, true);
assert.strictEqual(db.getItem('pilar kebangsaan').content, 'Isi baru: 4 Pilar Kebangsaan RI.');

// 7. Test Save File / Berkas
const sampleBuffer = Buffer.from('PDF_SAMPLE_DATA_TWK_2026');
const savedFile = db.saveMediaFile(sampleBuffer, 'modul_twk.pdf', 'application/pdf', 'document');
const fileItem = db.saveItem('modul twk', 'Lampiran modul TWK PDF resmi.', savedFile);
console.log('✅ Save file item:', fileItem);
assert.strictEqual(fileItem.item.type, 'file');
assert.strictEqual(fileItem.item.file.fileName, 'modul_twk.pdf');
assert.strictEqual(db.getItem('modul twk').file.fileName, 'modul_twk.pdf');

// 8. Test Hapus Berkas
const delFileRes = db.deleteItem('modul twk');
console.log('✅ Hapus file:', delFileRes);
assert.strictEqual(delFileRes.success, true);
assert.strictEqual(db.getItem('modul twk'), null);

// 9. Test Hapus Item 1 & Item 2
const delRes = db.deleteItem('pilar kebangsaan');
console.log('✅ Hapus:', delRes);
assert.strictEqual(delRes.success, true);
assert.strictEqual(db.getItem('pilar kebangsaan'), null);

// Clean up item 2
db.deleteItem('tiu silogisme');
assert.strictEqual(db.getAllItems().length, 0);

console.log('🎉 SEMUA TES LOGIKA CRUD CPNS (TEKS & FILE) BERHASIL 100%!');

// ==========================================
// PENGUJIAN ALARM SERVICE
// ==========================================
console.log('\n⏰ Memulai pengujian unit logika ALARM & PARSER...');
const alarmService = require('../src/alarmService');

// 1. Test Parser Pola Command
const parsedCmd1 = alarmService.parseAlarmCommand('alarm (senin, 19:30) metode (3x) pesan (Tryout Akbar TIU)');
assert(parsedCmd1 !== null);
assert.strictEqual(parsedCmd1.scheduleRaw, 'senin, 19:30');
assert.strictEqual(parsedCmd1.methodRaw, '3x');
assert.strictEqual(parsedCmd1.message, 'Tryout Akbar TIU');

const parsedCmd2 = alarmService.parseAlarmCommand('alarm 15-12-2026 08.00 metode 2x pesan Belajar TWK Bela Negara');
assert(parsedCmd2 !== null);
assert.strictEqual(parsedCmd2.methodRaw, '2x');

// 2. Test Parser Schedule Waktu
const schedWeekly = alarmService.parseSchedule('senin, 19:30');
assert.strictEqual(schedWeekly.scheduleType, 'weekly');
assert.strictEqual(schedWeekly.dayOfWeek, 1);
assert.strictEqual(schedWeekly.time, '19:30');

const schedDaily = alarmService.parseSchedule('setiap hari 20:00');
assert.strictEqual(schedDaily.scheduleType, 'daily');
assert.strictEqual(schedDaily.time, '20:00');

const schedDate = alarmService.parseSchedule('25-12-2026 09:15');
assert.strictEqual(schedDate.scheduleType, 'date');
assert.strictEqual(schedDate.targetDate, '2026-12-25');
assert.strictEqual(schedDate.time, '09:15');

// 3. Test Create Alarm
const newAlarm = alarmService.createAlarm({
  targetJid: 'group123@g.us',
  isGroup: true,
  creatorJid: 'user123@s.whatsapp.net',
  scheduleRaw: 'senin, 19:30',
  message: 'Waktunya Belajar TIU Silogisme & Berhitung Cepat!',
  methodRaw: '3x'
});
console.log('✅ Alarm Created:', newAlarm.id, newAlarm.scheduleRaw, newAlarm.method);
assert(newAlarm.id > 0);
assert.strictEqual(newAlarm.method, '3x');

// 4. Test Get Alarm By JID
const alarms = alarmService.getAlarmsByJid('group123@g.us');
assert(alarms.length >= 1);
assert(alarms.some(a => a.id === newAlarm.id));

// 5. Test Delete Alarm
const delAlarmRes = alarmService.deleteAlarm(newAlarm.id, 'group123@g.us');
assert.strictEqual(delAlarmRes.success, true);
const remaining = alarmService.getAlarmsByJid('group123@g.us');
assert(!remaining.some(a => a.id === newAlarm.id));

console.log('🎉 SEMUA TES LOGIKA ALARM SERVICE BERHASIL 100%!');


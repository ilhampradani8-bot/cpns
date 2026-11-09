const db = require('../src/database');
const assert = require('assert');

console.log('🧪 Memulai pengujian unit logika CRUD CPNS (Non-Destructive)...');

const initialCount = db.getAllItems().length;

// 1. Test Save Baru
const item1 = db.saveItem('test twk unit', 'Pancasila adalah dasar negara dengan 5 sila.');
console.log('✅ Save item 1:', item1.item.id, item1.item.callName);
assert(item1.item.id > 0);
assert.strictEqual(item1.item.callName, 'test twk unit');

// 2. Test Panggil
const getByCall = db.getItem('test twk unit');
assert(getByCall !== null);
assert.strictEqual(getByCall.id, item1.item.id);

// 3. Test Edit Nama Panggilan
const editNameRes = db.editCallName('test twk unit', 'test pilar unit');
assert.strictEqual(editNameRes.success, true);
assert.strictEqual(db.getItem('test pilar unit').id, item1.item.id);
assert.strictEqual(db.getItem('test twk unit'), null);

// 4. Test Edit Isi Konten
const editContentRes = db.editContent('test pilar unit', 'Isi baru: 4 Pilar Kebangsaan RI.');
assert.strictEqual(editContentRes.success, true);
assert.strictEqual(db.getItem('test pilar unit').content, 'Isi baru: 4 Pilar Kebangsaan RI.');

// 5. Test Save File / Berkas
const sampleBuffer = Buffer.from('PDF_SAMPLE_DATA_TWK_2026');
const savedFile = db.saveMediaFile(sampleBuffer, 'modul_twk.pdf', 'application/pdf', 'document');
const fileItem = db.saveItem('test modul file', 'Lampiran modul TWK PDF resmi.', savedFile);
assert.strictEqual(fileItem.item.type, 'file');
assert.strictEqual(fileItem.item.file.fileName, 'modul_twk.pdf');
assert.strictEqual(db.getItem('test modul file').file.fileName, 'modul_twk.pdf');

// 6. Test Hapus Berkas & Item
assert.strictEqual(db.deleteItem('test modul file').success, true);
assert.strictEqual(db.deleteItem('test pilar unit').success, true);
assert.strictEqual(db.getAllItems().length, initialCount);

console.log('🎉 SEMUA TES LOGIKA CRUD CPNS (TEKS & FILE) BERHASIL 100% TANPA MERUSAK DATA REAL!');

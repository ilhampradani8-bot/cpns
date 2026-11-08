const db = require('./src/database');
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

// 7. Test Hapus
const delRes = db.deleteItem('pilar kebangsaan');
console.log('✅ Hapus:', delRes);
assert.strictEqual(delRes.success, true);
assert.strictEqual(db.getItem('pilar kebangsaan'), null);
assert.strictEqual(db.getAllItems().length, 1);

console.log('🎉 SEMUA TES LOGIKA CRUD CPNS BERHASIL 100%!');

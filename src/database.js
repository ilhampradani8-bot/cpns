const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'cpns_data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function loadData() {
  ensureDirectories();
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('[DB] Gagal membaca data JSON, mencoba memulihkan dari backup...', err.message);
    const recovered = recoverFromLatestBackup();
    if (recovered) return recovered;
  }
  return { nextId: 1, items: [] };
}

function saveData(data) {
  ensureDirectories();
  const tmpPath = `${DB_PATH}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, DB_PATH);

    // Auto backup rotation (simpan max 20 backup)
    createBackup(data);
    return true;
  } catch (err) {
    console.error('[DB] Gagal menyimpan data:', err.message);
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    return false;
  }
}

function createBackup(data) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `cpns_backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf-8');

    // Bersihkan backup lama jika lebih dari 20
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('cpns_backup_'))
      .sort();
    if (files.length > 20) {
      const toDelete = files.slice(0, files.length - 20);
      toDelete.forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {}
      });
    }
  } catch (_) {}
}

function recoverFromLatestBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return null;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('cpns_backup_'))
      .sort()
      .reverse();
    if (files.length > 0) {
      const latestFile = path.join(BACKUP_DIR, files[0]);
      const raw = fs.readFileSync(latestFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) {
        console.log(`[DB] Berhasil pulihkan data dari ${files[0]}`);
        return parsed;
      }
    }
  } catch (_) {}
  return null;
}

function normalizeKey(str) {
  return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// 1. Simpan (Create atau Update jika sudah ada)
function saveItem(callName, content) {
  const norm = normalizeKey(callName);
  if (!norm) throw new Error('Nama panggilan tidak boleh kosong.');
  if (!content || !content.trim()) throw new Error('Isi materi tidak boleh kosong.');

  const data = loadData();
  const existingIdx = data.items.findIndex(i => normalizeKey(i.callName) === norm);
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  if (existingIdx !== -1) {
    // Timpa jika sudah ada dengan nama panggilan yang sama
    data.items[existingIdx].content = content.trim();
    data.items[existingIdx].updatedAt = now;
    saveData(data);
    return { isNew: false, item: data.items[existingIdx] };
  } else {
    // Buat item baru dengan nomor urut
    const newItem = {
      id: data.nextId || (data.items.length + 1),
      callName: callName.trim(),
      content: content.trim(),
      createdAt: now,
      updatedAt: now
    };
    data.nextId = (data.nextId || data.items.length + 1) + 1;
    data.items.push(newItem);
    saveData(data);
    return { isNew: true, item: newItem };
  }
}

// 2. Edit nama panggilan: edit (nama panggilan lama) to (nama panggilan baru)
function editCallName(oldName, newName) {
  const normOld = normalizeKey(oldName);
  const normNew = normalizeKey(newName);

  if (!normOld || !normNew) throw new Error('Nama panggilan lama dan baru harus diisi.');

  const data = loadData();
  const item = data.items.find(i => normalizeKey(i.callName) === normOld);
  if (!item) {
    return { success: false, reason: 'not_found' };
  }

  // Cek apakah newName sudah dipakai item lain
  const conflict = data.items.find(i => i.id !== item.id && normalizeKey(i.callName) === normNew);
  if (conflict) {
    return { success: false, reason: 'conflict', conflictItem: conflict };
  }

  const prevName = item.callName;
  item.callName = newName.trim();
  item.updatedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  saveData(data);

  return { success: true, prevName, item };
}

// 3. Edit isi: edit isi (nama panggilan) isi (isi baru)
function editContent(callName, newContent) {
  const norm = normalizeKey(callName);
  if (!norm) throw new Error('Nama panggilan tidak boleh kosong.');
  if (!newContent || !newContent.trim()) throw new Error('Isi materi baru tidak boleh kosong.');

  const data = loadData();
  const item = data.items.find(i => normalizeKey(i.callName) === norm);
  if (!item) {
    return { success: false, reason: 'not_found' };
  }

  item.content = newContent.trim();
  item.updatedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  saveData(data);

  return { success: true, item };
}

// 4. Hapus item: hapus (nama panggilan)
function deleteItem(callNameOrId) {
  const norm = normalizeKey(callNameOrId);
  const data = loadData();

  const idx = data.items.findIndex(i => {
    return normalizeKey(i.callName) === norm || String(i.id) === norm;
  });

  if (idx === -1) {
    return { success: false, reason: 'not_found' };
  }

  const removed = data.items.splice(idx, 1)[0];
  saveData(data);
  return { success: true, item: removed };
}

// 5. Ambil 1 item berdasarkan nama panggilan atau nomor ID
function getItem(callNameOrId) {
  const norm = normalizeKey(callNameOrId);
  const data = loadData();

  // Cocokkan persis nama panggilan
  let item = data.items.find(i => normalizeKey(i.callName) === norm);
  if (item) return item;

  // Cocokkan nomor urut
  if (/^\d+$/.test(norm)) {
    const targetId = parseInt(norm, 10);
    item = data.items.find(i => i.id === targetId);
    if (item) return item;
  }

  return null;
}

// 6. Ambil semua list item (terurut berdasarkan nomor ID)
function getAllItems() {
  const data = loadData();
  return (data.items || []).slice().sort((a, b) => a.id - b.id);
}

module.exports = {
  saveItem,
  editCallName,
  editContent,
  deleteItem,
  getItem,
  getAllItems,
  normalizeKey
};

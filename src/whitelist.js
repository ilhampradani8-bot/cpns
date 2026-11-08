const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const WHITELIST_PATH = path.join(DATA_DIR, 'whitelist.json');
const CONFIG_PATH = path.join(__dirname, '../config.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (_) {}
  return { ownerNumbers: [] };
}

function loadWhitelist() {
  ensureDataDir();
  try {
    if (fs.existsSync(WHITELIST_PATH)) {
      return JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf-8'));
    }
  } catch (_) {}
  return {
    groups: {}, // { [jid]: { name: string, registeredAt: string, registeredBy: string } }
    privateUsers: {} // { [jid]: { name: string, registeredAt: string } }
  };
}

function saveWhitelist(data) {
  ensureDataDir();
  const tmp = `${WHITELIST_PATH}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, WHITELIST_PATH);
    return true;
  } catch (err) {
    console.error('[Whitelist] Gagal menyimpan:', err.message);
    if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

function isOwner(senderJid) {
  const cleanSender = String(senderJid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const cfg = loadConfig();
  const owners = (cfg.ownerNumbers || []).map(n => String(n).replace(/[^0-9]/g, ''));
  return owners.includes(cleanSender);
}

function registerGroup(jid, groupName, registeredBy) {
  const wl = loadWhitelist();
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  wl.groups[jid] = {
    name: groupName || 'Grup CPNS',
    registeredAt: now,
    registeredBy: registeredBy || 'admin'
  };
  saveWhitelist(wl);
  return wl.groups[jid];
}

function unregisterGroup(jid) {
  const wl = loadWhitelist();
  if (wl.groups[jid]) {
    delete wl.groups[jid];
    saveWhitelist(wl);
    return true;
  }
  return false;
}

function registerPrivate(jid, userName) {
  const wl = loadWhitelist();
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const cleanNum = String(jid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  wl.privateUsers[cleanNum] = {
    jid,
    name: userName || 'Tester CPNS',
    registeredAt: now
  };
  saveWhitelist(wl);
  return wl.privateUsers[cleanNum];
}

function isGroupRegistered(groupJid) {
  const wl = loadWhitelist();
  return !!wl.groups[groupJid];
}

function isPrivateRegistered(userJid) {
  const cleanNum = String(userJid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  // Owner otomatis diizinkan di private chat
  if (isOwner(userJid)) return true;
  const wl = loadWhitelist();
  return !!wl.privateUsers[cleanNum];
}

function isAllowed(jid, isGroup) {
  if (isGroup) {
    return isGroupRegistered(jid);
  } else {
    return isPrivateRegistered(jid);
  }
}

module.exports = {
  isOwner,
  registerGroup,
  unregisterGroup,
  registerPrivate,
  isGroupRegistered,
  isPrivateRegistered,
  isAllowed,
  loadWhitelist
};

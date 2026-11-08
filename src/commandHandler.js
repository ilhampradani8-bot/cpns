const db = require('./database');
const whitelist = require('./whitelist');

/**
 * Normalisasi teks input
 */
function cleanText(text) {
  return String(text || '').trim();
}

/**
 * Ekstraksi pola kurung atau pemisah "isi"
 * Contoh:
 * save (twk pancasila) isi (teks...)
 * save twk pancasila isi teks...
 */
function parseSaveCommand(text) {
  // Pola 1: save (judul) isi (isi) atau save [judul] isi [isi]
  let match = text.match(/^(?:save|simpan)\s*[\(\[]([^\)\]]+)[\)\]]\s*isi\s*[\(\[]([\s\S]+)[\)\]]$/i);
  if (match) {
    return { callName: match[1].trim(), content: match[2].trim() };
  }

  // Pola 2: save (judul) isi isi...
  match = text.match(/^(?:save|simpan)\s*[\(\[]([^\)\]]+)[\)\]]\s*isi\s+([\s\S]+)$/i);
  if (match) {
    return { callName: match[1].trim(), content: match[2].trim() };
  }

  // Pola 3: save judul isi isi...
  match = text.match(/^(?:save|simpan)\s+([\s\S]+?)\s+isi\s+([\s\S]+)$/i);
  if (match) {
    return { callName: match[1].trim(), content: match[2].trim() };
  }

  return null;
}

/**
 * Ekstraksi edit nama panggilan:
 * edit (nama lama) to (nama baru)
 * edit nama lama to nama baru
 */
function parseEditNameCommand(text) {
  // Pola 1: edit (nama lama) to (nama baru)
  let match = text.match(/^edit\s*[\(\[]([^\)\]]+)[\)\]]\s*to\s*[\(\[]([^\)\]]+)[\)\]]$/i);
  if (match) {
    return { oldName: match[1].trim(), newName: match[2].trim() };
  }

  // Pola 2: edit nama lama to nama baru (asalkan bukan "edit isi")
  if (!text.toLowerCase().startsWith('edit isi')) {
    match = text.match(/^edit\s+([\s\S]+?)\s+to\s+([\s\S]+)$/i);
    if (match) {
      return { oldName: match[1].trim(), newName: match[2].trim() };
    }
  }

  return null;
}

/**
 * Ekstraksi edit isi konten:
 * edit isi (nama panggilan) isi (isinya buat timpa)
 * edit isi nama panggilan isi isinya buat timpa
 */
function parseEditContentCommand(text) {
  // Pola 1: edit isi (nama) isi (konten)
  let match = text.match(/^edit\s+isi\s*[\(\[]([^\)\]]+)[\)\]]\s*isi\s*[\(\[]([\s\S]+)[\)\]]$/i);
  if (match) {
    return { callName: match[1].trim(), newContent: match[2].trim() };
  }

  // Pola 2: edit isi (nama) isi konten...
  match = text.match(/^edit\s+isi\s*[\(\[]([^\)\]]+)[\)\]]\s*isi\s+([\s\S]+)$/i);
  if (match) {
    return { callName: match[1].trim(), newContent: match[2].trim() };
  }

  // Pola 3: edit isi nama panggilan isi konten...
  match = text.match(/^edit\s+isi\s+([\s\S]+?)\s+isi\s+([\s\S]+)$/i);
  if (match) {
    return { callName: match[1].trim(), newContent: match[2].trim() };
  }

  return null;
}

/**
 * Ekstraksi hapus:
 * hapus (nama panggilan) atau hapus nama panggilan
 */
function parseDeleteCommand(text) {
  const match = text.match(/^(?:hapus|delete|del)\s+(?:[\(\[]([^\)\]]+)[\)\]]|(.+))$/i);
  if (match) {
    return (match[1] || match[2]).trim();
  }
  return null;
}

/**
 * Ekstraksi panggil:
 * panggil (nama panggilan) atau panggil nama panggilan
 */
function parsePanggilCommand(text) {
  const match = text.match(/^panggil\s+(?:[\(\[]([^\)\]]+)[\)\]]|(.+))$/i);
  if (match) {
    return (match[1] || match[2]).trim();
  }
  return null;
}

/**
 * Main Command Handler
 */
async function handleMessage(sock, msg) {
  if (!msg.message) return;

  const key = msg.key;
  const fromJid = key.remoteJid;
  const isGroup = fromJid.endsWith('@g.us');
  const senderJid = isGroup ? key.participant : fromJid;

  // Dapatkan isi teks pesan
  const messageContent = msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    '';

  const rawText = cleanText(messageContent);
  if (!rawText) return;

  const lowerText = rawText.toLowerCase();

  // 1. FITUR REGISTRASI (daftar cpns)
  if (lowerText === 'daftar cpns' || lowerText === 'daftar test') {
    if (isGroup) {
      // Daftarkan grup ke whitelist
      let groupName = 'Grup CPNS';
      try {
        const meta = await sock.groupMetadata(fromJid);
        groupName = meta.subject || groupName;
      } catch (_) {}

      whitelist.registerGroup(fromJid, groupName, senderJid);
      await sock.sendMessage(fromJid, {
        text: `✅ *GRUP CPNS BERHASIL DIDAFTARKAN!*\n\n` +
          `📌 Nama Grup: *${groupName}*\n` +
          `🆔 JID: \`${fromJid}\`\n\n` +
          `Bot sekarang resmi aktif di grup ini untuk kebutuhan materi CPNS.\n` +
          `Ketik *menu* atau *help* untuk melihat daftar perintah.`
      }, { quoted: msg });
      return;
    } else {
      // Daftarkan nomor pribadi untuk testing
      const pushName = msg.pushName || 'Tester';
      whitelist.registerPrivate(senderJid, pushName);
      await sock.sendMessage(fromJid, {
        text: `✅ *NOMOR PRIBADI BERHASIL DIDAFTARKAN (TEST MODE)!*\n\n` +
          `👤 Nama: *${pushName}*\n` +
          `📱 Nomor: *${senderJid.split('@')[0]}*\n\n` +
          `Sekarang Anda dapat mengetes seluruh fungsi bot CPNS di chat pribadi ini.\n` +
          `Ketik *menu* untuk melihat panduan penggunaan.`
      }, { quoted: msg });
      return;
    }
  }

  // 2. CEK WHITELIST (Hanya grup CPNS terdaftar atau nomor pribadi terdaftar yang direspon)
  if (!whitelist.isAllowed(fromJid, isGroup)) {
    // Jika belum terdaftar, diamkan (silent) agar tidak spam / mengganggu grup lain
    return;
  }

  // 3. MENU / HELP / BANTUAN
  if (lowerText === 'menu' || lowerText === 'help' || lowerText === 'bantuan') {
    const helpMsg =
      `📖 *PANDUAN PERINTAH BOT CPNS*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*1. Simpan Materi (CRUD - Create)*\n` +
      `• *save [judul] isi [konten]*\n` +
      `_Contoh:_ \`save (twk pancasila) isi (Pancasila adalah dasar negara Indonesia.)\`\n\n` +
      `*2. Panggil Materi (CRUD - Read)*\n` +
      `• *panggil [nama]* atau langsung ketik *[nama]*\n` +
      `• Bisa panggil pakai nomor urut: *panggil 1*\n` +
      `_Contoh:_ \`twk pancasila\` atau \`panggil 1\`\n\n` +
      `*3. Lihat Semua Materi (CRUD - Read List)*\n` +
      `• *panggil daftar* / *daftar* / *list*\n\n` +
      `*4. Edit Nama Panggilan (CRUD - Update)*\n` +
      `• *edit [nama lama] to [nama baru]*\n` +
      `_Contoh:_ \`edit (twk pancasila) to (pilar kebangsaan)\`\n\n` +
      `*5. Edit Isi Materi (CRUD - Update Content)*\n` +
      `• *edit isi [nama] isi [isi baru]*\n` +
      `_Contoh:_ \`edit isi (pilar kebangsaan) isi (Isi terbaru pilar kebangsaan...)\`\n\n` +
      `*6. Hapus Materi (CRUD - Delete)*\n` +
      `• *hapus [nama]* atau *hapus [nomor]*\n` +
      `_Contoh:_ \`hapus pilar kebangsaan\`\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💾 _Data tersimpan aman di database permanen._`;

    await sock.sendMessage(fromJid, { text: helpMsg }, { quoted: msg });
    return;
  }

  // 4. PANGGIL DAFTAR (LIST)
  if (lowerText === 'panggil daftar' || lowerText === 'daftar' || lowerText === 'list') {
    const items = db.getAllItems();
    if (items.length === 0) {
      await sock.sendMessage(fromJid, {
        text: `📭 *Belum ada materi CPNS yang tersimpan.*\n\n` +
          `Gunakan format berikut untuk menyimpan materi pertama Anda:\n` +
          `*save (judul panggilan) isi (penjelasan materinya)*`
      }, { quoted: msg });
      return;
    }

    let listText = `📚 *DAFTAR MATERI CPNS TERDATA (${items.length} Data)*\n`;
    listText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    items.forEach((item, index) => {
      listText += `*${item.id}.* ${item.callName}\n`;
    });
    listText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    listText += `💡 _Ketik langsung nama materi di atas (1-2 kata) atau ketik \`panggil <nomor>\` untuk membaca isinya._`;

    await sock.sendMessage(fromJid, { text: listText }, { quoted: msg });
    return;
  }

  // 5. SAVE / SIMPAN (CREATE / OVERWRITE)
  const saveMatch = parseSaveCommand(rawText);
  if (saveMatch) {
    try {
      const result = db.saveItem(saveMatch.callName, saveMatch.content);
      const actionText = result.isNew ? 'Disimpan Baru' : 'Diperbarui (Timpa)';
      const resp =
        `✅ *Materi CPNS Berhasil ${actionText}!*\n\n` +
        `🔢 *Nomor:* #${result.item.id}\n` +
        `🏷️ *Nama Panggilan:* *${result.item.callName}*\n` +
        `📝 *Isi:* \n${result.item.content}\n\n` +
        `💡 _Panggil materi ini kapan saja dengan mengetik: *${result.item.callName}* atau *panggil ${result.item.id}*._`;

      await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(fromJid, { text: `❌ Gagal menyimpan: ${err.message}` }, { quoted: msg });
    }
    return;
  }

  // 6. EDIT ISI KONTEN (UPDATE CONTENT)
  const editContentMatch = parseEditContentCommand(rawText);
  if (editContentMatch) {
    try {
      const result = db.editContent(editContentMatch.callName, editContentMatch.newContent);
      if (!result.success) {
        await sock.sendMessage(fromJid, {
          text: `⚠️ Materi dengan nama panggilan *"${editContentMatch.callName}"* tidak ditemukan di daftar.\nKetik *daftar* untuk melihat list.`
        }, { quoted: msg });
        return;
      }

      const resp =
        `✅ *Isi Materi CPNS Berhasil Diperbarui!*\n\n` +
        `🔢 *Nomor:* #${result.item.id}\n` +
        `🏷️ *Nama Panggilan:* *${result.item.callName}*\n` +
        `📝 *Isi Baru:* \n${result.item.content}`;

      await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(fromJid, { text: `❌ Gagal memperbarui isi: ${err.message}` }, { quoted: msg });
    }
    return;
  }

  // 7. EDIT NAMA PANGGILAN (UPDATE CALLNAME)
  const editNameMatch = parseEditNameCommand(rawText);
  if (editNameMatch) {
    try {
      const result = db.editCallName(editNameMatch.oldName, editNameMatch.newName);
      if (!result.success) {
        if (result.reason === 'conflict') {
          await sock.sendMessage(fromJid, {
            text: `⚠️ Nama panggilan baru *"${editNameMatch.newName}"* sudah digunakan oleh data #${result.conflictItem.id}. Harap gunakan nama lain.`
          }, { quoted: msg });
        } else {
          await sock.sendMessage(fromJid, {
            text: `⚠️ Materi lama dengan nama *"${editNameMatch.oldName}"* tidak ditemukan.\nKetik *daftar* untuk cek data.`
          }, { quoted: msg });
        }
        return;
      }

      const resp =
        `✅ *Nama Panggilan Berhasil Diubah!*\n\n` +
        `🔢 *Nomor:* #${result.item.id}\n` +
        `🔄 *Dari:* ~${result.prevName}~\n` +
        `➡️ *Menjadi:* *${result.item.callName}*\n\n` +
        `💡 _Gunakan panggilan baru *${result.item.callName}* untuk memanggil materi ini._`;

      await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(fromJid, { text: `❌ Gagal mengubah nama: ${err.message}` }, { quoted: msg });
    }
    return;
  }

  // 8. HAPUS MATERI (DELETE)
  const deleteTarget = parseDeleteCommand(rawText);
  if (deleteTarget) {
    try {
      const result = db.deleteItem(deleteTarget);
      if (!result.success) {
        await sock.sendMessage(fromJid, {
          text: `⚠️ Materi *"${deleteTarget}"* tidak ditemukan di daftar.\nKetik *daftar* untuk mengecek nomor/judul.`
        }, { quoted: msg });
        return;
      }

      await sock.sendMessage(fromJid, {
        text: `🗑️ *Materi Berhasil Dihapus!*\n\n` +
          `Nomor: #${result.item.id}\n` +
          `Judul: *${result.item.callName}*`
      }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(fromJid, { text: `❌ Gagal menghapus: ${err.message}` }, { quoted: msg });
    }
    return;
  }

  // 9. PANGGIL EKSLISIT: panggil [nama/nomor]
  const panggilTarget = parsePanggilCommand(rawText);
  if (panggilTarget && panggilTarget.toLowerCase() !== 'daftar') {
    const item = db.getItem(panggilTarget);
    if (item) {
      const resp =
        `📌 *[ #${item.id} - ${item.callName.toUpperCase()} ]*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${item.content}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕒 _Update: ${item.updatedAt}_`;
      await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
      return;
    } else {
      await sock.sendMessage(fromJid, {
        text: `⚠️ Materi *"${panggilTarget}"* tidak ditemukan.\nKetik *daftar* untuk melihat list materi yang ada.`
      }, { quoted: msg });
      return;
    }
  }

  // 10. PANGGIL CEPAT (IMPLISIT): Ketik nama panggilan langsung (1 kata atau 2 kata)
  // Syarat: jumlah kata <= 4 kata dan cocok dengan item di database
  const words = rawText.trim().split(/\s+/);
  if (words.length <= 4) {
    const item = db.getItem(rawText);
    if (item) {
      const resp =
        `📌 *[ #${item.id} - ${item.callName.toUpperCase()} ]*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${item.content}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕒 _Update: ${item.updatedAt}_`;
      await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
      return;
    }
  }
}

module.exports = {
  handleMessage
};

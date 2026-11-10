const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const db = require('./database');
const whitelist = require('./whitelist');
const alarmService = require('./alarmService');
const quizService = require('./quizService');

/**
 * Normalisasi teks input
 */
function cleanText(text) {
  return String(text || '').trim();
}

/**
 * Deteksi dan ekstraksi media pesan (baik lampiran langsung maupun pesan yang di-reply / quoted)
 */
function extractMedia(msg) {
  if (!msg || !msg.message) return null;

  function unwrap(m) {
    if (!m) return null;
    if (m.ephemeralMessage?.message) return unwrap(m.ephemeralMessage.message);
    if (m.viewOnceMessage?.message) return unwrap(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2?.message) return unwrap(m.viewOnceMessageV2.message);
    if (m.documentWithCaptionMessage?.message) return unwrap(m.documentWithCaptionMessage.message);
    return m;
  }

  const direct = unwrap(msg.message);
  let mediaType = null;
  let mediaNode = null;

  if (direct?.documentMessage) {
    mediaType = 'document';
    mediaNode = direct.documentMessage;
  } else if (direct?.imageMessage) {
    mediaType = 'image';
    mediaNode = direct.imageMessage;
  } else if (direct?.videoMessage) {
    mediaType = 'video';
    mediaNode = direct.videoMessage;
  } else if (direct?.audioMessage) {
    mediaType = 'audio';
    mediaNode = direct.audioMessage;
  }

  // Cek jika pengguna me-reply pesan file/gambar
  if (!mediaNode) {
    const contextInfo = msg.message.extendedTextMessage?.contextInfo ||
                        direct?.extendedTextMessage?.contextInfo;
    const quoted = unwrap(contextInfo?.quotedMessage);
    if (quoted?.documentMessage) {
      mediaType = 'document';
      mediaNode = quoted.documentMessage;
    } else if (quoted?.imageMessage) {
      mediaType = 'image';
      mediaNode = quoted.imageMessage;
    } else if (quoted?.videoMessage) {
      mediaType = 'video';
      mediaNode = quoted.videoMessage;
    } else if (quoted?.audioMessage) {
      mediaType = 'audio';
      mediaNode = quoted.audioMessage;
    }
  }

  if (!mediaNode) return null;

  const ext = mediaType === 'image' ? '.jpg' : mediaType === 'document' ? '.pdf' : mediaType === 'video' ? '.mp4' : '.mp3';
  const fileName = mediaNode.fileName || mediaNode.title || `${mediaType}_${Date.now()}${ext}`;
  const mimetype = mediaNode.mimetype || (mediaType === 'image' ? 'image/jpeg' : 'application/octet-stream');

  return { mediaType, mediaNode, fileName, mimetype };
}

/**
 * Unduh stream media biner ke Buffer
 */
async function downloadMedia(mediaNode, mediaType) {
  const stream = await downloadContentFromMessage(mediaNode, mediaType);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  return buffer;
}

/**
 * Ekstraksi pola kurung atau pemisah "isi"
 * Mendukung teks biasa maupun lampiran file (contoh: save (twk modul 1), save (twk) isi (catatan...))
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

  // Pola 4: save (judul) atau simpan (judul) (berguna saat kirim file / reply file)
  match = text.match(/^(?:save|simpan)\s*[\(\[]([^\)\]]+)[\)\]](?:\s*file)?$/i);
  if (match) {
    return { callName: match[1].trim(), content: '' };
  }

  // Pola 5: save judul file (contoh: save modul twk file)
  match = text.match(/^(?:save|simpan)\s+([\s\S]+?)\s+file$/i);
  if (match) {
    return { callName: match[1].trim(), content: '' };
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
 * Helper pengiriman konten materi (Teks atau Berkas File)
 */
async function sendItemContent(sock, fromJid, item, msg) {
  if (item.type === 'file' && item.file) {
    const filePath = path.isAbsolute(item.file.filePath)
      ? item.file.filePath
      : path.join(db.DATA_DIR, item.file.filePath);

    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      const sizeKb = (item.file.size / 1024).toFixed(1);
      const caption =
        `📌 *[ #${item.id} - ${item.callName.toUpperCase()} ]*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        (item.content ? `${item.content}\n\n` : '') +
        `📎 *Nama Berkas:* \`${item.file.fileName}\`\n` +
        `📦 *Ukuran:* ${sizeKb} KB\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕒 _Update: ${item.updatedAt}_`;

      if (item.file.fileType === 'image') {
        return await sock.sendMessage(fromJid, { image: buffer, caption }, { quoted: msg });
      } else if (item.file.fileType === 'video') {
        return await sock.sendMessage(fromJid, { video: buffer, caption }, { quoted: msg });
      } else if (item.file.fileType === 'audio') {
        return await sock.sendMessage(fromJid, { audio: buffer, mimetype: item.file.mimetype || 'audio/mp4' }, { quoted: msg });
      } else {
        // Document (PDF, Word, Excel, ZIP, dll)
        return await sock.sendMessage(fromJid, {
          document: buffer,
          mimetype: item.file.mimetype || 'application/octet-stream',
          fileName: item.file.fileName || `${item.callName}.pdf`,
          caption
        }, { quoted: msg });
      }
    }
  }

  // Teks biasa (atau file fisik tidak ditemukan)
  const resp =
    `📌 *[ #${item.id} - ${item.callName.toUpperCase()} ]*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${item.content || '_(Tidak ada isi teks)_'}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🕒 _Update: ${item.updatedAt}_`;
  return await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
}

/**
 * Main Command Handler
 */
async function handleMessage(sock, msg) {
  if (!msg.message) return;

  const key = msg.key;
  const fromJid = key.remoteJid;
  const isGroup = fromJid.endsWith('@g.us');
  const senderJid = isGroup ? (key.participantPn || key.participant || fromJid) : fromJid;

  // Dapatkan isi teks pesan (conversation, extendedText, caption dokumen/gambar)
  let actualMessage = msg.message;
  if (actualMessage.ephemeralMessage?.message) actualMessage = actualMessage.ephemeralMessage.message;
  if (actualMessage.viewOnceMessage?.message) actualMessage = actualMessage.viewOnceMessage.message;
  if (actualMessage.viewOnceMessageV2?.message) actualMessage = actualMessage.viewOnceMessageV2.message;
  if (actualMessage.documentWithCaptionMessage?.message) actualMessage = actualMessage.documentWithCaptionMessage.message;

  const messageContent = actualMessage.conversation ||
    actualMessage.extendedTextMessage?.text ||
    actualMessage.imageMessage?.caption ||
    actualMessage.videoMessage?.caption ||
    actualMessage.documentMessage?.caption ||
    '';

  const rawText = cleanText(messageContent);
  const media = extractMedia(msg);

  // Jika tidak ada teks dan tidak ada media, abaikan
  if (!rawText && !media) return;

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

  // 3. FITUR HIDETAG / TAGALL (Khusus Grup CPNS, Admin / Owner only)
  const hidetagMatch = lowerText.match(/^(?:\.|\/|#)?(?:hidetag|tagall)(?:\s+([\s\S]*))?$/i);
  if (hidetagMatch) {
    if (!isGroup) {
      await sock.sendMessage(fromJid, {
        text: '⚠️ Perintah *hidetag* hanya dapat digunakan di dalam grup WhatsApp CPNS.'
      }, { quoted: msg });
      return;
    }

    // Periksa apakah pengirim adalah Owner atau Admin Grup
    let isAdmin = whitelist.isOwner(senderJid);
    let participants = [];
    try {
      const meta = await sock.groupMetadata(fromJid);
      participants = meta.participants || [];
      if (!isAdmin) {
        const cleanSender = String(senderJid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const p = participants.find(x => x.id.replace(/[^0-9]/g, '').startsWith(cleanSender));
        if (p && (p.admin === 'admin' || p.admin === 'superadmin')) {
          isAdmin = true;
        }
      }
    } catch (_) {}

    if (!isAdmin) {
      await sock.sendMessage(fromJid, {
        text: '⚠️ Perintah *hidetag* hanya dapat digunakan oleh Admin Grup atau Owner.'
      }, { quoted: msg });
      return;
    }

    // Ambil isi teks pengumuman
    let announcement = (rawText.replace(/^(?:\.|\/|#)?(?:hidetag|tagall)\s*/i, '') || '').trim();
    if (!announcement) {
      // Jika kosong, cek apakah me-reply pesan teks
      const quoted = actualMessage.extendedTextMessage?.contextInfo?.quotedMessage;
      announcement = quoted?.conversation ||
                     quoted?.extendedTextMessage?.text ||
                     quoted?.imageMessage?.caption ||
                     quoted?.documentMessage?.caption ||
                     '📢 *PENGUMUMAN UNTUK SELURUH ANGGOTA GRUP CPNS*';
    }

    const myBotNum = (sock.user?.id || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const allMentions = participants
      .map(p => p.id)
      .filter(jid => jid && !jid.includes(myBotNum));

    const wibTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const cleanSenderNum = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    const broadcastMsg =
      `📢 *PENGUMUMAN PENTING (HIDETAG)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Oleh:* @${cleanSenderNum}\n` +
      `⏱️ *Waktu:* ${wibTime} WIB\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${announcement}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_Pemberitahuan resmi untuk seluruh anggota grup CPNS._`;

    await sock.sendMessage(fromJid, {
      text: broadcastMsg,
      mentions: allMentions
    }, { quoted: msg });
    return;
  }

  // === FITUR JAWAB KUIS SOAL CPNS ===
  const activeQuiz = quizService.getActiveQuiz(fromJid);
  if (activeQuiz) {
    // Cek apakah pesan berupa jawaban (huruf A-E tunggal atau "jawab A" / "pilih B")
    const ansMatch = lowerText.match(/^(?:jawab|jawaban|pilih|opsi)?\s*([a-e])$/i);
    if (ansMatch) {
      const userLetter = ansMatch[1].toUpperCase();
      const senderName = msg.pushName || (senderJid ? `@${senderJid.split('@')[0]}` : 'Peserta');
      const result = quizService.submitAnswer(fromJid, userLetter, senderName);
      if (result.success) {
        const respText = quizService.formatResultMessage(result);
        await sock.sendMessage(fromJid, { text: respText }, { quoted: msg });
        return;
      }
    } else if (lowerText === 'batal kuis' || lowerText === 'stop kuis' || lowerText === 'batal soal') {
      quizService.cancelQuiz(fromJid);
      await sock.sendMessage(fromJid, {
        text: '🛑 *Sesi kuis soal telah dibatalkan.*\nKetik *soal random* atau *soal tiu/twk/tkp* kapan saja untuk mulai lagi.'
      }, { quoted: msg });
      return;
    }
  }

  // === FITUR PEMANGGIL KUIS SOAL CPNS ===
  const quizTriggerMatch = lowerText.match(/^(?:soal|kuis)(?:\s+(random|acak|tiu|twk|tkp))?$/i);
  if (quizTriggerMatch) {
    let cat = quizTriggerMatch[1] ? quizTriggerMatch[1].toLowerCase() : null;
    let targetCat = null;
    if (cat === 'tiu') targetCat = 'TIU';
    else if (cat === 'twk') targetCat = 'TWK';
    else if (cat === 'tkp') targetCat = 'TKP';

    const question = quizService.startQuiz(fromJid, targetCat);
    if (!question) {
      await sock.sendMessage(fromJid, {
        text: '⚠️ Maaf, bank soal sedang disiapkan atau tidak ditemukan untuk kategori tersebut.\nSilakan coba lagi sebentar lagi.'
      }, { quoted: msg });
      return;
    }

    const qText = quizService.formatQuestionMessage(question);
    await sock.sendMessage(fromJid, { text: qText }, { quoted: msg });
    return;
  }

  // Info / Stats Bank Soal Kuis
  if (lowerText === 'stats kuis' || lowerText === 'info kuis' || lowerText === 'bank soal') {
    const stats = quizService.getStats();
    const statsMsg =
      `📊 *STATISTIK BANK SOAL CPNS (DRILLING MODE)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📚 *Total Soal Aktif:* *${stats.total} Soal*\n` +
      `• 🔴 *TWK (Wawasan Kebangsaan):* ${stats.twk} Soal\n` +
      `• 🔵 *TIU (Intelegensia Umum):* ${stats.tiu} Soal\n` +
      `• 🟢 *TKP (Karakteristik Pribadi):* ${stats.tkp} Soal\n\n` +
      `*Cara Memulai Kuis di Grup:*\n` +
      `• *soal random* (Acak semua soal)\n` +
      `• *soal tiu* (Fokus soal TIU)\n` +
      `• *soal twk* (Fokus soal TWK)\n` +
      `• *soal tkp* (Fokus soal TKP)\n` +
      `• Balas cukup ketik huruf: *A*, *B*, *C*, *D*, atau *E*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 _Seluruh soal dilengkapi kunci jawaban resmi & pembahasan instan!_`;

    await sock.sendMessage(fromJid, { text: statsMsg }, { quoted: msg });
    return;
  }

  // 4. MENU / HELP / BANTUAN
  if (lowerText === 'menu' || lowerText === 'help' || lowerText === 'bantuan') {
    const helpMsg =
      `📖 *PANDUAN PERINTAH BOT CPNS*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎯 *MODE LATIHAN SOAL / KUIS (NEW)*\n` +
      `• *soal random* / *kuis* : Munculkan 1 soal acak\n` +
      `• *soal tiu* : Latihan khusus TIU (Hitung, Logika, Verbal)\n` +
      `• *soal twk* : Latihan khusus TWK (Pancasila, UUD, Sejarah)\n` +
      `• *soal tkp* : Latihan khusus TKP (Skala 1-5 poin)\n` +
      `• *stats kuis* : Lihat total bank soal yang tersedia\n` +
      `• *batal kuis* : Menghentikan kuis yang sedang aktif\n` +
      `_Cara jawab: Cukup ketik huruf pilihan, contoh:_ \`A\` _atau_ \`jawab C\`\n\n` +
      `*1. Simpan Catatan Teks (Create)*\n` +
      `• *save [judul] isi [konten]*\n` +
      `_Contoh:_ \`save (twk pancasila) isi (Pancasila adalah dasar negara.)\`\n\n` +
      `*2. Simpan Berkas File / PDF / Foto (File Storage)*\n` +
      `• Kirim file / foto dengan caption: *save [judul]*\n` +
      `• Atau reply file yang sudah ada lalu ketik: *save [judul]*\n` +
      `• Bisa sertakan keterangan: *save [judul] isi [penjelasan]*\n` +
      `_Contoh:_ \`save (twk modul 1) isi (Modul lengkap TWK 2026 PDF)\`\n\n` +
      `*3. Panggil Materi / Unduh File (Read)*\n` +
      `• *panggil [nama]* atau langsung ketik *[nama]*\n` +
      `• Bisa panggil pakai nomor urut: *panggil 1*\n` +
      `_Bot akan otomatis mengirimkan teks atau file aslinya._\n\n` +
      `*4. Lihat Semua Materi (Read List)*\n` +
      `• *panggil daftar* / *daftar* / *list*\n\n` +
      `*5. Edit Nama Panggilan (Update)*\n` +
      `• *edit [nama lama] to [nama baru]*\n` +
      `_Contoh:_ \`edit (twk modul 1) to (twk lengkap)\`\n\n` +
      `*6. Edit Isi Catatan (Update Content)*\n` +
      `• *edit isi [nama] isi [isi baru]*\n\n` +
      `*7. Hapus Materi / File (Delete)*\n` +
      `• *hapus [nama]* atau *hapus [nomor]*\n\n` +
      `*8. Alarm & Pengingat Belajar (Reminder)*\n` +
      `• *alarm [jadwal] metode [2x/3x/4x] pesan [agenda]*\n` +
      `_Contoh:_ \`alarm (senin, 19:30) metode (3x) pesan (Tryout Akbar TIU)\`\n` +
      `• *daftar alarm* (Lihat jadwal alarm aktif)\n` +
      `• *hapus alarm [ID]* (Hapus jadwal alarm)\n\n` +
      `*9. Pengumuman Tag Semua (Admin Only)*\n` +
      `• *hidetag [pesan pengumuman]* atau reply pesan ketik *hidetag*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💾 _Data & file tersimpan aman di penyimpanan permanen._`;

    await sock.sendMessage(fromJid, { text: helpMsg }, { quoted: msg });
    return;
  }

  // 5. FITUR DAFTAR ALARM & HAPUS ALARM
  if (lowerText === 'daftar alarm' || lowerText === 'list alarm' || lowerText === 'panggil alarm') {
    const alarms = alarmService.getAlarmsByJid(fromJid);
    if (!alarms || alarms.length === 0) {
      await sock.sendMessage(fromJid, {
        text: `⏰ *Belum ada alarm / pengingat yang aktif di sini.*\n\n` +
          `Gunakan format berikut untuk menyetel alarm:\n` +
          `*alarm (jadwal) metode (2x/3x/4x) pesan (isi pengingat)*\n\n` +
          `_Contoh:_ \`alarm (senin, 19:30) metode (3x) pesan (Tryout Akbar TIU)\``
      }, { quoted: msg });
      return;
    }

    let resp = `⏰ *DAFTAR ALARM & PENGINGAT AKTIF (${alarms.length} Alarm)*\n`;
    resp += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    alarms.forEach(a => {
      const sched = alarmService.formatScheduleDisplay(a);
      const meth = alarmService.getMethodLabel(a.method);
      resp += `*ID #${a.id}* | *${a.message}*\n`;
      resp += `• ${sched}\n`;
      resp += `• Metode Notifikasi: *${meth}*\n\n`;
    });
    resp += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    resp += `💡 _Untuk membatalkan alarm, ketik: *hapus alarm <ID>*\n_Contoh:_ \`hapus alarm 1\``;

    await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
    return;
  }

  const delAlarmMatch = lowerText.match(/^(?:hapus\s*alarm|del\s*alarm|delete\s*alarm)\s+(\d+)$/i);
  if (delAlarmMatch) {
    const alarmId = delAlarmMatch[1];
    const result = alarmService.deleteAlarm(alarmId, fromJid);
    if (!result.success) {
      await sock.sendMessage(fromJid, {
        text: `⚠️ Alarm dengan ID #${alarmId} tidak ditemukan atau sudah tidak aktif.`
      }, { quoted: msg });
      return;
    }

    await sock.sendMessage(fromJid, {
      text: `✅ *Alarm ID #${result.alarm.id} Berhasil Dihapus!*\n\n` +
        `📢 Agenda: *${result.alarm.message}*\n` +
        `⏰ Jadwal: ${alarmService.formatScheduleDisplay(result.alarm)}`
    }, { quoted: msg });
    return;
  }

  // 6. FITUR SETEL ALARM (alarm ... metode ... pesan ...)
  const alarmMatch = alarmService.parseAlarmCommand(rawText);
  if (alarmMatch) {
    try {
      const newAlarm = alarmService.createAlarm({
        targetJid: fromJid,
        isGroup,
        creatorJid: senderJid,
        scheduleRaw: alarmMatch.scheduleRaw,
        message: alarmMatch.message,
        methodRaw: alarmMatch.methodRaw
      });

      const schedDisplay = alarmService.formatScheduleDisplay(newAlarm);
      const methodDisplay = alarmService.getMethodLabel(newAlarm.method);

      const resp =
        `✅ *ALARM PENGINGAT BERHASIL DISETEL!*\n\n` +
        `🔢 *ID Alarm:* #${newAlarm.id}\n` +
        `📢 *Agenda:* *${newAlarm.message}*\n` +
        `⏰ *Jadwal:* ${schedDisplay}\n` +
        `🔔 *Metode Notifikasi:* *${methodDisplay}*\n\n` +
        `💡 _Bot akan otomatis mengirimkan pengingat bertahap sesuai metode yang dipilih._\n` +
        `_Ketik *daftar alarm* untuk melihat list atau *hapus alarm ${newAlarm.id}* untuk membatalkan._`;

      await sock.sendMessage(fromJid, { text: resp }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(fromJid, {
        text: `❌ Gagal menyetel alarm: ${err.message}\n\n` +
          `*Format Contoh:*\n` +
          `• \`alarm (senin, 19:30) metode (3x) pesan (Tryout Akbar TIU)\`\n` +
          `• \`alarm (15-11-2026, 08:00) metode (2x) pesan (Ujian SKD CPNS)\`\n` +
          `• \`alarm (19:30) metode (3x) pesan (Belajar Soal TWK)\``
      }, { quoted: msg });
    }
    return;
  }

  // 5. PANGGIL DAFTAR (LIST)
  if (lowerText === 'panggil daftar' || lowerText === 'daftar' || lowerText === 'list') {
    const items = db.getAllItems();
    if (items.length === 0) {
      await sock.sendMessage(fromJid, {
        text: `📭 *Belum ada materi CPNS yang tersimpan.*\n\n` +
          `Gunakan format berikut untuk menyimpan materi pertama Anda:\n` +
          `• Catatan teks: *save (judul) isi (penjelasannya)*\n` +
          `• Berkas file: Kirim PDF/gambar dengan caption *save (judul)*`
      }, { quoted: msg });
      return;
    }

    let listText = `📚 *DAFTAR MATERI CPNS TERDATA (${items.length} Data)*\n`;
    listText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    items.forEach((item) => {
      let icon = '📝';
      let tagExtra = '';
      if (item.type === 'file' && item.file) {
        if (item.file.fileType === 'image') icon = '🖼️';
        else if (item.file.fileType === 'video') icon = '🎬';
        else if (item.file.fileType === 'audio') icon = '🎵';
        else icon = '📄';
        tagExtra = ` _[FILE: ${item.file.fileName}]_`;
      }
      listText += `*${item.id}.* ${icon} *${item.callName}*${tagExtra}\n`;
    });
    listText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    listText += `💡 _Ketik nama materi di atas (1-4 kata) atau ketik \`panggil <nomor>\` untuk membaca/mengunduh file._`;

    await sock.sendMessage(fromJid, { text: listText }, { quoted: msg });
    return;
  }

  // 6. SAVE / SIMPAN (TEKS & FILE)
  const saveMatch = parseSaveCommand(rawText);
  if (saveMatch) {
    try {
      let fileData = null;

      // Jika ada lampiran media (langsung atau dari pesan yang di-reply)
      if (media) {
        try {
          await sock.sendMessage(fromJid, {
            text: `⏳ _Sedang mengunduh dan menyimpan berkas ${media.fileName}..._`
          }, { quoted: msg });

          const buffer = await downloadMedia(media.mediaNode, media.mediaType);
          fileData = db.saveMediaFile(buffer, media.fileName, media.mimetype, media.mediaType);
        } catch (dlErr) {
          console.error('[CPNS Media Download Error]:', dlErr.message);
          await sock.sendMessage(fromJid, {
            text: `⚠️ Gagal mengunduh berkas file: ${dlErr.message}. Menyimpan sebagai catatan biasa...`
          }, { quoted: msg });
        }
      }

      const result = db.saveItem(saveMatch.callName, saveMatch.content, fileData);
      const actionText = result.isNew ? 'Disimpan Baru' : 'Diperbarui (Timpa)';

      let resp = '';
      if (result.item.type === 'file' && result.item.file) {
        const sizeKb = (result.item.file.size / 1024).toFixed(1);
        resp =
          `✅ *Materi Berkas CPNS Berhasil ${actionText}!*\n\n` +
          `🔢 *Nomor:* #${result.item.id}\n` +
          `🏷️ *Nama Panggilan:* *${result.item.callName}*\n` +
          `📎 *Nama Berkas:* \`${result.item.file.fileName}\`\n` +
          `📦 *Ukuran:* ${sizeKb} KB\n` +
          (result.item.content ? `📝 *Keterangan:* \n${result.item.content}\n\n` : '\n') +
          `💡 _Panggil file ini kapan saja dengan mengetik: *${result.item.callName}* atau *panggil ${result.item.id}*._`;
      } else {
        resp =
          `✅ *Materi CPNS Berhasil ${actionText}!*\n\n` +
          `🔢 *Nomor:* #${result.item.id}\n` +
          `🏷️ *Nama Panggilan:* *${result.item.callName}*\n` +
          `📝 *Isi:* \n${result.item.content}\n\n` +
          `💡 _Panggil materi ini kapan saja dengan mengetik: *${result.item.callName}* atau *panggil ${result.item.id}*._`;
      }

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
      await sendItemContent(sock, fromJid, item, msg);
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
      await sendItemContent(sock, fromJid, item, msg);
      return;
    }
  }
}

module.exports = {
  handleMessage
};


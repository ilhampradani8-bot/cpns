const fs = require('fs');
const path = require('path');

const MASTER_PATH = path.join(__dirname, '../data/bank_soal_master.json');
const SAMPLE_PATH = path.join(__dirname, '../data/sample_parsed_questions_lat1.json');

// Memory store for questions
let questionsCache = [];
let lastLoadedTime = 0;

// Active quiz sessions per chat (JID -> session object)
const activeSessions = new Map();

/**
 * Load questions from master database or sample fallback
 */
function loadQuestions(forceReload = false) {
  const now = Date.now();
  if (!forceReload && questionsCache.length > 0 && (now - lastLoadedTime < 30000)) {
    return questionsCache;
  }

  let list = [];

  // Try loading master database first
  if (fs.existsSync(MASTER_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf-8'));
      if (Array.isArray(data.questions) && data.questions.length > 0) {
        list = data.questions;
      }
    } catch (e) {
      console.error('[QuizService] Failed reading master:', e.message);
    }
  }

  // If master is not ready or has few questions, load sample
  if (fs.existsSync(SAMPLE_PATH)) {
    try {
      const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf-8'));
      if (Array.isArray(sample)) {
        const existingIds = new Set(list.map(q => q.id));
        for (const q of sample) {
          if (!existingIds.has(q.id)) {
            list.push(q);
          }
        }
      }
    } catch (e) {
      console.error('[QuizService] Failed reading sample:', e.message);
    }
  }

  // Filter only questions that have question text, at least 3 options, and answer key
  questionsCache = list.filter(q =>
    q.pertanyaan &&
    q.opsi &&
    Object.keys(q.opsi).length >= 3 &&
    q.kunci
  );

  lastLoadedTime = now;
  return questionsCache;
}

/**
 * Get multiple random unique questions, optionally filtered by category
 * @param {string} category - 'TWK', 'TIU', 'TKP', or null
 * @param {number} count - number of questions to pick
 */
function getRandomQuestions(category = null, count = 1) {
  const all = loadQuestions();
  let pool = all;

  if (category) {
    const targetCat = category.toUpperCase().trim();
    pool = all.filter(q => q.kategori && q.kategori.toUpperCase() === targetCat);
  }

  if (!pool || pool.length === 0) {
    pool = all;
  }

  if (pool.length === 0) return [];

  // Shuffle pool using Fisher-Yates
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const safeCount = Math.min(Math.max(1, count), shuffled.length, 25);
  return shuffled.slice(0, safeCount);
}

/**
 * Start a new quiz in a chat JID
 * @param {string} jid
 * @param {string} category - 'TWK', 'TIU', 'TKP', or null
 * @param {number} count - number of questions (default: 1)
 */
function startQuiz(jid, category = null, count = 1) {
  // Clear any existing active session
  if (activeSessions.has(jid)) {
    const existing = activeSessions.get(jid);
    if (existing.timer) clearTimeout(existing.timer);
    activeSessions.delete(jid);
  }

  const questions = getRandomQuestions(category, count);
  if (!questions || questions.length === 0) return null;

  const session = {
    jid,
    category,
    questions,
    currentIndex: 0,
    total: questions.length,
    scoreCorrect: 0,
    tkpTotalScore: 0,
    tkpMaxScore: 0,
    answers: [],
    startedAt: Date.now()
  };

  // Auto-expire after 3 minutes if no response
  session.timer = setTimeout(() => {
    if (activeSessions.get(jid) === session) {
      activeSessions.delete(jid);
    }
  }, 180000);

  activeSessions.set(jid, session);
  return {
    question: questions[0],
    currentIndex: 1,
    total: session.total
  };
}

/**
 * Get currently active question in a chat
 */
function getActiveQuiz(jid) {
  return activeSessions.get(jid) || null;
}

/**
 * Check answer from user
 */
function submitAnswer(jid, rawAnswer, senderName = 'Peserta') {
  const session = activeSessions.get(jid);
  if (!session) return { error: 'NO_ACTIVE_QUIZ' };

  const q = session.questions[session.currentIndex];
  const userLetter = String(rawAnswer || '').trim().toUpperCase();

  // Validate answer option
  if (!['A', 'B', 'C', 'D', 'E'].includes(userLetter)) {
    return { error: 'INVALID_OPTION' };
  }

  const isTkp = q.kategori === 'TKP';
  let score = 0;

  if (isTkp) {
    const pointsMap = q.skor_tkp || {};
    for (const [pts, letter] of Object.entries(pointsMap)) {
      if (letter === userLetter) {
        score = parseInt(pts, 10);
        break;
      }
    }
    if (score === 0) {
      score = (userLetter === q.kunci) ? 5 : 3;
    }
    session.tkpTotalScore += score;
    session.tkpMaxScore += 5;
  } else {
    if (userLetter === q.kunci) {
      session.scoreCorrect++;
    }
  }

  const isCorrect = (userLetter === q.kunci);
  const currentResult = {
    isTkp,
    isCorrect,
    userAnswer: userLetter,
    correctAnswer: q.kunci,
    bestAnswer: q.kunci,
    score,
    senderName,
    question: q,
    currentIndex: session.currentIndex + 1,
    total: session.total
  };

  session.answers.push(currentResult);
  session.currentIndex++;

  // Cek apakah masih ada soal berikutnya dalam paket ini
  if (session.currentIndex < session.total) {
    // Reset timer untuk soal berikutnya (3 menit)
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      if (activeSessions.get(jid) === session) {
        activeSessions.delete(jid);
      }
    }, 180000);

    const nextQ = session.questions[session.currentIndex];
    return {
      success: true,
      finished: false,
      currentResult,
      nextQuestion: nextQ,
      nextIndex: session.currentIndex + 1,
      total: session.total
    };
  }

  // Sesi paket soal sudah selesai semua!
  if (session.timer) clearTimeout(session.timer);
  activeSessions.delete(jid);

  return {
    success: true,
    finished: true,
    currentResult,
    summary: {
      total: session.total,
      scoreCorrect: session.scoreCorrect,
      scorePct: Math.round((session.scoreCorrect / session.total) * 100),
      isTkp,
      tkpTotalScore: session.tkpTotalScore,
      tkpMaxScore: session.tkpMaxScore,
      senderName
    }
  };
}

/**
 * Cancel active quiz
 */
function cancelQuiz(jid) {
  if (activeSessions.has(jid)) {
    const s = activeSessions.get(jid);
    if (s.timer) clearTimeout(s.timer);
    activeSessions.delete(jid);
    return true;
  }
  return false;
}

/**
 * Format question for WhatsApp message
 */
function formatQuestionMessage(q, currentIndex = 1, total = 1) {
  const catBadge = q.kategori ? `[ ${q.kategori.toUpperCase()} ]` : '[ SKD CPNS ]';
  const progressBadge = total > 1 ? ` *(Soal ${currentIndex} dari ${total})*` : '';

  let msg = `🎯 *KUIS DRILLING CPNS* ${catBadge}${progressBadge}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `❓ *Pertanyaan:*\n${q.pertanyaan}\n\n`;
  msg += `*Pilihan Jawaban:*\n`;

  const opts = q.opsi || {};
  ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
    if (opts[letter]) {
      msg += `*${letter}.* ${opts[letter]}\n`;
    }
  });

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 *Cara Menjawab:*\n`;
  msg += `Ketik huruf pilihanmu, misal: *A* atau *jawab A*\n`;
  msg += `⏱️ _Waktu: 3 menit_`;

  return msg;
}

/**
 * Format answer result message & next step
 */
function formatResultMessage(resObj) {
  const cur = resObj.currentResult || resObj;
  const q = cur.question;
  let msg = '';

  const progressHeader = cur.total > 1 ? ` (Nomor ${cur.currentIndex}/${cur.total})` : '';

  if (cur.isTkp) {
    const stars = '⭐'.repeat(cur.score);
    msg += `📊 *HASIL JAWABAN TKP${progressHeader}* - *${cur.senderName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Pilihan Kamu: *${cur.userAnswer}*\n`;
    msg += `🎖️ *Perolehan Poin:* *${cur.score} / 5* ${stars}\n`;
    msg += `Jawaban Poin Maksimal (5): *${cur.bestAnswer}*\n\n`;
  } else if (cur.isCorrect) {
    msg += `🎉 *JAWABAN BENAR!${progressHeader}* - *${cur.senderName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Jawaban Kamu: *${cur.userAnswer}* (Tepat!)\n`;
    msg += `Kunci Jawaban: *${cur.correctAnswer}*\n\n`;
  } else {
    msg += `❌ *JAWABAN KURANG TEPAT!${progressHeader}* - *${cur.senderName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Jawaban Kamu: *${cur.userAnswer}*\n`;
    msg += `Kunci Jawaban yang Benar: *${cur.correctAnswer}*\n\n`;
  }

  if (q.pembahasan) {
    msg += `📖 *Pembahasan:*\n${q.pembahasan}\n\n`;
  }

  // Jika paket belum selesai dan ada soal berikutnya
  if (!resObj.finished && resObj.nextQuestion) {
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `▶️ *LANJUT KE SOAL BERIKUTNYA...*\n\n`;
    msg += formatQuestionMessage(resObj.nextQuestion, resObj.nextIndex, resObj.total);
    return msg;
  }

  // Jika paket sudah selesai semua (Summary)
  if (resObj.finished && resObj.summary && resObj.summary.total > 1) {
    const sum = resObj.summary;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🏁 *SESI PAKET SOAL SELESAI!*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👤 *Peserta:* ${sum.senderName}\n`;
    msg += `📋 *Total Soal:* ${sum.total} Soal\n`;
    if (sum.isTkp) {
      msg += `🎖️ *Total Skor TKP:* *${sum.tkpTotalScore} / ${sum.tkpMaxScore}* Poin\n`;
    } else {
      msg += `✅ *Jumlah Benar:* *${sum.scoreCorrect} / ${sum.total}* Soal\n`;
      msg += `📈 *Persentase Akurasi:* *${sum.scorePct}%*\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 _Ketik *soal random* atau *soal tiu (jumlah)* untuk latihan lagi!_`;
    return msg;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 _Ketik *soal random* atau *soal tiu/twk/tkp* untuk lanjut kuis berikutnya!_`;
  return msg;
}

/**
 * Get database statistics
 */
function getStats() {
  const all = loadQuestions();
  return {
    total: all.length,
    twk: all.filter(q => q.kategori === 'TWK').length,
    tiu: all.filter(q => q.kategori === 'TIU').length,
    tkp: all.filter(q => q.kategori === 'TKP').length
  };
}

module.exports = {
  loadQuestions,
  getRandomQuestions,
  startQuiz,
  getActiveQuiz,
  submitAnswer,
  cancelQuiz,
  formatQuestionMessage,
  formatResultMessage,
  getStats
};

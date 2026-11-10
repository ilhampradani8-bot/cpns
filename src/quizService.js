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
        // Merge without duplicating IDs
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
 * Get random question, optionally filtered by category
 * @param {string} category - 'TWK', 'TIU', 'TKP', or null
 */
function getRandomQuestion(category = null) {
  const all = loadQuestions();
  let pool = all;

  if (category) {
    const targetCat = category.toUpperCase().trim();
    pool = all.filter(q => q.kategori && q.kategori.toUpperCase() === targetCat);
  }

  if (!pool || pool.length === 0) {
    // If no filtered question found, fall back to all
    pool = all;
  }

  if (pool.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

/**
 * Start a new quiz in a chat JID
 */
function startQuiz(jid, category = null) {
  // Clear any existing active session timer
  if (activeSessions.has(jid)) {
    const existing = activeSessions.get(jid);
    if (existing.timer) clearTimeout(existing.timer);
    activeSessions.delete(jid);
  }

  const question = getRandomQuestion(category);
  if (!question) return null;

  const session = {
    jid,
    question,
    startedAt: Date.now(),
    answered: false
  };

  // Set timeout to auto-expire after 3 minutes
  session.timer = setTimeout(() => {
    if (activeSessions.get(jid) === session) {
      activeSessions.delete(jid);
    }
  }, 180000);

  activeSessions.set(jid, session);
  return question;
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

  const q = session.question;
  const userLetter = String(rawAnswer || '').trim().toUpperCase();

  // Validate answer option
  if (!['A', 'B', 'C', 'D', 'E'].includes(userLetter)) {
    return { error: 'INVALID_OPTION' };
  }

  // Clear timer & session
  if (session.timer) clearTimeout(session.timer);
  activeSessions.delete(jid);

  const isTkp = q.kategori === 'TKP';

  if (isTkp) {
    const pointsMap = q.skor_tkp || {};
    let score = 0;
    // Find points for chosen letter
    for (const [pts, letter] of Object.entries(pointsMap)) {
      if (letter === userLetter) {
        score = parseInt(pts, 10);
        break;
      }
    }
    // Fallback if not mapped
    if (score === 0) {
      score = (userLetter === q.kunci) ? 5 : 3;
    }

    return {
      success: true,
      isTkp: true,
      userAnswer: userLetter,
      bestAnswer: q.kunci,
      score,
      maxScore: 5,
      senderName,
      question: q
    };
  }

  // Standard TWK / TIU (Right or Wrong)
  const isCorrect = (userLetter === q.kunci);
  return {
    success: true,
    isTkp: false,
    isCorrect,
    userAnswer: userLetter,
    correctAnswer: q.kunci,
    senderName,
    question: q
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
function formatQuestionMessage(q, totalQuestions = 0) {
  const catBadge = q.kategori ? `[ ${q.kategori.toUpperCase()} ]` : '[ SKD CPNS ]';
  let msg = `🎯 *KUIS DRILLING CPNS* ${catBadge}\n`;
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
  msg += `⏱️ _Waktu menjawab: 3 menit_`;

  return msg;
}

/**
 * Format answer result message
 */
function formatResultMessage(result) {
  const q = result.question;
  let msg = '';

  if (result.isTkp) {
    const stars = '⭐'.repeat(result.score);
    msg += `📊 *HASIL JAWABAN TKP (${result.senderName})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Pilihan Kamu: *${result.userAnswer}*\n`;
    msg += `🎖️ *Perolehan Poin:* *${result.score} / 5* ${stars}\n`;
    msg += `Jawaban Poin Maksimal (5): *${result.bestAnswer}*\n\n`;
  } else if (result.isCorrect) {
    msg += `🎉 *JAWABAN BENAR!* (${result.senderName})\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Jawaban Kamu: *${result.userAnswer}* (Tepat!)\n`;
    msg += `Kunci Jawaban: *${result.correctAnswer}*\n\n`;
  } else {
    msg += `❌ *JAWABAN KURANG TEPAT!* (${result.senderName})\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Jawaban Kamu: *${result.userAnswer}*\n`;
    msg += `Kunci Jawaban yang Benar: *${result.correctAnswer}*\n\n`;
  }

  if (q.pembahasan) {
    msg += `📖 *Pembahasan:*\n${q.pembahasan}\n\n`;
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
  getRandomQuestion,
  startQuiz,
  getActiveQuiz,
  submitAnswer,
  cancelQuiz,
  formatQuestionMessage,
  formatResultMessage,
  getStats
};

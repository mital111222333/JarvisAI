// JARVIS backend — Vercel Serverless Function
// Прячет GEMINI_API_KEY, проксирует запросы к Gemini API, читает и обновляет
// умную память (Supabase) — факты о пользователе между разговорами.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const BASE_SYSTEM_PROMPT = `Ты — Джарвис, личный ИИ-ассистент Саидбонура. Характер: дружелюбный, неформальный, живой, с лёгким юмором, но по делу.
Отвечай на том же языке, на котором пишет пользователь — если он пишет на узбекском, отвечай на узбекском; если на русском — на русском.
Ответы держи короткими и разговорными (1-4 предложения) — они будут ещё и озвучены голосом.
Ты умеешь анализировать прикреплённые файлы: фото, видео, PDF и документы — если пользователь прислал файл, разбери его содержимое по существу.
Это ранний прототип: часть функций (календарь, задачи, аналитика MITAL) ещё не подключены — если пользователь просит то, чего ты пока не умеешь, честно скажи об этом коротко и дружелюбно.`;

// --- память: чтение сохранённых фактов ---
async function getMemoryFacts() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/memory_facts?select=fact&order=created_at.asc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r) => r.fact);
  } catch (err) {
    console.error("Ошибка чтения памяти:", err);
    return [];
  }
}

// --- память: сохранение новых фактов ---
async function saveMemoryFacts(facts) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !facts.length) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/memory_facts`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(facts.map((fact) => ({ fact }))),
    });
  } catch (err) {
    console.error("Ошибка сохранения памяти:", err);
  }
}

// --- лёгкий вызов Gemini, чтобы выделить новые факты из разговора ---
async function extractNewFacts(userText, replyText, knownFacts, apiKey) {
  try {
    const prompt = `Вот сообщение пользователя и ответ ассистента. Уже известные факты о пользователе:
${knownFacts.length ? knownFacts.map((f) => "- " + f).join("\n") : "(пока ничего не известно)"}

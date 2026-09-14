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

Сообщение пользователя: "${userText}"
Ответ ассистента: "${replyText}"

Если в сообщении пользователя есть НОВЫЙ durable-факт о нём самом (имя, работа, привычки, предпочтения, открытые задачи, важные детали жизни) — которого ещё нет в списке выше — верни JSON-массив коротких фактов на русском, например ["живёт в Андижане"]. Если ничего нового и важного нет — верни пустой массив []. Только JSON, без пояснений.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "[]";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string" && f.trim()) : [];
  } catch (err) {
    console.error("Ошибка извлечения фактов:", err);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Метод не поддерживается, нужен POST." });
    return;
  }

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      res.status(500).json({ error: "GEMINI_API_KEY не настроен в переменных окружения Vercel." });
      return;
    }

    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Нужен непустой массив messages." });
      return;
    }

    const knownFacts = await getMemoryFacts();
    const systemPrompt = knownFacts.length
      ? BASE_SYSTEM_PROMPT +
        `\n\nВот что ты уже знаешь о Саидбонуре из прошлых разговоров:\n` +
        knownFacts.map((f) => "- " + f).join("\n")
      : BASE_SYSTEM_PROMPT;

    const contents = messages.map((m) => {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      if (Array.isArray(m.attachments)) {
        for (const att of m.attachments) {
          if (att?.data && att?.mimeType) {
            parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
          }
        }
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
      }),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Gemini error:", data);
      res.status(502).json({ error: "Ошибка от Gemini API", details: data });
      return;
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      "Не смог сформулировать ответ.";

    res.status(200).json({ reply });

    // извлекаем новые факты уже после ответа пользователю, не задерживая его
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg?.content) {
      const newFacts = await extractNewFacts(lastUserMsg.content, reply, knownFacts, GEMINI_API_KEY);
      await saveMemoryFacts(newFacts);
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Внутренняя ошибка сервера." });
    }
  }
}

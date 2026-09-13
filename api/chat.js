// JARVIS backend — Vercel Serverless Function
// Прячет GEMINI_API_KEY и проксирует запросы к Gemini API.
// Деплоится бесплатно и без "засыпания" на Vercel (см. README.md).

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const SYSTEM_PROMPT = `Ты — Джарвис, личный ИИ-ассистент Саидбонура. Характер: дружелюбный, неформальный, живой, с лёгким юмором, но по делу.
Отвечай на том же языке, на котором пишет пользователь — если он пишет на узбекском, отвечай на узбекском; если на русском — на русском.
Ответы держи короткими и разговорными (1-4 предложения) — они будут ещё и озвучены голосом.
Ты умеешь анализировать прикреплённые файлы: фото, видео, PDF и документы — если пользователь прислал файл, разбери его содержимое по существу.
Это ранний прототип: часть функций (память, календарь, задачи, аналитика MITAL) ещё не подключены — если пользователь просит то, чего ты пока не умеешь, честно скажи об этом коротко и дружелюбно.`;

export default async function handler(req, res) {
  // CORS — разрешаем вызовы со страницы Джарвиса из браузера
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

    // Gemini формат: contents: [{ role: "user"|"model", parts: [{text}, {inlineData}, ...] }]
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
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts,
      };
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера." });
  }
}

// JARVIS Telegram Bot — Vercel Serverless Function
// Принимает вебхуки от Telegram, отвечает через Gemini, помнит факты (Supabase).

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HISTORY_LIMIT = 10; // сколько последних сообщений помнить в рамках диалога

const BASE_SYSTEM_PROMPT = `Ты — Джарвис, личный ИИ-ассистент Саидбонура, работаешь через Telegram. Характер: дружелюбный, неформальный, живой, с лёгким юмором, но по делу.
Отвечай на том же языке, на котором пишет пользователь — если он пишет на узбекском, отвечай на узбекском; если на русском — на русском.
Ответы держи короткими и разговорными — это переписка в Telegram, а не документ.
Это ранний прототип: часть функций (календарь, задачи, аналитика MITAL) ещё не подключены — если пользователь просит то, чего ты пока не умеешь, честно скажи об этом коротко и дружелюбно.`;

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

async function getHistory(chatId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/conversation_history?chat_id=eq.${chatId}&select=role,content&order=created_at.desc&limit=${HISTORY_LIMIT}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.reverse(); // от старых к новым
  } catch (err) {
    console.error("Ошибка чтения истории:", err);
    return [];
  }
}

async function saveHistory(chatId, role, content) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/conversation_history`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{ chat_id: chatId, role, content }]),
    });
  } catch (err) {
    console.error("Ошибка сохранения истории:", err);
  }
}

async function extractNewFacts(userText, replyText, knownFacts, apiKey) {
  try {
    const prompt = `Вот сообщение пользователя и ответ ассистента. Уже известные факты о пользователе:
${knownFacts.length ? knownFacts.map((f) => "- " + f).join("\n") : "(пока ничего не известно)"}

Сообщение пользователя: "${userText}"
Ответ ассистента: "${replyText}"

Если в сообщении пользователя есть НОВЫЙ durable-факт о нём самом — которого ещё нет в списке выше — верни JSON-массив коротких фактов на русском. Если ничего нового и важного нет — верни пустой массив []. Только JSON, без пояснений.`;

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

async function sendTelegramMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default async function handler(req, res) {
  // Telegram ждёт быстрый ответ 200, всю работу можно делать после
  if (req.method !== "POST") {
    res.status(200).send("Telegram webhook is alive. Use POST.");
    return;
  }

  try {
    const update = req.body;
    const message = update?.message;

    if (!message || !TELEGRAM_BOT_TOKEN) {
      res.status(200).json({ ok: true });
      return;
    }

    const chatId = message.chat.id;
    const userText = message.text;

    if (!userText) {
      res.status(200).json({ ok: true });
      await sendTelegramMessage(chatId, "Пока умею только текст — фото, голос и файлы добавим следующим шагом 🙂");
      return;
    }

    res.status(200).json({ ok: true }); // отвечаем Telegram сразу, дальше работаем в фоне

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      await sendTelegramMessage(chatId, "GEMINI_API_KEY не настроен на сервере.");
      return;
    }

    const [knownFacts, history] = await Promise.all([getMemoryFacts(), getHistory(chatId)]);

    const systemPrompt = knownFacts.length
      ? BASE_SYSTEM_PROMPT + `\n\nВот что ты уже знаешь о Саидбонуре из прошлых разговоров:\n` + knownFacts.map((f) => "- " + f).join("\n")
      : BASE_SYSTEM_PROMPT;

    const contents = [
      ...history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
      { role: "user", parts: [{ text: userText }] },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] } }),
    });
    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Gemini error:", data);
      await sendTelegramMessage(chatId, "Ошибка от Gemini API: " + JSON.stringify(data).slice(0, 300));
      return;
    }

    const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "Не смог сформулировать ответ.";
    await sendTelegramMessage(chatId, reply);

    await Promise.all([
      saveHistory(chatId, "user", userText),
      saveHistory(chatId, "assistant", reply),
    ]);

    const newFacts = await extractNewFacts(userText, reply, knownFacts, GEMINI_API_KEY);
    await saveMemoryFacts(newFacts);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(200).json({ ok: true }); // Telegram всё равно не должен получить ошибку
    }
  }
}

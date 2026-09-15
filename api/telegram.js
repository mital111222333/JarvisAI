// JARVIS Telegram Bot — Vercel Serverless Function
// Текст, фото, голос, видео, документы (Excel/PDF), ссылки, поиск в интернете,
// генерация картинок/Excel, голосовые ответы (ElevenLabs), память (Supabase).

import * as XLSX from "xlsx";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
const HISTORY_LIMIT = 10;

const BASE_SYSTEM_PROMPT = `Ты — Джарвис, личный ИИ-ассистент Саидбонура, работаешь через Telegram. Характер: дружелюбный, неформальный, живой, с лёгким юмором, но по делу.
Отвечай на том же языке, на котором пишет пользователь — если он пишет на узбекском, отвечай на узбекском; если на русском — на русском.
Ответы держи короткими и разговорными — это переписка в Telegram, а не документ.
Ты умеешь анализировать присланные фото, голосовые, видео, PDF и Excel/CSV файлы, читать ссылки и искать актуальную информацию в интернете — отвечай по существу.
Если на присланном ФОТО есть таблица с числами и нужно что-то посчитать (сумма, план/факт и т.п.) — сначала перечисли построчно все значения, которые ты видишь на фото (кратко, в столбик), и только потом дай итоговый расчёт. Это нужно, чтобы пользователь мог сразу проверить, правильно ли ты прочитал цифры с изображения — распознавание текста на фото не идеально, особенно на длинных таблицах. Если фото нечёткое или строк много и есть риск ошибиться — прямо скажи об этом и предложи прислать файл (.xlsx/.csv) вместо фото для точного счёта.
Это ранний прототип: часть функций (календарь, задачи, аналитика MITAL) ещё не подключены — если пользователь просит то, чего ты пока не умеешь, честно скажи об этом коротко и дружелюбно.

Если пользователь просит сгенерировать или отредактировать изображение — напиши короткий обычный ответ, и в конце на отдельной строке добавь: [[IMAGE_PROMPT: подробное описание нужного изображения на английском]]. Если он прислал фото и просит его отредактировать — опиши в промпте, что изменить.

Если пользователь просит создать таблицу/отчёт/экспорт в Excel — напиши короткий обычный ответ, и в конце на отдельной строке добавь: [[EXCEL_TABLE: {"sheetName":"Лист1","headers":["Колонка1","Колонка2"],"rows":[["значение1","значение2"]]}]] — валидный JSON в одну строку.

Если пользователь спрашивает про расписание/календарь/что у него запланировано — напиши короткий ответ и добавь на отдельной строке: [[CALENDAR_LIST]]
Если пользователь просит создать событие/встречу/напоминание в календаре — напиши короткий ответ и добавь на отдельной строке: [[CALENDAR_CREATE: {"title":"Название","start":"2026-09-20T14:00:00+05:00","end":"2026-09-20T15:00:00+05:00","description":""}]] — время в формате ISO с часовым поясом Узбекистана (+05:00), обязательно валидный JSON в одну строку. Сегодняшняя дата и время будут даны тебе в контексте, ориентируйся по ним.

Если пользователь просит напомнить о чём-то — напиши короткий ответ-подтверждение и добавь на отдельной строке метку. Три варианта:
- Разовое напоминание: [[REMINDER_CREATE: {"message":"текст","remind_at":"2026-09-20T14:00:00+05:00","recurrence":"once"}]]
- Ежедневное: [[REMINDER_CREATE: {"message":"текст","remind_at":"2026-09-20T09:00:00+05:00","recurrence":"daily"}]]
- Напоминать периодически, пока не отметит выполненным (для важных задач): [[REMINDER_CREATE: {"message":"текст","remind_at":"2026-09-20T14:00:00+05:00","recurrence":"until_done","interval_minutes":60,"task_match":"ключевые слова задачи"}]] — используй, когда пользователь просит "напоминай, пока не сделаю" или похоже; interval_minutes — как часто дёргать (по умолчанию 60), task_match должен совпадать с текстом соответствующей задачи в его списке дел.
Время в ISO формате с часовым поясом Узбекистана (+05:00), обязательно валидный JSON в одну строку. Посчитай точное время сам.

Если пользователь просит остановить/отменить напоминание — напиши короткий ответ и добавь: [[REMINDER_STOP: {"match":"ключевые слова напоминания"}]]

Если пользователь просит добавить задачу/дело в список (без привязки ко времени, просто "запомни что нужно сделать") — напиши короткий ответ и добавь: [[TASK_ADD: {"task":"текст задачи"}]]
Если пользователь просит показать список задач/дел — напиши короткий ответ и добавь: [[TASK_LIST]]
Если пользователь говорит, что задача выполнена/сделана — напиши короткий ответ и добавь: [[TASK_DONE: {"match":"ключевые слова из задачи"}]] — используй слова, по которым задачу можно узнать в списке.`;

// ---------- память и история (Supabase) ----------
async function getMemoryFacts() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/memory_facts?select=fact&order=created_at.asc`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) return [];
    return (await res.json()).map((r) => r.fact);
  } catch (err) { console.error("Ошибка чтения памяти:", err); return []; }
}

async function saveMemoryFacts(facts) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !facts.length) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/memory_facts`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(facts.map((fact) => ({ fact }))),
    });
  } catch (err) { console.error("Ошибка сохранения памяти:", err); }
}

async function getHistory(chatId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/conversation_history?chat_id=eq.${chatId}&select=role,content&order=created_at.desc&limit=${HISTORY_LIMIT}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) return [];
    return (await res.json()).reverse();
  } catch (err) { console.error("Ошибка чтения истории:", err); return []; }
}

async function saveHistory(chatId, role, content) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !content) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/conversation_history`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([{ chat_id: chatId, role, content }]),
    });
  } catch (err) { console.error("Ошибка сохранения истории:", err); }
}

async function extractNewFacts(userText, replyText, knownFacts, apiKey) {
  try {
    const prompt = `Вот сообщение пользователя и ответ ассистента. Уже известные факты о пользователе:
${knownFacts.length ? knownFacts.map((f) => "- " + f).join("\n") : "(пока ничего не известно)"}

Сообщение пользователя: "${userText}"
Ответ ассистента: "${replyText}"

Если в сообщении пользователя есть НОВЫЙ durable-факт о нём самом — которого ещё нет в списке выше — верни JSON-массив коротких фактов на русском. Если ничего нового нет — верни []. Только JSON, без пояснений.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string" && f.trim()) : [];
  } catch (err) { console.error("Ошибка извлечения фактов:", err); return []; }
}

// ---------- Telegram API helpers ----------
async function tgFetch(method, body) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const MAIN_KEYBOARD = {
  keyboard: [
    ["🎨 Нарисуй...", "📊 Сделай таблицу..."],
    ["🔍 Найди в интернете...", "🔗 Прочитай ссылку..."],
  ],
  resize_keyboard: true,
};

async function sendTelegramMessage(chatId, text, withKeyboard) {
  const body = { chat_id: chatId, text };
  if (withKeyboard) body.reply_markup = MAIN_KEYBOARD;
  await tgFetch("sendMessage", body);
}

async function sendTelegramPhoto(chatId, buffer, mimeType) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([buffer], { type: mimeType }), "image.png");
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
}

async function sendTelegramDocument(chatId, buffer, filename) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([buffer]), filename);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
}

async function sendTelegramAudio(chatId, buffer, mimeType) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", new Blob([buffer], { type: mimeType }), "voice.mp3");
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAudio`, { method: "POST", body: form });
}

async function downloadTelegramFile(fileId) {
  const infoRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const info = await infoRes.json();
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error("Не удалось получить файл от Telegram (возможно, больше 20 МБ)");
  const fileRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, base64: buffer.toString("base64"), filePath };
}

function extOf(path) {
  const m = (path || "").match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "";
}

// ---------- чтение ссылок ----------
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrlAsText(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (JARVIS bot)" } });
    const html = await res.text();
    const text = stripHtml(html).slice(0, 8000);
    return `[Содержимое страницы ${url}]:\n${text}`;
  } catch (err) {
    return `[Не удалось загрузить страницу ${url}: ${err.message}]`;
  }
}

// ---------- генерация изображений и Excel ----------
async function generateImage(prompt, refImageBase64, refMimeType, apiKey) {
  const parts = [{ text: prompt }];
  if (refImageBase64) parts.push({ inlineData: { mimeType: refMimeType, data: refImageBase64 } });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"] } }) });
  const data = await res.json();
  if (!res.ok) throw new Error("Ошибка Gemini image: " + JSON.stringify(data).slice(0, 200));
  const imgPart = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!imgPart) throw new Error("Gemini не вернул изображение");
  return { buffer: Buffer.from(imgPart.inlineData.data, "base64"), mimeType: imgPart.inlineData.mimeType };
}

function buildExcelBuffer(excelData) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([excelData.headers || [], ...(excelData.rows || [])]);
  XLSX.utils.book_append_sheet(wb, ws, (excelData.sheetName || "Лист1").slice(0, 31));
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}

async function generateVoiceReply(text) {
  if (!ELEVENLABS_API_KEY) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_API_KEY },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (err) { console.error("Ошибка ElevenLabs:", err); return null; }
}

function extractMarkers(text) {
  let cleanText = text, imagePrompt = null, excelData = null, calendarList = false, calendarCreate = null, reminderCreate = null;
  let taskAdd = null, taskList = false, taskDone = null;
  const imgMatch = text.match(/\[\[IMAGE_PROMPT:\s*([\s\S]*?)\]\]/);
  if (imgMatch) { imagePrompt = imgMatch[1].trim(); cleanText = cleanText.replace(imgMatch[0], "").trim(); }
  const excelMatch = text.match(/\[\[EXCEL_TABLE:\s*(\{[\s\S]*?\})\s*\]\]/);
  if (excelMatch) {
    try { excelData = JSON.parse(excelMatch[1]); } catch (err) { console.error("EXCEL_TABLE parse error:", err); }
    cleanText = cleanText.replace(excelMatch[0], "").trim();
  }
  const listMatch = text.match(/\[\[CALENDAR_LIST\]\]/);
  if (listMatch) { calendarList = true; cleanText = cleanText.replace(listMatch[0], "").trim(); }
  const createMatch = text.match(/\[\[CALENDAR_CREATE:\s*(\{[\s\S]*?\})\s*\]\]/);
  if (createMatch) {
    try { calendarCreate = JSON.parse(createMatch[1]); } catch (err) { console.error("CALENDAR_CREATE parse error:", err); }
    cleanText = cleanText.replace(createMatch[0], "").trim();
  }
  const reminderMatch = text.match(/\[\[REMINDER_CREATE:\s*(\{[\s\S]*?\})\s*\]\]/);
  if (reminderMatch) {
    try { reminderCreate = JSON.parse(reminderMatch[1]); } catch (err) { console.error("REMINDER_CREATE parse error:", err); }
    cleanText = cleanText.replace(reminderMatch[0], "").trim();
  }
  let reminderStop = null;
  const reminderStopMatch = text.match(/\[\[REMINDER_STOP:\s*(\{[\s\S]*?\})\s*\]\]/);
  if (reminderStopMatch) {
    try { reminderStop = JSON.parse(reminderStopMatch[1]); } catch (err) { console.error("REMINDER_STOP parse error:", err); }
    cleanText = cleanText.replace(reminderStopMatch[0], "").trim();
  }
  const taskAddMatch = text.match(/\[\[TASK_ADD:\s*(\{[\s\S]*?\})\s*\]\]/);
  if (taskAddMatch) {
    try { taskAdd = JSON.parse(taskAddMatch[1]); } catch (err) { console.error("TASK_ADD parse error:", err); }
    cleanText = cleanText.replace(taskAddMatch[0], "").trim();
  }
  const taskListMatch = text.match(/\[\[TASK_LIST\]\]/);
  if (taskListMatch) { taskList = true; cleanText = cleanText.replace(taskListMatch[0], "").trim(); }
  const taskDoneMatch = text.match(/\[\[TASK_DONE:\s*(\{[\s\S]*?\})\s*\]\]/);
  if (taskDoneMatch) {
    try { taskDone = JSON.parse(taskDoneMatch[1]); } catch (err) { console.error("TASK_DONE parse error:", err); }
    cleanText = cleanText.replace(taskDoneMatch[0], "").trim();
  }
  return { cleanText, imagePrompt, excelData, calendarList, calendarCreate, reminderCreate, reminderStop, taskAdd, taskList, taskDone };
}

// ---------- задачи (to-do) ----------
async function addTask(chatId, task) {
  await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify([{ chat_id: chatId, task }]),
  });
}

async function listTasks(chatId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?chat_id=eq.${chatId}&done=eq.false&select=id,task&order=created_at.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.ok ? await res.json() : [];
}

async function completeTask(chatId, matchText) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?chat_id=eq.${chatId}&done=eq.false&task=ilike.*${encodeURIComponent(matchText)}*&select=id,task&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = res.ok ? await res.json() : [];
  if (!rows.length) return null;
  await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${rows[0].id}`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ done: true }),
  });
  return rows[0].task;
}

async function saveReminder(chatId, message, remindAt, recurrence, intervalMinutes, taskMatch) {
  await fetch(`${SUPABASE_URL}/rest/v1/reminders`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify([{
      chat_id: chatId, message, remind_at: remindAt,
      recurrence: recurrence || "once",
      interval_minutes: intervalMinutes || 60,
      task_match: taskMatch || null,
    }]),
  });
}

async function stopReminder(chatId, matchText) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/reminders?chat_id=eq.${chatId}&sent=eq.false&message=ilike.*${encodeURIComponent(matchText)}*&select=id,message&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = res.ok ? await res.json() : [];
  if (!rows.length) return null;
  await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${rows[0].id}`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ sent: true }),
  });
  return rows[0].message;
}


async function getGoogleAccessToken() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_CLIENT_ID) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/google_tokens?select=refresh_token&order=created_at.desc&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await res.json();
    const refreshToken = rows?.[0]?.refresh_token;
    if (!refreshToken) return null;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    return tokenData.access_token || null;
  } catch (err) { console.error("Ошибка получения Google-токена:", err); return null; }
}

async function listUpcomingEvents(accessToken, maxResults = 10) {
  const now = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=${maxResults}&orderBy=startTime&singleEvents=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error("Calendar API error: " + JSON.stringify(data).slice(0, 200));
  return (data.items || []).map((e) => ({
    title: e.summary || "(без названия)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
  }));
}

async function createCalendarEvent(accessToken, { title, start, end, description }) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: title,
      description: description || "",
      start: { dateTime: start },
      end: { dateTime: end },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Calendar create error: " + JSON.stringify(data).slice(0, 200));
  return data;
}


const URL_REGEX = /https?:\/\/[^\s]+/;

async function messageToParts(message) {
  const parts = [];
  let refImage = null;

  if (message.text) {
    parts.push({ text: message.text });
    const urlMatch = message.text.match(URL_REGEX);
    if (urlMatch) parts.push({ text: await fetchUrlAsText(urlMatch[0]) });
  }

  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    const { base64 } = await downloadTelegramFile(largest.file_id);
    parts.push({ inlineData: { mimeType: "image/jpeg", data: base64 } });
    refImage = { base64, mimeType: "image/jpeg" };
    if (message.caption) parts.push({ text: message.caption });
  }

  if (message.voice) {
    const { base64 } = await downloadTelegramFile(message.voice.file_id);
    parts.push({ inlineData: { mimeType: "audio/ogg", data: base64 } });
    parts.push({ text: "[Голосовое сообщение] Выслушай и ответь по существу того, что сказано." });
  }

  if (message.video || message.video_note) {
    const video = message.video || message.video_note;
    try {
      const { base64 } = await downloadTelegramFile(video.file_id);
      parts.push({ inlineData: { mimeType: "video/mp4", data: base64 } });
      parts.push({ text: "[Видео] Посмотри и ответь по содержимому." });
      if (message.caption) parts.push({ text: message.caption });
    } catch (err) {
      parts.push({ text: "[Не удалось загрузить видео: " + err.message + "]" });
    }
  }

  if (message.document) {
    const { buffer, base64, filePath } = await downloadTelegramFile(message.document.file_id);
    const ext = extOf(filePath || message.document.file_name || "");
    if (["xlsx", "xls", "csv"].includes(ext)) {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const csvParts = wb.SheetNames.map((name) => `Лист "${name}":\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`);
      parts.push({ text: `[Данные из файла "${message.document.file_name}"]:\n${csvParts.join("\n\n")}` });
    } else {
      parts.push({ inlineData: { mimeType: message.document.mime_type || "application/octet-stream", data: base64 } });
    }
    if (message.caption) parts.push({ text: message.caption });
  }

  return { parts, refImage };
}

function partsToUserText(parts) {
  return parts.filter((p) => p.text).map((p) => p.text).join(" ").slice(0, 2000) || "[вложение без текста]";
}

// ---------- основной обработчик ----------
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(200).send("Telegram webhook is alive. Use POST."); return; }

  try {
    const message = req.body?.message;
    if (!message || !TELEGRAM_BOT_TOKEN) { res.status(200).json({ ok: true }); return; }

    const chatId = message.chat.id;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) { await sendTelegramMessage(chatId, "GEMINI_API_KEY не настроен на сервере."); res.status(200).json({ ok: true }); return; }

    if (message.text === "/start") {
      await sendTelegramMessage(chatId, "Привет, Саидбонур! Я Джарвис — пиши, присылай фото/видео/голосовые/файлы или ссылки, ищу в интернете, рисую и делаю таблицы.", true);
      res.status(200).json({ ok: true }); return;
    }

    const { parts: userParts, refImage } = await messageToParts(message);
    if (!userParts.length) {
      await sendTelegramMessage(chatId, "Не понял, что с этим делать — попробуй текстом, фото, голосовым, видео или файлом.");
      res.status(200).json({ ok: true }); return;
    }
    const userTextForHistory = partsToUserText(userParts);

    const [knownFacts, history] = await Promise.all([getMemoryFacts(), getHistory(chatId)]);
    const nowTashkent = new Date().toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", dateStyle: "full", timeStyle: "short" });
    const systemPrompt = (knownFacts.length
      ? BASE_SYSTEM_PROMPT + `\n\nВот что ты уже знаешь о Саидбонуре из прошлых разговоров:\n` + knownFacts.map((f) => "- " + f).join("\n")
      : BASE_SYSTEM_PROMPT) + `\n\nСейчас в Узбекистане: ${nowTashkent}.`;

    const contents = [
      ...history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
      { role: "user", parts: userParts },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] } }),
    });
    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      await sendTelegramMessage(chatId, "Ошибка от Gemini API: " + JSON.stringify(data).slice(0, 300));
      res.status(200).json({ ok: true }); return;
    }

    const rawReply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "Не смог сформулировать ответ.";
    const { cleanText, imagePrompt, excelData, calendarList, calendarCreate, reminderCreate, reminderStop, taskAdd, taskList, taskDone } = extractMarkers(rawReply);

    if (cleanText) await sendTelegramMessage(chatId, cleanText);

    if (cleanText) {
      const voiceBuffer = await generateVoiceReply(cleanText);
      if (voiceBuffer) await sendTelegramAudio(chatId, voiceBuffer, "audio/mpeg");
    }

    if (imagePrompt) {
      try {
        const img = await generateImage(imagePrompt, refImage?.base64, refImage?.mimeType, GEMINI_API_KEY);
        await sendTelegramPhoto(chatId, img.buffer, img.mimeType);
      } catch (err) { await sendTelegramMessage(chatId, "Не смог сгенерировать изображение: " + err.message); }
    }

    if (excelData) {
      try {
        const buffer = buildExcelBuffer(excelData);
        await sendTelegramDocument(chatId, buffer, (excelData.sheetName || "table") + ".xlsx");
      } catch (err) { await sendTelegramMessage(chatId, "Не смог собрать Excel-файл: " + err.message); }
    }

    if (calendarList || calendarCreate) {
      const accessToken = await getGoogleAccessToken();
      if (!accessToken) {
        await sendTelegramMessage(chatId, "Календарь ещё не подключён — открой ссылку авторизации Google, которую тебе давали, чтобы дать доступ.");
      } else if (calendarList) {
        try {
          const events = await listUpcomingEvents(accessToken);
          const text = events.length
            ? "📅 Ближайшие события:\n" + events.map((e) => `• ${e.title} — ${e.start}`).join("\n")
            : "📅 В календаре пока ничего не запланировано.";
          await sendTelegramMessage(chatId, text);
        } catch (err) { await sendTelegramMessage(chatId, "Не смог получить календарь: " + err.message); }
      } else if (calendarCreate) {
        try {
          await createCalendarEvent(accessToken, calendarCreate);
          await sendTelegramMessage(chatId, `✅ Добавил в календарь: "${calendarCreate.title}"`);
        } catch (err) { await sendTelegramMessage(chatId, "Не смог создать событие: " + err.message); }
      }
    }

    if (taskAdd?.task) {
      try {
        await addTask(chatId, taskAdd.task);
        await sendTelegramMessage(chatId, `✅ Добавил в задачи: "${taskAdd.task}"`);
      } catch (err) { await sendTelegramMessage(chatId, "Не смог сохранить задачу: " + err.message); }
    }

    if (taskList) {
      try {
        const tasks = await listTasks(chatId);
        const text = tasks.length
          ? "📋 Твои задачи:\n" + tasks.map((t, i) => `${i + 1}. ${t.task}`).join("\n")
          : "📋 Список задач пуст.";
        await sendTelegramMessage(chatId, text);
      } catch (err) { await sendTelegramMessage(chatId, "Не смог получить задачи: " + err.message); }
    }

    if (taskDone?.match) {
      try {
        const completed = await completeTask(chatId, taskDone.match);
        await sendTelegramMessage(chatId, completed ? `✅ Отметил выполненной: "${completed}"` : "Не нашёл такую задачу в списке.");
      } catch (err) { await sendTelegramMessage(chatId, "Не смог отметить задачу: " + err.message); }
    }

    if (reminderCreate?.message && reminderCreate?.remind_at) {
      try {
        await saveReminder(chatId, reminderCreate.message, reminderCreate.remind_at, reminderCreate.recurrence, reminderCreate.interval_minutes, reminderCreate.task_match);
      } catch (err) { await sendTelegramMessage(chatId, "Не смог сохранить напоминание: " + err.message); }
    }

    if (reminderStop?.match) {
      try {
        const stopped = await stopReminder(chatId, reminderStop.match);
        await sendTelegramMessage(chatId, stopped ? `🔕 Остановил напоминание: "${stopped}"` : "Не нашёл такое активное напоминание.");
      } catch (err) { await sendTelegramMessage(chatId, "Не смог остановить напоминание: " + err.message); }
    }

    await Promise.all([
      saveHistory(chatId, "user", userTextForHistory),
      saveHistory(chatId, "assistant", cleanText || rawReply),
    ]);
    const newFacts = await extractNewFacts(userTextForHistory, cleanText || rawReply, knownFacts, GEMINI_API_KEY);
    await saveMemoryFacts(newFacts);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(200).json({ ok: true });
  }
}

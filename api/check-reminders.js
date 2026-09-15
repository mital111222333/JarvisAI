// Вызывается внешним планировщиком (cron-job.org) каждую минуту.
// Находит напоминания, время которых наступило, отправляет их в Telegram.
// Разовые — помечает отправленными. Ежедневные — переносит на +24ч.
// "until_done" — переносит на +interval_minutes, пока связанная задача не будет отмечена выполненной.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

async function sendTelegramMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: `⏰ Напоминание: ${text}` }),
  });
}

async function isTaskDone(chatId, matchText) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?chat_id=eq.${chatId}&done=eq.true&task=ilike.*${encodeURIComponent(matchText)}*&select=id&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = res.ok ? await res.json() : [];
  return rows.length > 0;
}

async function updateReminder(id, fields) {
  await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(fields),
  });
}

export default async function handler(req, res) {
  if (CRON_SECRET && req.query?.secret !== CRON_SECRET) {
    res.status(401).json({ error: "Неверный secret" });
    return;
  }

  try {
    const now = new Date();
    const dueRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reminders?sent=eq.false&remind_at=lte.${encodeURIComponent(now.toISOString())}&select=id,chat_id,message,recurrence,interval_minutes,task_match`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const due = await dueRes.json();

    for (const reminder of due || []) {
      const recurrence = reminder.recurrence || "once";

      if (recurrence === "until_done" && reminder.task_match) {
        const done = await isTaskDone(reminder.chat_id, reminder.task_match);
        if (done) {
          await updateReminder(reminder.id, { sent: true });
          continue;
        }
      }

      await sendTelegramMessage(reminder.chat_id, reminder.message);

      if (recurrence === "daily") {
        const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await updateReminder(reminder.id, { remind_at: next.toISOString() });
      } else if (recurrence === "until_done") {
        const minutes = reminder.interval_minutes || 60;
        const next = new Date(now.getTime() + minutes * 60 * 1000);
        await updateReminder(reminder.id, { remind_at: next.toISOString() });
      } else {
        await updateReminder(reminder.id, { sent: true });
      }
    }

    res.status(200).json({ ok: true, processed: (due || []).length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

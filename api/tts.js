// JARVIS TTS — Vercel Serverless Function
// Прячет ELEVENLABS_API_KEY, превращает текст ответа Джарвиса в естественную речь.

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
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // Adam — универсальный голос, хорошо звучит и на русском

    if (!ELEVENLABS_API_KEY) {
      res.status(500).json({ error: "ELEVENLABS_API_KEY не настроен в переменных окружения Vercel." });
      return;
    }

    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Нужно поле text (строка)." });
      return;
    }

    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2", // поддерживает русский и большинство языков
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!elevenRes.ok) {
      const errText = await elevenRes.text();
      console.error("ElevenLabs error:", errText);
      res.status(502).json({ error: "Ошибка от ElevenLabs API", details: errText });
      return;
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(audioBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера." });
  }
}

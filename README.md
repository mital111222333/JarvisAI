# JARVIS Backend (Vercel Serverless)

Бесплатная навсегда версия бэкенда — без "засыпания" сервера, которое бывает на других бесплатных тарифах. Работает как serverless-функция: код "просыпается" мгновенно на каждый запрос.

## 1. Получить ключ Gemini
1. Зайди на https://aistudio.google.com/apikey
2. Войди с Google-аккаунтом → "Create API key"
3. Скопируй ключ

## 2. Залить проект в GitHub
1. Создай новый репозиторий, например `jarvis-backend`
2. Загрузи туда всю эту папку (файл `api/chat.js`, `package.json`, `.gitignore`)

## 3. Деплой на Vercel
1. Зайди на https://vercel.com, войди через GitHub
2. "Add New" → "Project" → выбери репозиторий `jarvis-backend`
3. Framework Preset можно оставить "Other" — Vercel сам увидит папку `api/` и создаст из неё функцию
4. В "Environment Variables" добавь:
   - `GEMINI_API_KEY` = твой ключ
   - `GEMINI_MODEL` = `gemini-2.0-flash` (можно поменять позже)
5. Нажми "Deploy". Через минуту получишь адрес вида `https://jarvis-backend.vercel.app`

Твой рабочий endpoint для фронтенда:
```
https://jarvis-backend.vercel.app/api/chat
```

## 4. Подключить к фронтенду
В файле `jarvis-interface.html` замени `BACKEND_URL`:
```js
const BACKEND_URL = "https://jarvis-backend.vercel.app/api/chat";
```

## Формат запроса/ответа
Фронтенд отправляет:
```json
{
  "messages": [
    { "role": "user", "content": "что на этом фото?", "attachments": [
      { "mimeType": "image/png", "data": "base64-строка-без-префикса" }
    ]}
  ]
}
```
`attachments` — необязательное поле, добавляется только когда пользователь прикрепил файл.

Функция отвечает:
```json
{ "reply": "Привет, Хозяин!" }
```

## Файлы (фото, видео, PDF, документы)
Джарвис умеет анализировать прикреплённые файлы — фронтенд кодирует их в base64 и передаёт в `attachments`, а бэкенд пересылает как `inlineData` в Gemini.
Ограничение: суммарный размер запроса к Gemini через `generateContent` — около 20 МБ в base64. Для больших видео и объёмных PDF в будущем понадобится отдельный шаг через Gemini File API (загрузка файла напрямую в Google, без base64) — это отдельная доработка, когда понадобится.

## Лимиты бесплатного тарифа Vercel (Hobby)
Более чем достаточно для личного ассистента: щедрая дневная квота на вызовы функций, до 10 секунд на выполнение одного запроса (ответ от Gemini укладывается с большим запасом).

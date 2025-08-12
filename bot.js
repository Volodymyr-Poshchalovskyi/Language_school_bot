/**
 * @file bot.js
 * @description Адмін-бот для мовної школи. Обробляє заявки з бази даних Supabase.
 */

// --- ЗАЛЕЖНОСТІ ТА НАЛАШТУВАННЯ ---
require('dotenv').config(); // Завантажує змінні з .env файлу
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Витягуємо змінні середовища для чистоти коду
const {
  TELEGRAM_BOT_TOKEN: token,
  SECRET_PASSWORD: secretPassword,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: supabaseKey,
  ADMIN_CHAT_ID: adminChatId,
  RENDER_EXTERNAL_URL: botUrl 
} = process.env;

// Критична перевірка, чи всі змінні наявні
if (!token || !secretPassword || !supabaseUrl || !supabaseKey || !adminChatId) {
  console.error('ПОМИЛКА: Відсутня одна або кілька змінних середовища. Перевірте налаштування на Render.');
  process.exit(1);
}

// --- ІНІЦІАЛІЗАЦІЯ ---
const bot = new TelegramBot(token); // Ініціалізуємо бота БЕЗ polling
const app = express();
app.use(express.json()); // Дозволяємо серверу обробляти JSON

const PORT = process.env.PORT || 3000;

// Встановлюємо вебхук, щоб Telegram надсилав оновлення на наш сервер
const webhookPath = `/webhook/${token}`;
const fullWebhookUrl = `${botUrl}${webhookPath}`;
bot.setWebHook(fullWebhookUrl);

// --- КЕРУВАННЯ СТАНОМ (в пам'яті) ---
const authorizedUsers = new Set([parseInt(adminChatId, 10)]); // Адмін авторизований за замовчуванням
const chatMessages = new Map(); // Зберігаємо ID повідомлень для очищення чату

// --- КЛАВІАТУРА TELEGRAM ---
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: 'Показати все' }],
      [{ text: 'Показати заявки на урок' }, { text: 'Показати запити на дзвінок' }],
    ],
    resize_keyboard: true,
  },
};

// --- ДОПОМІЖНІ ФУНКЦІЇ ---

/**
 * Перевіряє, чи авторизований користувач.
 * @param {number} chatId ID чату для перевірки.
 * @returns {boolean}
 */
const isAuthorized = (chatId) => authorizedUsers.has(chatId);

/**
 * Видаляє попередні повідомлення, надіслані ботом.
 * @param {number} chatId ID чату, який потрібно очистити.
 */
async function clearPreviousMessages(chatId) {
  const messageIds = chatMessages.get(chatId);
  if (messageIds && messageIds.length > 0) {
    await Promise.all(
      messageIds.map(id => bot.deleteMessage(chatId, id).catch(() => {}))
    );
  }
  chatMessages.set(chatId, []);
}

/**
 * Надсилає повідомлення і зберігає його ID для подальшого видалення.
 * @param {number} chatId ID чату.
 * @param {string} text Текст повідомлення.
 * @param {object} options Опції для повідомлення.
 */
async function sendAndTrackMessage(chatId, text, options) {
  try {
    const sentMsg = await bot.sendMessage(chatId, text, options);
    const currentMessages = chatMessages.get(chatId) || [];
    chatMessages.set(chatId, [...currentMessages, sentMsg.message_id]);
  } catch (error) {
    console.error('Помилка надсилання повідомлення:', error.message);
  }
}

// --- ФУНКЦІЇ ОТРИМАННЯ ДАНИХ ---

/**
 * Отримує та показує заявки на уроки.
 * @param {number} chatId
 */
async function showApplications(chatId) {
  try {
    const { data: applications } = await axios.get(`${supabaseUrl}/rest/v1/Applications?select=*&order=id.asc`, { headers: { apikey: supabaseKey } });
    if (!applications || applications.length === 0) {
      return sendAndTrackMessage(chatId, '📂 Заявок на урок поки що немає.', mainKeyboard);
    }
    let message = '📋 <b>Всі заявки на урок:</b>\n\n' + '<pre>' + 'ID  | Ім\'я та Прізвище    | Контакти\n' + '----|----------------------|--------------------------\n';
    applications.forEach(app => {
      const id = app.id.toString().padEnd(4);
      const name = `${app.firstName} ${app.lastName}`.slice(0, 20).padEnd(22);
      const contact = (app.email || app.phone || 'не вказано').slice(0, 26);
      message += `${id}| ${name}| ${contact}\n`;
    });
    message += '</pre>';
    const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: applications.map(app => ([{ text: `📋 Копіювати заявку №${app.id}`, callback_data: `copy_app_${app.id}` }])) } };
    sendAndTrackMessage(chatId, message, options);
  } catch (error) {
    console.error('Помилка отримання заявок на урок:', error.response?.data || error.message);
    sendAndTrackMessage(chatId, '❌ Не вдалося отримати заявки на урок.', mainKeyboard);
  }
}

/**
 * Отримує та показує запити на дзвінок.
 * @param {number} chatId
 */
async function showCallbacks(chatId) {
  try {
    const { data: callbacks } = await axios.get(`${supabaseUrl}/rest/v1/CallBacks?select=*&order=id.asc`, { headers: { apikey: supabaseKey } });
    if (!callbacks || callbacks.length === 0) {
      return sendAndTrackMessage(chatId, '📂 Запитів на дзвінок поки що немає.', mainKeyboard);
    }
    let message = '📞 <b>Всі запити на дзвінок:</b>\n\n' + '<pre>' + 'ID  | Номер телефону\n' + '----|------------------\n';
    callbacks.forEach(cb => { message += `${cb.id.toString().padEnd(4)}| ${cb.phone}\n`; });
    message += '</pre>';
    const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: callbacks.map(cb => ([{ text: `📞 Копіювати дзвінок №${cb.id}`, callback_data: `copy_cb_${cb.id}` }])) } };
    sendAndTrackMessage(chatId, message, options);
  } catch (error) {
    console.error('Помилка отримання запитів на дзвінок:', error.response?.data || error.message);
    sendAndTrackMessage(chatId, '❌ Не вдалося отримати запити на дзвінок.', mainKeyboard);
  }
}

// --- ОБРОБНИКИ ПОДІЙ БОТА ---

// Обробка команди /start для авторизації
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  await clearPreviousMessages(chatId);
  const password = match[1].trim();
  if (!password) {
    return sendAndTrackMessage(chatId, 'Вітаю! Для доступу введіть команду з паролем:\n`/start ваш_пароль`', { parse_mode: 'Markdown'});
  }
  if (password === secretPassword) {
    authorizedUsers.add(chatId);
    sendAndTrackMessage(chatId, '✅ <b>Авторизація успішна!</b>\n\nОберіть дію:', { parse_mode: 'HTML', ...mainKeyboard });
  } else {
    sendAndTrackMessage(chatId, '❌ Неправильний пароль.');
  }
});

// ! --- ВИПРАВЛЕНО: Повернено обробник для кнопок та інших повідомлень ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Ігноруємо команду /start, бо вона обробляється окремо
  if (msg.text && msg.text.startsWith('/start')) return;

  // Перевіряємо, чи авторизований користувач
  if (!isAuthorized(chatId)) {
    await clearPreviousMessages(chatId);
    return sendAndTrackMessage(chatId, 'Будь ласка, авторизуйтесь. Введіть `/start [пароль]`', { parse_mode: 'Markdown' });
  }
  
  // Очищуємо попередні повідомлення бота
  await clearPreviousMessages(chatId);

  // Обробляємо натискання на кнопки
  switch (msg.text) {
    case 'Показати все':
      await showApplications(chatId);
      await sendAndTrackMessage(chatId, '---', mainKeyboard);
      await showCallbacks(chatId);
      break;
    case 'Показати заявки на урок':
      await showApplications(chatId);
      break;
    case 'Показати запити на дзвінок':
      await showCallbacks(chatId);
      break;
    default:
      sendAndTrackMessage(chatId, 'Будь ласка, використовуйте кнопки.', mainKeyboard);
  }
});


// Обробка натискань на вбудовані кнопки "Копіювати"
bot.on('callback_query', async (callbackQuery) => {
  const { data, message } = callbackQuery;
  const chatId = message.chat.id;
  bot.answerCallbackQuery(callbackQuery.id); // Завершуємо анімацію завантаження на кнопці

  if (!isAuthorized(chatId)) { return bot.sendMessage(chatId, '❌ Помилка: ви не авторизовані.'); }

  const [action, type, id] = data.split('_');
  if (action === 'copy') {
    let responseText = `Дані для копіювання:\n\n`;
    try {
      if (type === 'app') {
        const { data: applications } = await axios.get(`${supabaseUrl}/rest/v1/Applications?id=eq.${id}&select=*`, { headers: { apikey: supabaseKey } });
        const app = applications[0];
        if (app) { responseText += `Ім'я: ${app.firstName} ${app.lastName}\nEmail: ${app.email || 'не вказано'}\nТелефон: ${app.phone || 'не вказано'}\nФормат: ${app.lessonFormat}`; }
      } else if (type === 'cb') {
        const { data: callbacks } = await axios.get(`${supabaseUrl}/rest/v1/CallBacks?id=eq.${id}&select=*`, { headers: { apikey: supabaseKey } });
        const cb = callbacks[0];
        if (cb) { responseText += `Телефон: ${cb.phone}`; }
      }
      sendAndTrackMessage(chatId, `<code>${responseText}</code>`, { parse_mode: 'HTML', ...mainKeyboard });
    } catch (error) {
      sendAndTrackMessage(chatId, '❌ Не вдалося знайти запис.', mainKeyboard);
    }
  }
});


// --- НАЛАШТУВАННЯ СЕРВЕРА ДЛЯ ВЕБХУКІВ ---

// Маршрут, на який Telegram надсилає оновлення
app.post(webhookPath, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Маршрут для перевірки стану від Render
app.get('/', (req, res) => { res.status(200).send('Bot server is running and healthy.'); });

// Маршрути для прийому сповіщень від Supabase
app.post('/notify/application', (req, res) => {
  try {
    const { record: app } = req.body;
    if (!app) { return res.status(400).send('Bad Request'); }
    const message = `🎉 <b>Нова заявка на урок!</b>\n\n` + `<b>Ім'я:</b> ${app.firstName} ${app.lastName}\n` + `<b>Контакти:</b> <code>${app.email || app.phone || 'не вказано'}</code>\n` + `<b>Формат:</b> ${app.lessonFormat}`;
    bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    res.status(200).send('OK');
  } catch (error) {
    console.error('Помилка обробки сповіщення (application):', error);
    res.status(500).send('Server Error');
  }
});

app.post('/notify/callback', (req, res) => {
  try {
    const { record: cb } = req.body;
    if (!cb) { return res.status(400).send('Bad Request'); }
    const message = `🔔 <b>Замовлено зворотний дзвінок!</b>\n\n` + `<b>Телефон:</b> <code>${cb.phone}</code>`;
    bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    res.status(200).send('OK');
  } catch (error) {
    console.error('Помилка обробки сповіщення (callback):', error);
    res.status(500).send('Server Error');
  }
});

// --- ЗАПУСК СЕРВЕРА ---
app.listen(PORT, () => {
  console.log(`Сервер для вебхуків запущений на порту ${PORT}`);
  console.log(`Бот очікує оновлення за адресою: ${fullWebhookUrl}`);
});
/**
 * @file bot.js
 * @description Admin Telegram bot for a language school. Handles viewing applications from a Supabase DB.
 */

// --- DEPENDENCIES & CONFIG ---
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Deconstruct environment variables for clarity and immediate validation.
const {
  TELEGRAM_BOT_TOKEN: token,
  SECRET_PASSWORD: secretPassword,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: supabaseKey,
  ADMIN_CHAT_ID: adminChatId,
  RENDER_EXTERNAL_URL: botUrl // ! NEW: Render provides this automatically
} = process.env;

// ! Critical check to ensure the bot can run.
if (!token || !secretPassword || !supabaseUrl || !supabaseKey || !adminChatId) {
  console.error('FATAL ERROR: Missing one or more required environment variables. Check your .env file.');
  process.exit(1);
}

// --- INITIALIZATION ---
// ! CHANGED: We remove `polling: true` because we will use webhooks.
const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ! NEW: We set the webhook to our server's public URL.
const webhookPath = `/webhook/${token}`;
const fullWebhookUrl = `${botUrl}${webhookPath}`;
bot.setWebHook(fullWebhookUrl);

// --- STATE MANAGEMENT (In-Memory) ---
const authorizedUsers = new Set([parseInt(adminChatId, 10)]); // Admin is authorized by default
const chatMessages = new Map();

// --- TELEGRAM KEYBOARD LAYOUT ---
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: 'Показати все' }],
      [{ text: 'Показати заявки на урок' }, { text: 'Показати запити на дзвінок' }],
    ],
    resize_keyboard: true,
  },
};

// --- HELPER FUNCTIONS ---
// ... (всі ваші допоміжні функції, такі як isAuthorized, clearPreviousMessages, sendAndTrackMessage, залишаються без змін)
const isAuthorized = (chatId) => authorizedUsers.has(chatId);

async function clearPreviousMessages(chatId) {
  const messageIds = chatMessages.get(chatId);
  if (messageIds && messageIds.length > 0) {
    await Promise.all(
      messageIds.map(id => bot.deleteMessage(chatId, id).catch(() => {}))
    );
  }
  chatMessages.set(chatId, []);
}

async function sendAndTrackMessage(chatId, text, options) {
  try {
    const sentMsg = await bot.sendMessage(chatId, text, options);
    const currentMessages = chatMessages.get(chatId) || [];
    chatMessages.set(chatId, [...currentMessages, sentMsg.message_id]);
  } catch (error) {
    console.error('Failed to send or track message:', error.message);
  }
}

// --- DATA FETCHING & FORMATTING ---
// ... (функції showApplications та showCallbacks залишаються без змін)
async function showApplications(chatId) {
  try {
    const { data: applications } = await supabase.get('/rest/v1/Applications?select=*&order=id.asc');
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
    console.error('Error fetching applications:', error.response?.data || error.message);
    sendAndTrackMessage(chatId, '❌ Не вдалося отримати заявки на урок.', mainKeyboard);
  }
}

async function showCallbacks(chatId) {
  try {
    const { data: callbacks } = await supabase.get('/rest/v1/CallBacks?select=*&order=id.asc');
    if (!callbacks || callbacks.length === 0) {
      return sendAndTrackMessage(chatId, '📂 Запитів на дзвінок поки що немає.', mainKeyboard);
    }
    let message = '📞 <b>Всі запити на дзвінок:</b>\n\n' + '<pre>' + 'ID  | Номер телефону\n' + '----|------------------\n';
    callbacks.forEach(cb => { message += `${cb.id.toString().padEnd(4)}| ${cb.phone}\n`; });
    message += '</pre>';
    const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: callbacks.map(cb => ([{ text: `📞 Копіювати дзвінок №${cb.id}`, callback_data: `copy_cb_${cb.id}` }])) } };
    sendAndTrackMessage(chatId, message, options);
  } catch (error) {
    console.error('Error fetching callbacks:', error.response?.data || error.message);
    sendAndTrackMessage(chatId, '❌ Не вдалося отримати запити на дзвінок.', mainKeyboard);
  }
}

// --- BOT EVENT HANDLERS ---
// ... (bot.onText та bot.on('callback_query') залишаються без змін)
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

bot.on('callback_query', async (callbackQuery) => {
  const { data, message } = callbackQuery;
  const chatId = message.chat.id;
  bot.answerCallbackQuery(callbackQuery.id);
  if (!isAuthorized(chatId)) { return bot.sendMessage(chatId, '❌ Помилка: ви не авторизовані.'); }
  const [action, type, id] = data.split('_');
  if (action === 'copy') {
    let responseText = `Дані для копіювання:\n\n`;
    try {
      if (type === 'app') {
        const { data: applications } = await supabase.get(`/rest/v1/Applications?id=eq.${id}&select=*`);
        const app = applications[0];
        if (app) {
          responseText += `Ім'я: ${app.firstName} ${app.lastName}\nEmail: ${app.email || 'не вказано'}\nТелефон: ${app.phone || 'не вказано'}\nФормат: ${app.lessonFormat}`;
        }
      } else if (type === 'cb') {
        const { data: callbacks } = await supabase.get(`/rest/v1/CallBacks?id=eq.${id}&select=*`);
        const cb = callbacks[0];
        if (cb) {
          responseText += `Телефон: ${cb.phone}`;
        }
      }
      sendAndTrackMessage(chatId, `<code>${responseText}</code>`, { parse_mode: 'HTML', ...mainKeyboard });
    } catch (error) {
      sendAndTrackMessage(chatId, '❌ Не вдалося знайти запис.', mainKeyboard);
    }
  }
});

// ! NEW: We now process bot updates via this webhook endpoint.
app.post(webhookPath, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// --- WEBHOOK ROUTES FOR NOTIFICATIONS (залишаються без змін) ---
app.get('/', (req, res) => { res.status(200).send('Bot server is running and healthy.'); });
app.post('/notify/application', (req, res) => {
  try {
    const { record: app } = req.body;
    if (!app) { return res.status(400).send('Bad Request: Missing record data.'); }
    const message = `🎉 <b>Нова заявка на урок!</b>\n\n` + `<b>Ім'я:</b> ${app.firstName} ${app.lastName}\n` + `<b>Контакти:</b> <code>${app.email || app.phone || 'не вказано'}</code>\n` + `<b>Формат:</b> ${app.lessonFormat}`;
    bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    res.status(200).send('Notification received.');
  } catch (error) {
    console.error('Error processing application notification:', error);
    res.status(500).send('Internal Server Error');
  }
});
app.post('/notify/callback', (req, res) => {
  try {
    const { record: cb } = req.body;
    if (!cb) { return res.status(400).send('Bad Request: Missing record data.'); }
    const message = `🔔 <b>Замовлено зворотний дзвінок!</b>\n\n` + `<b>Телефон:</b> <code>${cb.phone}</code>`;
    bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    res.status(200).send('Notification received.');
  } catch (error) {
    console.error('Error processing callback notification:', error);
    res.status(500).send('Internal Server Error');
  }
});


// --- BOT STARTUP ---
app.listen(PORT, () => {
  console.log(`Webhook server is running on port ${PORT}`);
  console.log(`Bot is listening for updates at: ${fullWebhookUrl}`);
});
/**
 * @file bot.js
 * @description Admin Telegram bot for a language school. Handles viewing applications from a Supabase DB.
 */

// --- DEPENDENCIES & CONFIG ---
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Deconstruct environment variables for clarity and immediate validation.
const {
  TELEGRAM_BOT_TOKEN: token,
  SECRET_PASSWORD: secretPassword,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: supabaseKey,
} = process.env;

// ! Critical check to ensure the bot can run.
if (!token || !secretPassword || !supabaseUrl || !supabaseKey) {
  console.error('FATAL ERROR: Missing one or more required environment variables. Check your .env file.');
  process.exit(1);
}

// --- INITIALIZATION ---
const bot = new TelegramBot(token, { polling: true });

const supabase = axios.create({
  baseURL: supabaseUrl,
  headers: {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  },
});

// --- STATE MANAGEMENT (In-Memory) ---
const authorizedUsers = new Set();
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
const isAuthorized = (chatId) => authorizedUsers.has(chatId);

async function clearPreviousMessages(chatId) {
  const messageIds = chatMessages.get(chatId);
  if (messageIds && messageIds.length > 0) {
    await Promise.all(
      messageIds.map(id => bot.deleteMessage(chatId, id).catch(() => {})) // Suppress errors
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
async function showApplications(chatId) {
  try {
    const { data: applications } = await supabase.get('/rest/v1/Applications?select=*&order=id.asc');

    if (!applications || applications.length === 0) {
      return sendAndTrackMessage(chatId, '📂 Заявок на урок поки що немає.', mainKeyboard);
    }

    let message = '📋 <b>Всі заявки на урок:</b>\n\n';
    message += '<pre>';
    message += 'ID  | Ім\'я та Прізвище    | Контакти\n';
    message += '----|----------------------|--------------------------\n';
    applications.forEach(app => {
      const id = app.id.toString().padEnd(4);
      const name = `${app.firstName} ${app.lastName}`.slice(0, 20).padEnd(22);
      const contact = (app.email || app.phone || 'не вказано').slice(0, 26);
      message += `${id}| ${name}| ${contact}\n`;
    });
    message += '</pre>';
    
    const options = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: applications.map(app => ([
          { text: `📋 Копіювати заявку №${app.id}`, callback_data: `copy_app_${app.id}` }
        ]))
      }
    };

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

    let message = '📞 <b>Всі запити на дзвінок:</b>\n\n';
    message += '<pre>';
    message += 'ID  | Номер телефону\n';
    message += '----|------------------\n';
    callbacks.forEach(cb => {
      message += `${cb.id.toString().padEnd(4)}| ${cb.phone}\n`;
    });
    message += '</pre>';
    
    const options = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: callbacks.map(cb => ([
          { text: `📞 Копіювати дзвінок №${cb.id}`, callback_data: `copy_cb_${cb.id}` }
        ]))
      }
    };

    sendAndTrackMessage(chatId, message, options);
  } catch (error) {
    console.error('Error fetching callbacks:', error.response?.data || error.message);
    sendAndTrackMessage(chatId, '❌ Не вдалося отримати запити на дзвінок.', mainKeyboard);
  }
}

// --- BOT EVENT HANDLERS ---
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

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (msg.text && msg.text.startsWith('/start')) return;
  if (!isAuthorized(chatId)) {
    await clearPreviousMessages(chatId);
    return sendAndTrackMessage(chatId, 'Будь ласка, авторизуйтесь. Введіть `/start [пароль]`', { parse_mode: 'Markdown' });
  }
  
  await clearPreviousMessages(chatId);

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

bot.on('callback_query', async (callbackQuery) => {
  const { data, message } = callbackQuery;
  const chatId = message.chat.id;

  bot.answerCallbackQuery(callbackQuery.id);

  if (!isAuthorized(chatId)) {
    
    return bot.sendMessage(chatId, '❌ Помилка: ви не авторизовані.');
  }

  const [action, type, id] = data.split('_');

  if (action === 'copy') {
    let responseText = `Дані для копіювання:\n\n`;
    try {
      if (type === 'app') {
        const { data: applications } = await supabase.get(`/rest/v1/Applications?id=eq.${id}&select=*`);
        const app = applications[0];
        if (app) {
          responseText += `Ім'я: ${app.firstName} ${app.lastName}\n`;
          responseText += `Email: ${app.email || 'не вказано'}\n`;
          responseText += `Телефон: ${app.phone || 'не вказано'}\n`;
          responseText += `Формат: ${app.lessonFormat}`;
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

// --- BOT STARTUP ---
console.log('Bot is running and polling for messages...');
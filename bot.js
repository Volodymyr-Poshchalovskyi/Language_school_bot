// bot.js

// 1. ІМПОРТ БІБЛІОТЕК І НАЛАШТУВАННЯ
// ----------------------------------------------------
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// --- Забираємо наші секрети з .env ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;
const secretPassword = process.env.SECRET_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// --- Ініціалізуємо бота та сервер ---
const bot = new TelegramBot(token, { polling: true });
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- Список авторизованих користувачів ---
const authorizedUsers = new Set();
if (adminChatId) {
  authorizedUsers.add(parseInt(adminChatId, 10));
}

// 2. ЛОГІКА ДЛЯ КОМАНД БОТА (залишається без змін)
// ... (весь ваш код з командами /start, /show_all і т.д. залишається тут)
// --- Функція перевірки авторизації ---
const isAuthorized = (chatId) => authorizedUsers.has(chatId);

// --- Обробка команди /start для авторизації ---
bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const password = match[1];

  if (password === secretPassword) {
    authorizedUsers.add(chatId);
    bot.sendMessage(chatId, '✅ Авторизація успішна! Ви можете використовувати команди.');
  } else {
    bot.sendMessage(chatId, '❌ Неправильний пароль.');
  }
});

// --- Обробка команди /show_all для показу всіх заявок ---
bot.onText(/\/show_all/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) {
    return bot.sendMessage(chatId, '❌ Доступ заборонено. Будь ласка, авторизуйтесь: `/start [пароль]`', { parse_mode: 'Markdown' });
  }

  try {
    // --- Запит до таблиці Applications ---
    const appResponse = await fetch(`${supabaseUrl}/rest/v1/Applications?select=*`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const applications = await appResponse.json();

    let appMessage = '📋 **Заявки на урок:**\n';
    if (applications.length > 0) {
      applications.forEach(app => {
        appMessage += `------------------------\nІм'я: ${app.firstName} ${app.lastName}\nКонтакти: ${app.email || app.phone}\n`;
      });
    } else {
      appMessage += 'Поки що немає.\n';
    }
    await bot.sendMessage(chatId, appMessage, { parse_mode: 'Markdown' });

    // --- Запит до таблиці CallBacks ---
    const cbResponse = await fetch(`${supabaseUrl}/rest/v1/CallBacks?select=*`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const callbacks = await cbResponse.json();
    
    let cbMessage = '📞 **Запити на дзвінок:**\n';
    if (callbacks.length > 0) {
      callbacks.forEach(cb => {
        cbMessage += `------------------------\nНомер: \`${cb.phone}\`\n`;
      });
    } else {
      cbMessage += 'Поки що немає.\n';
    }
    await bot.sendMessage(chatId, cbMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Помилка отримання даних з Supabase:', error);
    bot.sendMessage(chatId, '❌ Сталася помилка при отриманні даних.');
  }
});

// 3. ЛОГІКА ДЛЯ ПРИЙОМУ СПОВІЩЕНЬ ВІД САЙТУ
// ----------------------------------------------------

// ! --- НОВИЙ БЛОК: Маршрут для перевірки стану (Health Check) ---
// Цей маршрут потрібен, щоб Render бачив, що наш сервіс "живий"
app.get('/', (req, res) => {
  res.status(200).send('Bot server is running and healthy.');
});

// Створюємо маршрут, на який Supabase буде надсилати дані
app.post('/new-application-notify', (req, res) => {
  const application = req.body.record;
  const message = `🎉 Нова заявка на урок!\n\nІм'я: ${application.firstName} ${application.lastName}\nEmail: ${application.email}\nТелефон: ${application.phone}\nФормат: ${application.lessonFormat}`;
  
  authorizedUsers.forEach(chatId => {
    bot.sendMessage(chatId, message);
  });
  
  res.status(200).send('OK');
});

app.post('/new-callback-notify', (req, res) => {
  const callback = req.body.record;
  const message = `🔔 Замовлено зворотний дзвінок!\n\nТелефон: ${callback.phone}`;
  
  authorizedUsers.forEach(chatId => {
    bot.sendMessage(chatId, message);
  });

  res.status(200).send('OK');
});

// --- Запускаємо сервер ---
app.listen(PORT, () => {
  console.log(`Webhook server is running on port ${PORT}`);
});

console.log('Бот запущений і готовий приймати команди...');
// Receives updates from Telegram (set up automatically at startup).
const express = require('express');
const { pool, getSettings } = require('./srv-db');
const { WEBHOOK_SECRET, PUBLIC_URL } = require('./srv-config');
const svc = require('./srv-services');
const tgApi = require('./srv-telegram');
const { wrap } = require('./srv-errors');

const router = express.Router();

async function handleUpdate(u) {
  // Someone blocked or unblocked the bot
  if (u.my_chat_member && u.my_chat_member.chat && u.my_chat_member.chat.type === 'private') {
    const status = u.my_chat_member.new_chat_member && u.my_chat_member.new_chat_member.status;
    if (status === 'kicked') await pool.query('UPDATE users SET bot_blocked = TRUE WHERE id = $1', [u.my_chat_member.chat.id]);
    if (status === 'member') await pool.query('UPDATE users SET bot_blocked = FALSE WHERE id = $1', [u.my_chat_member.chat.id]);
    return;
  }

  const m = u.message;
  if (!m || !m.from || m.from.is_bot || !m.chat || m.chat.type !== 'private') return;

  // /start ref_12345  -> referral link
  const match = /^\/start(?:@\w+)?\s+ref_(\d{1,15})/.exec(m.text || '');
  await svc.registerUser(m.from, match ? Number(match[1]) : null);
  await pool.query('UPDATE users SET bot_blocked = FALSE WHERE id = $1 AND bot_blocked', [m.from.id]);

  const s = await getSettings();
  const extra = PUBLIC_URL
    ? { reply_markup: { inline_keyboard: [[{ text: 'Open Buzz Wallet', web_app: { url: PUBLIC_URL } }]] } }
    : {};
  await tgApi.sendMessage(m.chat.id, s.welcome_text, extra);
}

router.post('/webhook', express.json({ limit: '1mb' }), wrap(async (req, res) => {
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) return res.sendStatus(403);
  res.sendStatus(200); // answer Telegram immediately
  handleUpdate(req.body || {}).catch((e) => console.error('Webhook error:', e.message));
}));

module.exports = router;

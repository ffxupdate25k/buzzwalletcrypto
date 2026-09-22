// Thin wrapper over the Telegram Bot API (no extra dependencies).
const { BOT_TOKEN } = require('./srv-config');

async function call(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, description: 'Bad response from Telegram' }; }
  if (!data.ok) {
    const err = new Error(data.description || 'Telegram error');
    err.code = data.error_code;
    err.retryAfter = data.parameters && data.parameters.retry_after;
    throw err;
  }
  return data.result;
}

// Accepts @name, t.me/name, https://t.me/name or a numeric chat ID. Returns null if unusable.
function normalizeChat(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '').replace(/[/?#].*$/, '');
  if (/^\+|^joinchat/i.test(s)) return null; // private invite links can't be used
  if (/^-?\d+$/.test(s)) return Number(s);
  s = s.replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s) ? '@' + s : null;
}

const chatArg = (v) => normalizeChat(v) ?? v;

module.exports = {
  call,
  normalizeChat,
  getMe: () => call('getMe'),
  getChat: (chat) => call('getChat', { chat_id: chatArg(chat) }),
  sendMessage: (chat_id, text, extra = {}) =>
    call('sendMessage', { chat_id, text, disable_web_page_preview: true, ...extra }),
  getChatMember: (chat, user_id) => call('getChatMember', { chat_id: chatArg(chat), user_id }),
  setWebhook: (url, secret) =>
    call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'my_chat_member'],
      drop_pending_updates: false
    }),
  setChatMenuButton: (text, url) =>
    call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } })
};

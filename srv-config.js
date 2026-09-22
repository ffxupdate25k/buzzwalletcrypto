const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const ADMIN_IDS = (process.env.ADMIN_IDS || '7995243814')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

// Derived automatically so you never have to set one.
const WEBHOOK_SECRET = BOT_TOKEN
  ? crypto.createHash('sha256').update('webhook:' + BOT_TOKEN).digest('hex').slice(0, 48)
  : '';

module.exports = {
  BOT_TOKEN,
  PUBLIC_URL,
  ADMIN_IDS,
  WEBHOOK_SECRET,
  PORT: Number(process.env.PORT) || 3000,
  state: { bot: { id: null, username: null } } // filled from getMe() at startup
};

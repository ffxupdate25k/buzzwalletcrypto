// Verifies Telegram Mini App initData (HMAC-SHA256 with the bot token).
const crypto = require('crypto');

function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== calc.length || !crypto.timingSafeEqual(calc, given)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    return { user: JSON.parse(params.get('user')), start_param: params.get('start_param') || '' };
  } catch (e) {
    return null;
  }
}

module.exports = { verifyInitData };

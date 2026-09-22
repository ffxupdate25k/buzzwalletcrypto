const express = require('express');
const { pool, getSettings, saveSettings } = require('./srv-db');
const { requireAuth, requireAdmin } = require('./srv-auth');
const svc = require('./srv-services');
const tgApi = require('./srv-telegram');
const { state } = require('./srv-config');
const { HttpError, wrap } = require('./srv-errors');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const round4 = (n) => Math.round(n * 10000) / 10000;

// ---------- Overview ----------
router.get('/overview', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '24 hours') AS new_today,
      (SELECT COUNT(*) FROM users WHERE last_seen > now() - interval '24 hours') AS active_today,
      (SELECT COALESCE(SUM(balance), 0) FROM users) AS total_balance,
      (SELECT COUNT(*) FROM referrals WHERE status = 'completed') AS referrals,
      (SELECT COUNT(*) FROM referrals WHERE status = 'pending') AS pending_referrals,
      (SELECT COUNT(*) FROM channels WHERE active) AS channels,
      (SELECT COUNT(*) FROM tasks WHERE active) AS active_tasks,
      (SELECT COUNT(*) FROM withdrawals WHERE status = 'pending') AS pending_withdrawals,
      (SELECT COUNT(*) FROM withdrawals WHERE status = 'pending' AND payout_state = 'review') AS review_withdrawals,
      (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE status = 'pending') AS pending_amount,
      (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE status = 'paid') AS paid_out
  `);
  res.json(rows[0]);
}));

// ---------- Settings ----------
// The payout API key is never sent back to the browser, only a short hint of it.
function publicSettings(s) {
  const { payout_api_key, ...rest } = s;
  return {
    ...rest,
    has_api_key: !!payout_api_key,
    api_key_hint: payout_api_key ? payout_api_key.slice(0, 4) + '…' + payout_api_key.slice(-4) : ''
  };
}

router.get('/settings', wrap(async (req, res) => res.json(publicSettings(await getSettings()))));

router.put('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const cur = await getSettings();

  const referral_reward = round4(Number(b.referral_reward));
  const min_withdraw = round4(Number(b.min_withdraw));
  const max_withdraw = round4(Number(b.max_withdraw));
  if (![referral_reward, min_withdraw, max_withdraw].every((n) => Number.isFinite(n) && n >= 0 && n <= 10000000)) {
    throw new HttpError(400, 'Enter valid numbers (0 or more).');
  }
  if (max_withdraw > 0 && max_withdraw < min_withdraw) {
    throw new HttpError(400, 'Maximum must be 0 (no limit) or at least the minimum.');
  }
  const welcome_text = String(b.welcome_text || '').trim().slice(0, 1000);
  if (!welcome_text) throw new HttpError(400, 'The welcome message cannot be empty.');

  const auto_payout = b.auto_payout === true || b.auto_payout === 'true';
  const payout_api_url = String(b.payout_api_url || '').trim();
  if (!/^https:\/\/\S+$/i.test(payout_api_url)) throw new HttpError(400, 'The payout API address must start with https://');
  const payout_token_address = String(b.payout_token_address || '').trim();
  if (payout_token_address && !/^0x[a-fA-F0-9]{40}$/.test(payout_token_address)) {
    throw new HttpError(400, 'The token address must be 0x followed by 40 letters/numbers.');
  }
  const newKey = String(b.payout_api_key || '').trim();
  if (newKey && (newKey.length < 8 || newKey.length > 300 || /\s/.test(newKey))) {
    throw new HttpError(400, 'That API key does not look right.');
  }
  if (auto_payout && !(newKey || cur.payout_api_key)) throw new HttpError(400, 'Add the payout API key before turning on auto payout.');
  if (auto_payout && !payout_token_address) throw new HttpError(400, 'Add the token address before turning on auto payout.');

  const toSave = {
    referral_reward, min_withdraw, max_withdraw, welcome_text,
    auto_payout: String(auto_payout), payout_api_url, payout_token_address
  };
  if (newKey) toSave.payout_api_key = newKey; // leaving it empty keeps the saved key
  await saveSettings(toSave);
  res.json(publicSettings(await getSettings()));
}));

// ---------- Tasks ----------
async function validateTask(b) {
  const title = String(b.title || '').trim().slice(0, 120);
  const description = String(b.description || '').trim().slice(0, 500);
  const reward = round4(Number(b.reward));
  const url = String(b.url || '').trim().slice(0, 500);
  const verify_type = b.verify_type === 'auto' ? 'auto' : 'timer';
  const active = b.active !== false;

  if (!title) throw new HttpError(400, 'Enter a task title.');
  if (!Number.isFinite(reward) || reward < 0 || reward > 1000000) throw new HttpError(400, 'Enter a valid reward.');
  if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'The link must start with https://');

  let chat_id = '';
  let timer_seconds = 10;
  if (verify_type === 'auto') {
    const chat = tgApi.normalizeChat(b.chat_id);
    if (chat === null) {
      throw new HttpError(400, 'Enter the channel or group as @username (private chats need their numeric ID).');
    }
    try {
      const me = await tgApi.getChatMember(chat, state.bot.id);
      if (!['administrator', 'creator'].includes(me.status)) {
        throw new HttpError(400, 'Make the bot an admin in that channel or group first.');
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "The bot can't access that channel or group. Add it as an admin, then try again.");
    }
    chat_id = String(chat);
  } else {
    if (!url) throw new HttpError(400, 'Add the link users should open for this task.');
    timer_seconds = Math.round(Number(b.timer_seconds));
    if (!Number.isFinite(timer_seconds) || timer_seconds < 3 || timer_seconds > 86400) {
      throw new HttpError(400, 'Countdown must be between 3 and 86400 seconds.');
    }
  }
  return { title, description, reward, url, verify_type, chat_id, timer_seconds, active };
}

router.get('/tasks', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT t.*, (SELECT COUNT(*) FROM task_submissions s WHERE s.task_id = t.id AND s.status = 'approved') AS completed
      FROM tasks t ORDER BY t.id DESC
  `);
  res.json(rows);
}));

router.post('/tasks', wrap(async (req, res) => {
  const t = await validateTask(req.body || {});
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, reward, url, verify_type, chat_id, timer_seconds, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [t.title, t.description, t.reward, t.url, t.verify_type, t.chat_id, t.timer_seconds, t.active]
  );
  res.json({ id: rows[0].id });
}));

router.put('/tasks/:id', wrap(async (req, res) => {
  const t = await validateTask(req.body || {});
  const r = await pool.query(
    `UPDATE tasks SET title=$1, description=$2, reward=$3, url=$4, verify_type=$5, chat_id=$6, timer_seconds=$7, active=$8 WHERE id=$9`,
    [t.title, t.description, t.reward, t.url, t.verify_type, t.chat_id, t.timer_seconds, t.active, parseInt(req.params.id, 10)]
  );
  if (!r.rowCount) throw new HttpError(404, 'Task not found.');
  res.json({ ok: true });
}));

router.delete('/tasks/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id = $1', [parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

// ---------- Withdrawals ----------
router.get('/withdrawals', wrap(async (req, res) => {
  const status = ['pending', 'paid', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const { rows } = await pool.query(
    `SELECT w.id, w.amount, w.address, w.status, w.payout_state, w.tx_hash, w.note, w.created_at AS date,
            u.id AS user_id, u.first_name, u.last_name, u.username
       FROM withdrawals w JOIN users u ON u.id = w.user_id
      WHERE w.status = $1 ORDER BY w.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 50`,
    [status]
  );
  res.json(rows.map((r) => ({ ...r, name: svc.displayName({ ...r, id: r.user_id }) })));
}));

router.post('/withdrawals/:id/send', wrap(async (req, res) => {
  await svc.sendPayoutNow(parseInt(req.params.id, 10));
  res.json({ ok: true });
}));

router.post('/withdrawals/:id/paid', wrap(async (req, res) => {
  await svc.processWithdrawal(parseInt(req.params.id, 10), 'paid', req.user.id);
  res.json({ ok: true });
}));

router.post('/withdrawals/:id/reject', wrap(async (req, res) => {
  await svc.processWithdrawal(parseInt(req.params.id, 10), 'rejected', req.user.id);
  res.json({ ok: true });
}));

// ---------- Users ----------
const USER_SELECT = `
  SELECT u.id, u.first_name, u.last_name, u.username, u.balance, u.created_at, u.wallet_address,
         (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id AND r.status = 'completed') AS referrals
    FROM users u`;

router.get('/users', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/^@/, '');
  let result;
  if (/^\d{3,}$/.test(q)) {
    result = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [q]);
  } else if (q) {
    result = await pool.query(
      `${USER_SELECT} WHERE u.username ILIKE $1 OR u.first_name ILIKE $1 ORDER BY u.created_at DESC LIMIT 20`,
      ['%' + q + '%']
    );
  } else {
    result = await pool.query(`${USER_SELECT} ORDER BY u.created_at DESC LIMIT 20`);
  }
  res.json(result.rows.map((r) => ({ ...r, name: svc.displayName(r) })));
}));

router.post('/users/:id/balance', wrap(async (req, res) => {
  const amount = round4(Number((req.body || {}).amount));
  const note = String((req.body || {}).note || '').trim().slice(0, 80);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000) {
    throw new HttpError(400, 'Enter an amount greater than 0.');
  }
  const balance = await svc.adjustBalance(req.params.id, amount, note);
  res.json({ balance });
}));

// ---------- Required channels (the join gate) ----------
async function validateChannel(b) {
  const chat = tgApi.normalizeChat(b.chat_id);
  if (chat === null) {
    throw new HttpError(400, 'Enter the channel or group as @username (private ones need their numeric ID).');
  }
  let info;
  try {
    const me = await tgApi.getChatMember(chat, state.bot.id);
    if (!['administrator', 'creator'].includes(me.status)) {
      throw new HttpError(400, 'Make the bot an admin in that channel or group first.');
    }
    info = await tgApi.getChat(chat);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "The bot can't access that channel or group. Add it as an admin, then try again.");
  }
  const title = String(b.title || '').trim().slice(0, 80) || info.title || String(chat);
  let url = String(b.url || '').trim().slice(0, 300);
  if (!url && typeof chat === 'string') url = 'https://t.me/' + chat.slice(1);
  if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'Add the join link (required for private channels). It must start with https://');
  return { title, chat_id: String(chat), url, active: b.active !== false };
}

router.get('/channels', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM channels ORDER BY id');
  const out = await Promise.all(rows.map(async (ch) => {
    let bot_ok = false;
    try {
      const m = await tgApi.getChatMember(ch.chat_id, state.bot.id);
      bot_ok = ['administrator', 'creator'].includes(m.status);
    } catch (e) { /* bot not in the chat */ }
    return { ...ch, bot_ok };
  }));
  res.json(out);
}));

router.post('/channels', wrap(async (req, res) => {
  const c = await validateChannel(req.body || {});
  const { rows } = await pool.query(
    'INSERT INTO channels (title, chat_id, url, active) VALUES ($1, $2, $3, $4) RETURNING id',
    [c.title, c.chat_id, c.url, c.active]
  );
  svc.clearGateCache();
  res.json({ id: rows[0].id });
}));

router.put('/channels/:id', wrap(async (req, res) => {
  const c = await validateChannel(req.body || {});
  const r = await pool.query(
    'UPDATE channels SET title = $1, chat_id = $2, url = $3, active = $4 WHERE id = $5',
    [c.title, c.chat_id, c.url, c.active, parseInt(req.params.id, 10)]
  );
  if (!r.rowCount) throw new HttpError(404, 'Channel not found.');
  svc.clearGateCache();
  res.json({ ok: true });
}));

router.delete('/channels/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM channels WHERE id = $1', [parseInt(req.params.id, 10)]);
  svc.clearGateCache();
  res.json({ ok: true });
}));

// Lets a user save a different wallet (support case).
router.post('/users/:id/wallet/reset', wrap(async (req, res) => {
  const r = await pool.query(
    `UPDATE users SET wallet_address = NULL, wallet_connected_at = NULL WHERE id = $1`,
    [req.params.id]
  );
  if (!r.rowCount) throw new HttpError(404, 'User not found.');
  res.json({ ok: true });
}));

// ---------- Broadcast ----------
router.post('/broadcast', wrap(async (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  if (!text) throw new HttpError(400, 'Write a message first.');
  if (text.length > 3500) throw new HttpError(400, 'Message is too long (max 3500 characters).');
  const { rows } = await pool.query('INSERT INTO broadcasts (text, created_by) VALUES ($1, $2) RETURNING id', [text, req.user.id]);
  svc.runBroadcast(rows[0].id, text); // runs in the background
  res.json({ id: rows[0].id });
}));

router.get('/broadcasts', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, text, total, sent, failed, status, created_at AS date FROM broadcasts ORDER BY id DESC LIMIT 10'
  );
  res.json(rows);
}));

module.exports = router;

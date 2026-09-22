const express = require('express');
const { pool, getSettings } = require('./srv-db');
const { requireAuth, requireGate } = require('./srv-auth');
const svc = require('./srv-services');
const tgApi = require('./srv-telegram');
const { state } = require('./srv-config');
const { HttpError, wrap } = require('./srv-errors');

const router = express.Router();
router.use(requireAuth);

// The Mini App calls this first. It always does a live check, and pays a pending referral
// as soon as the user is in every required channel.
router.get('/gate', wrap(async (req, res) => {
  if (req.isAdmin) return res.json({ passed: true, channels: [] });
  res.json(await svc.checkGate(req.user.id, { force: true }));
}));

// Everything below needs the user to be in all required channels.
router.use(requireGate);

router.get('/me', wrap(async (req, res) => {
  const s = await getSettings();
  const r = await pool.query("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = $1 AND status = 'completed'", [req.user.id]);
  res.json({
    id: req.user.id,
    name: svc.displayName(req.user),
    balance: req.user.balance,
    referrals: r.rows[0].n,
    is_admin: req.isAdmin,
    referral_link: `https://t.me/${state.bot.username}?start=ref_${req.user.id}`,
    wallet_address: req.user.wallet_address || null,
    auto_payout: !!(s.auto_payout && s.payout_api_key && s.payout_token_address),
    referral_reward: s.referral_reward,
    min_withdraw: s.min_withdraw,
    max_withdraw: s.max_withdraw
  });
}));

router.get('/history', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT title, amount, status, type, created_at AS date FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 100',
    [req.user.id]
  );
  res.json(rows);
}));

router.get('/referrals', wrap(async (req, res) => {
  const s = await getSettings();
  const totals = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS count,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COALESCE(SUM(reward) FILTER (WHERE status = 'completed'), 0) AS earned
       FROM referrals WHERE referrer_id = $1`,
    [req.user.id]
  );
  const recent = await pool.query(
    `SELECT u.first_name, u.last_name, u.username, u.id, r.status, r.created_at AS date
       FROM referrals r JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
    [req.user.id]
  );
  res.json({
    count: totals.rows[0].count,
    pending: totals.rows[0].pending,
    earned: totals.rows[0].earned,
    reward: s.referral_reward,
    recent: recent.rows.map((r) => ({ name: svc.displayName(r), status: r.status, date: r.date }))
  });
}));

// Tasks with this user's progress. chat_id is never sent to users. For a timer task the
// user is currently waiting on, remaining_seconds tells the client how much longer to count.
router.get('/tasks', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.description, t.reward, t.url, t.verify_type, t.timer_seconds,
            COALESCE(s.status, 'todo') AS raw_status,
            GREATEST(0, t.timer_seconds - EXTRACT(EPOCH FROM (now() - s.created_at)))::int AS remaining_seconds
       FROM tasks t
       LEFT JOIN LATERAL (
         SELECT status, created_at FROM task_submissions
          WHERE task_id = t.id AND user_id = $1
          ORDER BY (status = 'approved') DESC, (status = 'pending') DESC, id DESC LIMIT 1
       ) s ON true
      WHERE t.active ORDER BY t.id`,
    [req.user.id]
  );
  res.json(rows.map((r) => ({
    id: r.id, title: r.title, description: r.description, reward: r.reward, url: r.url,
    verify_type: r.verify_type, timer_seconds: r.timer_seconds,
    status: r.raw_status === 'approved' ? 'done' : r.raw_status === 'pending' ? 'pending' : 'todo',
    remaining_seconds: r.raw_status === 'pending' ? r.remaining_seconds : null
  })));
}));

async function getTask(idParam, verifyType) {
  const id = parseInt(idParam, 10);
  if (!id) throw new HttpError(404, 'Task not found.');
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1 AND active', [id]);
  if (!rows.length) throw new HttpError(404, 'Task not found.');
  if (rows[0].verify_type !== verifyType) throw new HttpError(400, 'This task is checked a different way. Reload the page.');
  return rows[0];
}

// Timer task, step 1: the user tapped "Start" and (usually) opened the task's link. This
// starts the server-side clock; it's idempotent, so reopening the task never restarts it.
router.post('/tasks/:id/start', wrap(async (req, res) => {
  const task = await getTask(req.params.id, 'timer');
  const startedAt = await svc.startTimerTask(task, req.user.id);
  const remaining = Math.max(0, task.timer_seconds - Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  res.json({ remaining_seconds: remaining });
}));

// Auto-verify: the bot checks that the user is a member of the task's channel/group.
router.post('/tasks/:id/claim', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) throw new HttpError(404, 'Task not found.');
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1 AND active', [id]);
  if (!rows.length) throw new HttpError(404, 'Task not found.');
  const task = rows[0];

  let balance;
  if (task.verify_type === 'auto') {
    let member;
    try {
      member = await tgApi.getChatMember(task.chat_id, req.user.id);
    } catch (e) {
      console.error(`Verification failed for task ${task.id}:`, e.message);
      throw new HttpError(503, "We couldn't check this task right now. Please try again later.");
    }
    const joined =
      ['creator', 'administrator', 'member'].includes(member.status) ||
      (member.status === 'restricted' && member.is_member);
    if (!joined) throw new HttpError(400, "We couldn't find you there yet. Join first, then tap Verify again.");
    balance = await svc.completeAutoTask(task, req.user.id);
  } else {
    balance = await svc.completeTimerTask(task, req.user.id);
  }
  res.json({ reward: task.reward, balance });
}));

// Saves the USDT BEP20 wallet address the user typed. Can only be set once; an admin can
// reset it in Users if the user made a mistake.
router.post('/wallet', wrap(async (req, res) => {
  const address = String((req.body || {}).address || '').trim().toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/.test(address)) {
    throw new HttpError(400, 'That is not a valid USDT BEP20 wallet address.');
  }
  let r;
  try {
    r = await pool.query(
      `UPDATE users SET wallet_address = $1, wallet_connected_at = now()
        WHERE id = $2 AND wallet_address IS NULL RETURNING wallet_address`,
      [address, req.user.id]
    );
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'This wallet address is already linked to another account.');
    throw e;
  }
  if (!r.rowCount) throw new HttpError(409, 'Your wallet is already saved.');
  res.json({ wallet_address: r.rows[0].wallet_address });
}));

router.post('/withdrawals', wrap(async (req, res) => {
  const result = await svc.createWithdrawal(req.user, (req.body || {}).amount);
  res.json({ ok: true, balance: result.balance, auto: result.auto });
}));

module.exports = router;

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
    wc_project_id: s.wc_project_id || '',
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

// Tasks with this user's progress. chat_id is never sent to users.
router.get('/tasks', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.description, t.reward, t.url, t.verify_type,
            COALESCE((
              SELECT CASE s.status WHEN 'approved' THEN 'done' WHEN 'pending' THEN 'pending' ELSE 'rejected' END
                FROM task_submissions s
               WHERE s.task_id = t.id AND s.user_id = $1
               ORDER BY (s.status = 'approved') DESC, (s.status = 'pending') DESC, s.id DESC LIMIT 1
            ), 'todo') AS status
       FROM tasks t WHERE t.active ORDER BY t.id`,
    [req.user.id]
  );
  res.json(rows);
}));

async function getTask(idParam, verifyType) {
  const id = parseInt(idParam, 10);
  if (!id) throw new HttpError(404, 'Task not found.');
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1 AND active', [id]);
  if (!rows.length) throw new HttpError(404, 'Task not found.');
  if (rows[0].verify_type !== verifyType) {
    throw new HttpError(400, verifyType === 'auto' ? 'This task needs a screenshot.' : 'This task is checked automatically.');
  }
  return rows[0];
}

// Auto-verify: the bot checks that the user is a member of the task's channel/group.
router.post('/tasks/:id/claim', wrap(async (req, res) => {
  const task = await getTask(req.params.id, 'auto');
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

  const balance = await svc.completeAutoTask(task, req.user.id);
  res.json({ reward: task.reward, balance });
}));

function parseImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 100 || buf.length > 4 * 1024 * 1024) return null;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!png && !jpg && !webp) return null;
  return { buf, mime: m[1] };
}

// Screenshot tasks: the image is stored and an admin approves or rejects it.
router.post('/tasks/:id/submit', wrap(async (req, res) => {
  const task = await getTask(req.params.id, 'screenshot');
  const img = parseImage(req.body && req.body.image);
  if (!img) throw new HttpError(400, 'Please send a clear PNG or JPG screenshot under 4 MB.');
  try {
    await pool.query(
      `INSERT INTO task_submissions (task_id, user_id, status, image, mime) VALUES ($1, $2, 'pending', $3, $4)`,
      [task.id, req.user.id, img.buf, img.mime]
    );
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'You already sent this task.');
    throw e;
  }
  svc.notifyAdmins(`📸 New screenshot from ${svc.displayName(req.user)} for "${task.title}". Open Admin panel > Proofs.`);
  res.json({ status: 'pending' });
}));

// Saves the BEP20 address the user approved in Trust Wallet. It can only be set once.
router.post('/wallet', wrap(async (req, res) => {
  const address = String((req.body || {}).address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/.test(address)) {
    throw new HttpError(400, 'That is not a valid BEP20 wallet address.');
  }
  let r;
  try {
    r = await pool.query(
      `UPDATE users SET wallet_address = $1, wallet_connected_at = now()
        WHERE id = $2 AND wallet_address IS NULL RETURNING wallet_address`,
      [address.toLowerCase(), req.user.id]
    );
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'This wallet is already linked to another account.');
    throw e;
  }
  if (!r.rowCount) throw new HttpError(409, 'Your wallet is already connected.');
  res.json({ wallet_address: r.rows[0].wallet_address });
}));

router.post('/withdrawals', wrap(async (req, res) => {
  const result = await svc.createWithdrawal(req.user, (req.body || {}).amount);
  res.json({ ok: true, balance: result.balance, auto: result.auto });
}));

module.exports = router;

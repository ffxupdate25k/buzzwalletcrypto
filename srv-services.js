// Business logic. Every money movement happens inside a database transaction.
const { pool, tx, getSettings } = require('./srv-db');
const tgApi = require('./srv-telegram');
const { ADMIN_IDS } = require('./srv-config');
const { HttpError } = require('./srv-errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function money(n) {
  const v = Number(n);
  const two = v.toFixed(2);
  return '$' + (Number(two) === v ? two : v.toFixed(4).replace(/0+$/, ''));
}

function displayName(u) {
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return full || (u.username ? '@' + u.username : 'User ' + u.id);
}

// ---------- Messaging ----------
async function notifyUser(id, text, extra) {
  try {
    await tgApi.sendMessage(id, text, extra);
    return true;
  } catch (e) {
    if (e.code === 403) pool.query('UPDATE users SET bot_blocked = TRUE WHERE id = $1', [id]).catch(() => {});
    console.warn('Could not message', id, '-', e.message);
    return false;
  }
}

function notifyAdmins(text) {
  ADMIN_IDS.forEach((id) => { notifyUser(id, text); });
}

// ---------- Users and referrals ----------
async function registerUser(u, refId) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, first_name, last_name, username, language_code, photo_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       username = EXCLUDED.username,
       language_code = EXCLUDED.language_code,
       photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
       last_seen = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [u.id, u.first_name || null, u.last_name || null, u.username || null, u.language_code || null, u.photo_url || null]
  );
  const user = rows[0];
  // A referral is only saved for brand-new users, and never for yourself.
  if (user.inserted && refId && Number(refId) !== Number(user.id)) {
    await createPendingReferral(user, Number(refId));
  }
  return user;
}

// Saved when a new user sends /start (or opens the app) with a referral link. No money moves yet.
async function createPendingReferral(user, referrerId) {
  let reward = 0;
  try {
    const ok = await tx(async (c) => {
      const ref = await c.query('SELECT id FROM users WHERE id = $1', [referrerId]);
      if (!ref.rowCount) return false;
      reward = (await getSettings(c)).referral_reward;
      await c.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrerId, user.id]);
      await c.query(
        `INSERT INTO referrals (referred_id, referrer_id, reward, status) VALUES ($1, $2, 0, 'pending')`,
        [user.id, referrerId]
      );
      return true;
    });
    if (!ok) return;
  } catch (e) {
    console.error('Could not save referral:', e.message);
    return;
  }
  const earn = reward > 0 ? ` You'll earn ${money(reward)} once they open the app and join the required channels.` : '';
  notifyUser(referrerId, `👋 ${displayName(user)} started the bot with your referral link.${earn}`);
}

// Pays the referrer. Called when the referred user passes the channel gate. Safe to call many times.
async function completeReferral(userId) {
  let done = null;
  try {
    done = await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT referrer_id FROM referrals WHERE referred_id = $1 AND status = 'pending' FOR UPDATE`,
        [userId]
      );
      if (!rows.length) return null;
      const referrerId = rows[0].referrer_id;
      const reward = (await getSettings(c)).referral_reward;
      const u = await c.query('SELECT id, first_name, last_name, username FROM users WHERE id = $1', [userId]);
      const name = displayName(u.rows[0]);
      await c.query(
        `UPDATE referrals SET status = 'completed', reward = $2, completed_at = now() WHERE referred_id = $1`,
        [userId, reward]
      );
      if (reward > 0) {
        await c.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [reward, referrerId]);
        await c.query(
          `INSERT INTO transactions (user_id, amount, type, title) VALUES ($1, $2, 'referral', $3)`,
          [referrerId, reward, 'Referral: ' + name]
        );
      }
      return { referrerId, reward, name };
    });
  } catch (e) {
    console.error('Referral completion failed:', e.message);
    return;
  }
  if (done) {
    const line = done.reward > 0 ? `\nYou earned ${money(done.reward)}.` : '';
    notifyUser(done.referrerId, `🎉 ${done.name} opened the app and joined the required channels!${line}`);
  }
}

// ---------- Required-channel gate ----------
const GATE_TTL_MS = 10 * 60 * 1000; // a passed check is trusted this long before re-checking
const gatePass = new Map(); // userId -> time until which the pass is trusted

const isMember = (m) =>
  ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member === true);

function clearGateCache() { gatePass.clear(); }

async function checkGate(userId, { force = false } = {}) {
  if (!force) {
    const until = gatePass.get(userId);
    if (until && until > Date.now()) return { passed: true, channels: [] };
  }

  const { rows } = await pool.query('SELECT id, title, chat_id, url FROM channels WHERE active ORDER BY id');
  const channels = await Promise.all(rows.map(async (ch) => {
    let joined = false;
    let error = false;
    try {
      joined = isMember(await tgApi.getChatMember(ch.chat_id, userId));
    } catch (e) {
      error = true;
      console.error(`Gate check failed for channel ${ch.id} (${ch.chat_id}):`, e.message);
    }
    return { id: ch.id, title: ch.title, url: ch.url, joined, error };
  }));

  const passed = channels.every((c) => c.joined);
  if (passed) {
    if (gatePass.size > 20000) {
      const now = Date.now();
      for (const [k, v] of gatePass) if (v < now) gatePass.delete(k);
    }
    gatePass.set(userId, Date.now() + GATE_TTL_MS);
    await completeReferral(userId); // the referrer is paid the moment the user gets through
  } else {
    gatePass.delete(userId);
  }
  return { passed, channels };
}

// ---------- Tasks ----------
async function completeAutoTask(task, userId) {
  return tx(async (c) => {
    try {
      await c.query(
        `INSERT INTO task_submissions (task_id, user_id, status, reviewed_at) VALUES ($1, $2, 'approved', now())`,
        [task.id, userId]
      );
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'You already completed this task.');
      throw e;
    }
    const r = await c.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [task.reward, userId]);
    await c.query(
      `INSERT INTO transactions (user_id, amount, type, title) VALUES ($1, $2, 'task', $3)`,
      [userId, task.reward, 'Task: ' + task.title]
    );
    return r.rows[0].balance;
  });
}

// Timer tasks: starting records when the countdown began; completing pays out once
// enough real time has passed on the server (never trusting the client's own clock alone).
async function startTimerTask(task, userId) {
  const existing = await pool.query(
    `SELECT created_at FROM task_submissions WHERE task_id = $1 AND user_id = $2 AND status IN ('pending','approved')`,
    [task.id, userId]
  );
  if (existing.rowCount) return existing.rows[0].created_at; // already started (or done) — resume, don't restart the clock
  try {
    const r = await pool.query(
      `INSERT INTO task_submissions (task_id, user_id, status) VALUES ($1, $2, 'pending') RETURNING created_at`,
      [task.id, userId]
    );
    return r.rows[0].created_at;
  } catch (e) {
    if (e.code === '23505') {
      const again = await pool.query(
        `SELECT created_at FROM task_submissions WHERE task_id = $1 AND user_id = $2 AND status IN ('pending','approved')`,
        [task.id, userId]
      );
      if (again.rowCount) return again.rows[0].created_at;
    }
    throw e;
  }
}

async function completeTimerTask(task, userId) {
  return tx(async (c) => {
    const { rows } = await c.query(
      `SELECT id, created_at FROM task_submissions
        WHERE task_id = $1 AND user_id = $2 AND status = 'pending' FOR UPDATE`,
      [task.id, userId]
    );
    if (!rows.length) throw new HttpError(400, 'Open the task first, then wait for the countdown.');
    const waitedSec = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
    if (waitedSec + 1 < task.timer_seconds) { // 1s grace for clock/network drift
      throw new HttpError(400, `Please wait ${Math.ceil(task.timer_seconds - waitedSec)} more second(s).`);
    }
    await c.query(`UPDATE task_submissions SET status = 'approved', reviewed_at = now() WHERE id = $1`, [rows[0].id]);
    const r = await c.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [task.reward, userId]);
    await c.query(
      `INSERT INTO transactions (user_id, amount, type, title) VALUES ($1, $2, 'task', $3)`,
      [userId, task.reward, 'Task: ' + task.title]
    );
    return r.rows[0].balance;
  });
}

// ---------- Withdrawals and automatic payout ----------
const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');

const autoPayoutReady = (s) =>
  !!(s.auto_payout && s.payout_api_key && s.payout_token_address && s.payout_api_url);

async function createWithdrawal(user, amountIn) {
  const s = await getSettings();
  const address = user.wallet_address;
  if (!address) throw new HttpError(400, 'Connect your wallet first.');
  const amount = Math.round(Number(amountIn) * 10000) / 10000;
  if (!(amount > 0)) throw new HttpError(400, 'Enter a valid amount.');
  if (amount < s.min_withdraw) throw new HttpError(400, `Minimum withdrawal is ${money(s.min_withdraw)}.`);
  if (s.max_withdraw > 0 && amount > s.max_withdraw) throw new HttpError(400, `Maximum withdrawal is ${money(s.max_withdraw)}.`);

  const auto = autoPayoutReady(s);
  const result = await tx(async (c) => {
    const r = await c.query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
      [amount, user.id]
    );
    if (!r.rowCount) throw new HttpError(400, 'Amount is higher than your balance.');
    const t = await c.query(
      `INSERT INTO transactions (user_id, amount, type, title, status)
       VALUES ($1, $2, 'withdrawal', 'Withdrawal', 'pending') RETURNING id`,
      [user.id, -amount]
    );
    const w = await c.query(
      `INSERT INTO withdrawals (user_id, amount, address, transaction_id, payout_state)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user.id, amount, address, t.rows[0].id, auto ? 'sending' : 'manual']
    );
    return { id: w.rows[0].id, balance: r.rows[0].balance };
  });

  // The money is already reserved. The payout itself runs in the background.
  if (auto) {
    runPayout(result.id).catch((e) => console.error('Payout crashed:', e.message));
  } else {
    notifyAdmins(`💸 New withdrawal request: ${money(amount)} from ${displayName(user)} (ID ${user.id}). Open Admin panel > Withdrawals.`);
  }
  return { ...result, auto };
}

// Turns the payout service's reply into one of: success, failed (refund), config (admin must fix), uncertain (admin must check).
// The reply format is not known in advance, so this is deliberately defensive.
function classifyPayout(status, text) {
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  const obj = data && typeof data === 'object' ? data : {};
  const inner = obj.data && typeof obj.data === 'object' ? obj.data : {};
  const msg = obj.error || obj.message || obj.detail || inner.error || inner.message;
  const reason = typeof msg === 'string' ? msg : msg ? JSON.stringify(msg) : '';
  const raw = String(text || '').slice(0, 2000);
  const hash = obj.tx_hash || obj.txHash || obj.transaction_hash || obj.transactionHash || obj.hash ||
               inner.tx_hash || inner.txHash || inner.transaction_hash || inner.hash || null;
  const failedFlag =
    obj.success === false || obj.ok === false || !!obj.error ||
    (typeof obj.status === 'string' && /^(error|fail|failed|rejected|insufficient)/i.test(obj.status));

  if (status >= 500) return { kind: 'uncertain', reason: reason || `Payout service error (${status})`, raw };
  if (status === 401 || status === 403 || /api[ _-]?key|unauthori[sz]ed|forbidden/i.test(reason)) {
    return { kind: 'config', reason: reason || 'The payout service rejected the API key.', raw };
  }
  if (/insufficient|not enough|low balance|balance too low|out of funds|no funds/i.test(reason)) {
    return { kind: 'config', reason, raw };
  }
  if (status >= 400 || failedFlag) return { kind: 'failed', reason: reason || `The payout service refused it (${status}).`, raw };
  return { kind: 'success', txHash: hash ? String(hash) : null, raw };
}

async function callPayoutApi(s, w) {
  let res;
  let text = '';
  try {
    res = await fetch(s.payout_api_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        api_key: s.payout_api_key,
        to_address: w.address,
        token_address: s.payout_token_address,
        amount: Number(w.amount)
      }),
      signal: AbortSignal.timeout(90000)
    });
    text = await res.text();
  } catch (e) {
    // We can't know whether the money moved, so never refund automatically here.
    return { kind: 'uncertain', reason: `No clear answer from the payout service (${e.message}).`, raw: '' };
  }
  return classifyPayout(res.status, text);
}

async function refundWithdrawal(c, row, note, adminId = null) {
  await c.query(
    `UPDATE withdrawals SET status = 'rejected', payout_state = 'done', note = $2, processed_at = now(), processed_by = $3 WHERE id = $1`,
    [row.id, note || null, adminId]
  );
  await c.query(`UPDATE transactions SET status = 'rejected' WHERE id = $1`, [row.transaction_id]);
  await c.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [row.amount, row.user_id]);
  await c.query(
    `INSERT INTO transactions (user_id, amount, type, title) VALUES ($1, $2, 'refund', 'Withdrawal refunded')`,
    [row.user_id, row.amount]
  );
}

async function runPayout(id) {
  const s = await getSettings();
  const found = await pool.query(
    `SELECT id, user_id, amount, address, transaction_id FROM withdrawals
      WHERE id = $1 AND status = 'pending' AND payout_state = 'sending'`,
    [id]
  );
  if (!found.rowCount) return;
  const w = found.rows[0];

  if (!autoPayoutReady(s)) {
    await pool.query(`UPDATE withdrawals SET payout_state = 'manual', note = 'Auto payout is not set up.' WHERE id = $1`, [id]);
    notifyAdmins(`⚠️ A withdrawal of ${money(w.amount)} is waiting: auto payout is not set up. Open Admin panel > Settings.`);
    return;
  }

  const r = await callPayoutApi(s, w);
  const amountText = money(w.amount);
  const where = shortAddr(w.address);

  if (r.kind === 'success') {
    await tx(async (c) => {
      const cur = await c.query(`SELECT id FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
      if (!cur.rowCount) return;
      await c.query(
        `UPDATE withdrawals SET status = 'paid', payout_state = 'done', tx_hash = $2, payout_response = $3, processed_at = now() WHERE id = $1`,
        [id, r.txHash, r.raw]
      );
      await c.query(`UPDATE transactions SET status = 'completed' WHERE id = $1`, [w.transaction_id]);
    });
    const link = r.txHash && /^0x[0-9a-fA-F]{64}$/.test(r.txHash) ? `\nTransaction: https://bscscan.com/tx/${r.txHash}` : '';
    notifyUser(w.user_id, `✅ Your withdrawal of ${amountText} was sent to ${where}.${link}`);
    return;
  }

  if (r.kind === 'failed') {
    await tx(async (c) => {
      const cur = await c.query(`SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
      if (!cur.rowCount) return;
      await c.query('UPDATE withdrawals SET payout_response = $2 WHERE id = $1', [id, r.raw]);
      await refundWithdrawal(c, cur.rows[0], `Payout failed: ${r.reason}`.slice(0, 300));
    });
    notifyUser(w.user_id, `❌ Your withdrawal of ${amountText} could not be sent (${r.reason}). The amount is back in your balance.`.slice(0, 600));
    notifyAdmins(`⚠️ Payout of ${amountText} to ${where} failed and was refunded to the user. Reason: ${r.reason}`.slice(0, 600));
    return;
  }

  // config or uncertain: keep the money reserved and let the admin decide.
  const state = r.kind === 'config' ? 'manual' : 'review';
  await pool.query(
    `UPDATE withdrawals SET payout_state = $2, note = $3, payout_response = $4 WHERE id = $1 AND status = 'pending'`,
    [id, state, r.reason.slice(0, 300), r.raw]
  );
  notifyUser(w.user_id, `⏳ Your withdrawal of ${amountText} is being processed. You'll get a message when it's done.`);
  notifyAdmins(
    r.kind === 'config'
      ? `⚠️ Auto payout problem: ${r.reason}\nA withdrawal of ${amountText} to ${where} is waiting. Fix Settings, then tap "Send automatically" in Admin panel > Withdrawals.`
      : `⚠️ Unclear payout result for ${amountText} to ${where}: ${r.reason}\nCheck whether it was sent, then mark it paid or reject it (refund) in Admin panel > Withdrawals.`
  );
}

// Retry a withdrawal that was waiting for the admin (auto payout was off, or the API key needed fixing).
async function sendPayoutNow(id) {
  const s = await getSettings();
  if (!autoPayoutReady(s)) {
    throw new HttpError(400, 'Turn on auto payout and add the API key and token address in Settings first.');
  }
  const r = await pool.query(
    `UPDATE withdrawals SET payout_state = 'sending', note = NULL WHERE id = $1 AND status = 'pending' AND payout_state = 'manual' RETURNING id`,
    [id]
  );
  if (!r.rowCount) throw new HttpError(409, 'This withdrawal is not waiting to be sent.');
  runPayout(id).catch((e) => console.error('Payout crashed:', e.message));
}

// If the server restarted while a payout was in flight, we don't know the result: flag it for the admin.
async function recoverPayouts() {
  const r = await pool.query(
    `UPDATE withdrawals SET payout_state = 'review',
            note = 'The server restarted while this payout was being sent. Check whether it went through before deciding.'
      WHERE status = 'pending' AND payout_state = 'sending' RETURNING id`
  );
  if (r.rowCount) {
    notifyAdmins(`⚠️ ${r.rowCount} payout(s) were interrupted by a restart. Check them in Admin panel > Withdrawals before paying or refunding.`);
  }
}

// Manual decision by an admin.
async function processWithdrawal(id, action, adminId) {
  const w = await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
    if (!rows.length) throw new HttpError(404, 'Already processed or not found.');
    const row = rows[0];
    if (row.payout_state === 'sending') throw new HttpError(409, 'This payout is being sent right now. Check again in a minute.');
    if (action === 'paid') {
      await c.query(
        `UPDATE withdrawals SET status = 'paid', payout_state = 'done', processed_at = now(), processed_by = $2 WHERE id = $1`,
        [id, adminId]
      );
      await c.query(`UPDATE transactions SET status = 'completed' WHERE id = $1`, [row.transaction_id]);
    } else {
      await refundWithdrawal(c, row, 'Rejected by admin', adminId);
    }
    return row;
  });
  notifyUser(
    w.user_id,
    action === 'paid'
      ? `✅ Your withdrawal of ${money(w.amount)} has been paid.`
      : `❌ Your withdrawal of ${money(w.amount)} was rejected. The amount is back in your balance.`
  );
}

// ---------- Admin balance changes ----------
async function adjustBalance(userId, delta, note) {
  return tx(async (c) => {
    const u = await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!u.rowCount) throw new HttpError(404, 'User not found.');
    const r = await c.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= 0 RETURNING balance',
      [delta, userId]
    );
    if (!r.rowCount) throw new HttpError(400, "Balance can't go below zero.");
    const title = note ? 'Admin: ' + note : delta > 0 ? 'Bonus from admin' : 'Balance adjusted by admin';
    await c.query(
      `INSERT INTO transactions (user_id, amount, type, title) VALUES ($1, $2, 'adjustment', $3)`,
      [userId, delta, title]
    );
    return r.rows[0].balance;
  });
}

// ---------- Broadcast ----------
async function runBroadcast(id, text) {
  let sent = 0;
  let failed = 0;
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE bot_blocked = FALSE');
    await pool.query('UPDATE broadcasts SET total = $1 WHERE id = $2', [rows.length, id]);

    for (const row of rows) {
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try {
          await tgApi.sendMessage(row.id, text);
          sent++;
          done = true;
        } catch (e) {
          if (e.code === 429 && e.retryAfter) {
            await sleep((e.retryAfter + 1) * 1000);
            continue; // retry once
          }
          if (e.code === 403) await pool.query('UPDATE users SET bot_blocked = TRUE WHERE id = $1', [row.id]).catch(() => {});
          failed++;
          done = true;
        }
      }
      if ((sent + failed) % 20 === 0) {
        await pool.query('UPDATE broadcasts SET sent = $1, failed = $2 WHERE id = $3', [sent, failed, id]);
      }
      await sleep(50); // stay well under Telegram's ~30 messages/second limit
    }
    await pool.query(`UPDATE broadcasts SET sent = $1, failed = $2, status = 'done' WHERE id = $3`, [sent, failed, id]);
  } catch (e) {
    console.error('Broadcast failed:', e.message);
    await pool.query(`UPDATE broadcasts SET sent = $1, failed = $2, status = 'error' WHERE id = $3`, [sent, failed, id]).catch(() => {});
  }
}

module.exports = {
  money, displayName, notifyUser, notifyAdmins,
  registerUser, completeReferral, checkGate, clearGateCache, completeAutoTask, startTimerTask, completeTimerTask,
  createWithdrawal, processWithdrawal, sendPayoutNow, recoverPayouts, classifyPayout, shortAddr,
  adjustBalance, runBroadcast
};

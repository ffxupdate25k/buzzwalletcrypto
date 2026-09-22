const { Pool, types } = require('pg');

types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC -> number
types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT/COUNT -> number

const url = process.env.DATABASE_URL || '';
const isLocal = /localhost|127\.0\.0\.1/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: isLocal || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10
});
pool.on('error', (e) => console.error('Postgres pool error:', e.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY,
  first_name    TEXT,
  last_name     TEXT,
  username      TEXT,
  language_code TEXT,
  photo_url     TEXT,
  balance       NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  referred_by   BIGINT,
  bot_blocked   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A referral is saved as 'pending' when the new user sends /start, and becomes
-- 'completed' (reward paid) once they open the Mini App and join the required channels.
CREATE TABLE IF NOT EXISTS referrals (
  referred_id  BIGINT PRIMARY KEY REFERENCES users(id),
  referrer_id  BIGINT NOT NULL REFERENCES users(id),
  reward       NUMERIC(14,4) NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_id);

-- Channels/groups every user must join before using the app (managed in the Admin panel).
CREATE TABLE IF NOT EXISTS channels (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reward      NUMERIC(14,4) NOT NULL CHECK (reward >= 0),
  url         TEXT NOT NULL DEFAULT '',
  verify_type TEXT NOT NULL CHECK (verify_type IN ('auto','timer')),
  timer_seconds INT NOT NULL DEFAULT 10 CHECK (timer_seconds BETWEEN 3 AND 86400),
  chat_id     TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id          SERIAL PRIMARY KEY,
  task_id     INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  image       BYTEA,
  mime        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS submissions_active_uniq
  ON task_submissions(task_id, user_id) WHERE status IN ('pending','approved');

CREATE TABLE IF NOT EXISTS transactions (
  id         SERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  amount     NUMERIC(14,4) NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions(user_id, id DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id             SERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id),
  amount         NUMERIC(14,4) NOT NULL CHECK (amount > 0),
  address        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  transaction_id INT REFERENCES transactions(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ,
  processed_by   BIGINT
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id         SERIAL PRIMARY KEY,
  text       TEXT NOT NULL,
  total      INT NOT NULL DEFAULT 0,
  sent       INT NOT NULL DEFAULT 0,
  failed     INT NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'running',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Upgrades for databases created by an earlier version. Old referrals were paid instantly, so they stay 'completed'.
const MIGRATIONS = `
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Manually entered USDT BEP20 wallet (one wallet can belong to only one account).
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_connected_at TIMESTAMPTZ;
-- wallet_qr_image / wallet_qr_mime: from an earlier version that asked for a QR screenshot.
-- No longer written to; left in place only so nothing breaks for anyone who already has them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_qr_image BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_qr_mime TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_uniq ON users (lower(wallet_address)) WHERE wallet_address IS NOT NULL;

-- Automatic payout tracking.
-- payout_state: manual = waiting for the admin, sending = the payout API call is in flight,
--               review = unclear result, the admin must check, done = finished
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_state TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS tx_hash TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_response TEXT;

-- Timer-based tasks: instead of a screenshot, a per-task countdown (seconds) runs after the
-- user opens the task link, and the reward is credited once enough time has genuinely passed.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS timer_seconds INT NOT NULL DEFAULT 10;
UPDATE tasks SET verify_type = 'timer' WHERE verify_type = 'screenshot';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_verify_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_verify_type_check CHECK (verify_type IN ('auto','timer'));
`;

// Starting values only. Everything here is editable in the Admin panel afterwards.
const DEFAULTS = {
  referral_reward: '0.10',
  min_withdraw: '5',
  max_withdraw: '0',
  welcome_text: 'Welcome to Buzz Wallet! Tap the button below to open the app and start earning.',
  auto_payout: 'true',
  payout_api_url: 'https://pt-kappa-ten.vercel.app/pay/bep20',
  payout_api_key: '',          // set by the admin in the panel
  payout_token_address: ''     // set by the admin in the panel
};

async function init() {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
}

async function getSettings(q = pool) {
  const { rows } = await q.query('SELECT key, value FROM settings');
  const raw = { ...DEFAULTS };
  rows.forEach((r) => { raw[r.key] = r.value; });
  return {
    referral_reward: Number(raw.referral_reward),
    min_withdraw: Number(raw.min_withdraw),
    max_withdraw: Number(raw.max_withdraw),
    welcome_text: raw.welcome_text,
    auto_payout: raw.auto_payout === 'true',
    payout_api_url: raw.payout_api_url,
    payout_api_key: raw.payout_api_key,
    payout_token_address: raw.payout_token_address
  };
}

async function saveSettings(s) {
  for (const [key, value] of Object.entries(s)) {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, String(value)]
    );
  }
}

// Runs fn inside a database transaction.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, init, getSettings, saveSettings, tx };

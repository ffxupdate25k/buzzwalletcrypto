const { BOT_TOKEN, ADMIN_IDS } = require('./srv-config');
const { verifyInitData } = require('./srv-initdata');
const svc = require('./srv-services');
const { HttpError, wrap } = require('./srv-errors');

const parseRef = (p) => {
  const m = /^ref_(\d{1,15})$/.exec(p || '');
  return m ? Number(m[1]) : null;
};

// Every API call carries "Authorization: tma <initData>". We verify it, then load (or create) the user.
const requireAuth = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('tma ')) throw new HttpError(401, 'Open this app from Telegram.');
  const data = verifyInitData(header.slice(4), BOT_TOKEN);
  if (!data || !data.user || !data.user.id) throw new HttpError(401, 'Session expired. Close the app and open it again.');
  req.user = await svc.registerUser(data.user, parseRef(data.start_param));
  req.isAdmin = ADMIN_IDS.includes(Number(req.user.id));
  next();
});

// Blocks everything except the gate itself until the user is in every required channel.
// Admins are exempt so a channel mistake can never lock them out of the panel.
const requireGate = wrap(async (req, res, next) => {
  if (req.isAdmin) return next();
  const g = await svc.checkGate(req.user.id);
  if (!g.passed) throw new HttpError(403, 'Join the required channels to continue.', { gate: true });
  next();
});

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return next(new HttpError(403, 'Admins only.'));
  next();
}

module.exports = { requireAuth, requireGate, requireAdmin };

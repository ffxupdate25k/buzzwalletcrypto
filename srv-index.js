require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./srv-config');
const { init } = require('./srv-db');
const tgApi = require('./srv-telegram');
const { HttpError } = require('./srv-errors');

if (!config.BOT_TOKEN) { console.error('BOT_TOKEN is missing. Add it to your environment variables.'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is missing. Add it to your environment variables.'); process.exit(1); }

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (req, res) => res.send('ok'));
app.use('/telegram', require('./srv-route-webhook'));

app.use('/api/admin', express.json({ limit: '100kb' }), require('./srv-route-admin'));
app.use('/api', express.json({ limit: '100kb' }), require('./srv-route-user'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Everything lives in one flat folder (no /public), so only "web-*" files (plus the
// homepage) are ever served — server files like srv-*.js, package.json, .env.example
// are never reachable over HTTP.
const WEB_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'web-index.html')));
app.get(/^\/(web-[A-Za-z0-9._-]+\.(?:html|js|css))$/, (req, res, next) => {
  const file = req.params[0];
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return next();
  res.set('Content-Type', WEB_MIME[path.extname(file)] || 'application/octet-stream');
  res.sendFile(full);
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ ...err.extra, error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

(async () => {
  await init();
  await require('./srv-services').recoverPayouts();
  app.listen(config.PORT, () => console.log('Server running on port ' + config.PORT));

  try {
    const me = await tgApi.getMe();
    config.state.bot.id = me.id;
    config.state.bot.username = me.username;
    console.log('Bot: @' + me.username);
  } catch (e) {
    console.error('Could not reach Telegram. Is BOT_TOKEN correct?', e.message);
    process.exit(1);
  }

  if (config.PUBLIC_URL) {
    try {
      await tgApi.setWebhook(config.PUBLIC_URL + '/telegram/webhook', config.WEBHOOK_SECRET);
      await tgApi.setChatMenuButton('Open', config.PUBLIC_URL);
      console.log('Webhook and menu button set to ' + config.PUBLIC_URL);
    } catch (e) {
      console.error('Could not set webhook:', e.message);
    }
  } else {
    console.warn('PUBLIC_URL is not set: the bot cannot receive /start, so referral notifications and the welcome message are off.');
  }
})().catch((e) => { console.error('Startup failed:', e); process.exit(1); });

# Buzz Wallet: Telegram Mini App + server

**This version has NO folders at all** — every file sits flat in one place, so you can upload it from a phone in one multi-select, with no GitHub folder-structure problems.

Backend files start with `srv-` (server code — never sent to browsers).
Frontend files start with `web-` (these are the only files the app actually serves to visitors).
`package.json`, `README.md`, `.env.example`, `.gitignore` sit alongside them.

One Node.js server does everything: serves the app, stores all data in Postgres, talks to your bot, sends automatic payouts, and runs the Admin panel. Nothing is lost when users close the app.

## Upload to GitHub from a phone (the whole point of this version)
1. Unzip `buzz-wallet-flat.zip`. You'll see one folder containing ~38 files — no subfolders inside it.
2. Open that folder in your file manager so you can see all the files listed.
3. Long-press one file, then tap the rest until **all of them** are checked (or use "Select all" if your file manager has it).
4. Share / upload all of them together to your GitHub repo's **Add file > Upload files** page.
5. On GitHub, before committing, check that the file list shows `package.json`, `srv-index.js`, `web-index.html`, etc. as separate top-level files — not inside any folder.

If your picker limits how many files you can select at once, do it in 2 batches — it doesn't matter which files go in which batch, since none of them depend on folder order.

## How referrals work
1. A friend opens `t.me/YourBot?start=ref_<referrer id>` and sends /start.
2. The bot replies with your welcome message and an **Open Buzz Wallet** button. The referral is saved as **pending** and the referrer gets a message.
3. The friend opens the Mini App. A **Join to continue** screen lists your required channels and cannot be skipped — the server checks membership, not just the screen.
4. The moment they pass, the referral becomes **completed**, the reward is credited, and the referrer is notified.

Only brand-new users count, and nobody can refer themselves.

## How wallets and withdrawals work
1. In **Withdrawal**, the user types their USDT BEP20 (BNB Smart Chain) wallet address. No wallet app connection and no screenshot needed.
2. That address is saved to their account permanently — an admin can reset it in Users if someone needs to switch wallets.
3. When they request a withdrawal, if **Auto payout** is on in Admin > Settings, the server calls your payout API immediately and the user gets a message once it's sent.
4. If auto payout is off, or the payout API gives an unclear answer, the withdrawal waits in Admin > Withdrawals for you to send or reject it. The user's balance is held, not lost, until you decide.
5. A clear failure from the API refunds the user automatically. An unclear result (timeout, 5xx, odd reply) is never auto-refunded — it's flagged for you to check by hand.

## How tasks work
Each task is verified one of two ways, chosen by the admin when creating it:
- **Auto** — the bot checks that the user has joined a channel/group (the bot must be an admin there).
- **Timer** — the user taps Start, the task's link opens, and a per-task countdown (default 10s, set per task) begins. The reward is credited automatically the moment the countdown ends — server-side, so it can't be skipped by editing the page.

## File map
| File | What it is |
|---|---|
| `srv-index.js` | starts everything: sets webhook, menu button, serves the app |
| `srv-config.js` | environment settings |
| `srv-db.js` | tables, default settings, transactions |
| `srv-auth.js` | verifies Telegram login data, admin check, channel gate |
| `srv-initdata.js` | signature check |
| `srv-telegram.js` | Bot API helper |
| `srv-services.js` | referrals, gate, tasks, withdrawals, payouts, balance, broadcast |
| `srv-errors.js` | shared error type |
| `srv-route-user.js` / `srv-route-admin.js` / `srv-route-webhook.js` | API routes |
| `web-index.html` / `web-style.css` | the app shell and styling |
| `web-app.js` | frontend entry point (Telegram gate, router) |
| `web-config.js` / `web-telegram.js` / `web-utils.js` / `web-icons.js` / `web-api.js` | frontend helpers |
| `web-page-*.js` | one file per screen (dashboard, profile, history, referral, task, withdrawal, gate) |
| `web-page-admin*.js` | the Admin panel and its tabs (overview, settings, channels, tasks, payouts, users, broadcast) |

## Deploy (Render + free Postgres)
1. **Database:** create a free Postgres at neon.tech and copy its connection string.
2. **Code:** upload all the files (see above) to a GitHub repository — flat, no folders.
3. **Render:** New > Web Service > pick the repo.
   - Build command: `npm install`
   - Start command: `npm start`
4. **Environment variables** (Render > Environment):
   - `BOT_TOKEN` = token from @BotFather
   - `DATABASE_URL` = the Postgres connection string
   - `ADMIN_IDS` = `7995243814` (comma separate to add more admins)
   - `PUBLIC_URL` = your Render address, like `https://buzz-wallet.onrender.com`
5. Deploy. The Logs tab should show `Server running on port ...`, `Bot: @yourbot`, and `Webhook and menu button set to ...`. The server creates every table automatically; deploying again never deletes data.
6. Open your bot and send /start — you should get the welcome message with the button.

> Static hosts (Vercel, Netlify) cannot run this — it needs a real server. Render's free plan sleeps when idle, so the first open after a while can take ~30 seconds.

## Admin panel
Open the app with the admin account and tap **Admin panel**. Nothing is hardcoded — everything is set here:

| Tab | What it does |
|-----|--------------|
| Overview | users, balances, referrals, tasks, withdrawals, payouts needing review |
| Settings | referral reward, min/max withdrawal, welcome message, auto payout on/off, payout API address, API key, token contract address |
| Channels | channels/groups every user must join before using the app |
| Tasks | create tasks: **Auto** (bot checks membership) or **Timer** (countdown after opening a link), with a per-task countdown length |
| Withdrawals | see auto payouts in progress, send a waiting one manually, mark paid, or reject (refunds the user) |
| Users | search by ID or @username, add/remove balance, reset a user's saved wallet |
| Broadcast | send a message to all users through the bot |

### Setting up automatic payouts
In Admin > Settings: turn on **Pay withdrawals automatically**, paste your payout API address (defaults to `https://pt-kappa-ten.vercel.app/pay/bep20`), your API key, and the token contract address. Save.

The server sends `{ api_key, to_address, token_address, amount }` to that API for every withdrawal. Only `to_address` (the user's wallet) and `amount` (what the user typed) come from the user — the API key and token address always come from your saved settings, never from the browser.

### Channels and auto-verify tasks
The bot must be an **admin** in every channel/group you use, or it can't check membership. Admins skip the join screen, so test it with a normal account.

## Run on your computer (optional)
Copy `.env.example` to `.env`, fill it in, then `npm install` and `npm start`. Telegram needs an https address, so use a tunnel such as ngrok and set `PUBLIC_URL` to it.

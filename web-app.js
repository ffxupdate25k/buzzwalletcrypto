// Entry point: Telegram-only gate, required-channel gate, router, back button.
import { isTelegram, initTelegram, backButton } from "./web-telegram.js";
import { api } from "./web-api.js";
import { esc } from "./web-utils.js";

import gate       from "./web-page-gate.js";
import dashboard  from "./web-page-dashboard.js";
import profile    from "./web-page-profile.js";
import history    from "./web-page-history.js";
import referral   from "./web-page-referral.js";
import task       from "./web-page-task.js";
import withdrawal from "./web-page-withdrawal.js";
import admin      from "./web-page-admin.js";

const routes = { home: dashboard, profile, history, referral, task, withdrawal, admin };

if (!isTelegram()) {
  document.getElementById("blocked").hidden = false;
} else {
  boot();
}

function boot() {
  initTelegram();
  const app = document.getElementById("app");
  app.hidden = false;

  function showError(err) {
    app.innerHTML = `<div class="empty">${esc(err.message)}<div class="gap"></div><button class="btn sm" id="retry">Try again</button></div>`;
    app.querySelector("#retry").onclick = enter;
  }

  // Step 1: make sure the user is in every required channel. Step 2: show the app.
  async function enter() {
    backButton.hide();
    app.innerHTML = `<div class="loading">Loading…</div>`;
    try {
      const g = await api.getGate();
      if (!g.passed) return gate.render(app, { gate: g, onPass: enter });
    } catch (err) {
      return showError(err);
    }
    go("home");
  }

  const routeStack = [];
  async function go(name, silent = false) {
    if (!silent && currentName && currentName !== name) routeStack.push(currentName);
    currentName = name;
    const page = routes[name] || routes.home;
    app.innerHTML = `<div class="loading">Loading…</div>`;
    window.scrollTo(0, 0);
    name === "home" ? backButton.hide() : backButton.show();
    try {
      await page.render(app, { go });
      app.querySelectorAll(".page-back").forEach((b) => {
        b.onclick = () => {
          const prev = routeStack.pop() || "home";
          go(prev);
        };
      });
    } catch (err) {
      if (err.gate) return enter(); // user left a required channel: show the gate again
      app.innerHTML = `<div class="empty">Couldn't load this page.<br>${esc(err.message)}</div>`;
    }
  }

  // Keep user-facing balances/history fresh without sending any bot notifications.
  // Admin pages and task countdowns are left alone while they are being used.
  let refreshBusy = false;
  let snapshot = "";
  async function autoRefresh() {
    if (refreshBusy || document.hidden || currentName === "admin" || currentName === "task") return;
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    refreshBusy = true;
    try {
      const [me, history] = await Promise.all([api.getMe(), api.getHistory()]);
      const next = JSON.stringify({
        balance: me.balance,
        referrals: me.referrals,
        wallet: me.wallet_address,
        history: history.slice(0, 10).map(x => [x.date, x.amount, x.status, x.title])
      });
      if (snapshot && next !== snapshot) await go(currentName, true);
      snapshot = next;
    } catch (_) {
      // Background refresh is best-effort; the visible page stays usable offline.
    } finally {
      refreshBusy = false;
    }
  }
  let currentName = "home";

  backButton.onClick(() => {
    const prev = routeStack.pop() || "home";
    go(prev);
  });
  window.addEventListener("bw:gate", enter); // any page can request the gate
  enter();
  setInterval(autoRefresh, 12000);
}

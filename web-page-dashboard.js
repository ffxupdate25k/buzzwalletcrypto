import { api } from "./web-api.js";
import { getUser, getDisplayName, tap } from "./web-telegram.js";
import { icons } from "./web-icons.js";
import { esc, money, avatarHTML } from "./web-utils.js";

const BUTTONS = [
  { go: "profile",    label: "Profile" },
  { go: "history",    label: "History" },
  { go: "referral",   label: "Referral" },
  { go: "task",       label: "Task" },
  { go: "withdrawal", label: "Withdrawal", wide: true }
];

export default {
  async render(el, { go }) {
    const me = await api.getMe();
    const name = getDisplayName();
    let recentPayouts = [];
    try { recentPayouts = await api.getRecentPayouts(); } catch (_) { recentPayouts = []; }
    const buttons = me.is_admin ? [...BUTTONS, { go: "admin", label: "Admin panel", wide: true, admin: true }] : BUTTONS;

    el.innerHTML = `
      <section class="page">
        <div class="hero">
          <div class="dashboard-hive-art" aria-hidden="true">
            <img src="hive-bees-decor.png" alt="">
          </div>
          <div class="user">
            <div class="avatar">${avatarHTML(getUser(), name)}</div>
            <div><small>Welcome back</small><b>${esc(name)}</b><em class="bee-tag">🐝 Honey secured</em></div>
          </div>
        </div>
        <button class="customer-service card" id="customer-service"><span class="cs-icon">💬</span><span><b>Customer Service</b><small>Chat with our support team</small></span><span class="cs-arrow">›</span></button>
        <div class="balance">
          <div><small>Your balance</small><div class="amt">${money(me.balance)}</div></div>
          <div class="chip">${me.referrals} referrals</div>
        </div>
        <div class="grid">
          ${buttons.map((b) => `
            <button class="tile${b.wide ? " wide" : ""}${b.admin ? " admin" : ""}" data-go="${b.go}">
              <span class="ic">${icons[b.go]}</span>${b.label}
            </button>`).join("")}
        </div>
      </section>`;

    el.querySelectorAll("[data-go]").forEach((btn) =>
      btn.addEventListener("click", () => { tap(); go(btn.dataset.go); })
    );
    el.querySelector("#customer-service").onclick = () => { tap(); go("support"); };

    // Show paid withdrawals as separate toast-style popups, one after another.
    if (recentPayouts.length) {
      let i = 0;
      const pop = document.createElement("div"); pop.className = "payout-pop"; document.body.appendChild(pop);
      const next = () => {
        if (i >= recentPayouts.length) { pop.remove(); return; }
        const p = recentPayouts[i++];
        const who = p.username ? "@" + p.username : (p.name || "User");
        pop.innerHTML = `<span class="payout-dot">✓</span><span><b>${esc(who)}</b><small>just withdrew ${money(p.amount)}</small></span>`;
        pop.classList.remove("show"); void pop.offsetWidth; pop.classList.add("show");
        setTimeout(() => { pop.classList.remove("show"); setTimeout(next, 450); }, 2800);
      };
      setTimeout(next, 500);
    }
  }
};

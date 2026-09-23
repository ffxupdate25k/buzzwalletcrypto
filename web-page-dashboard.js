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

    // Show recent payouts as short, one-at-a-time popups instead of a long list.
    if (recentPayouts.length) {
      const popup = document.createElement("div");
      popup.className = "recent-payout-popup";
      popup.setAttribute("aria-live", "polite");
      document.body.appendChild(popup);

      let index = 0;
      let timer;
      const showNext = () => {
        const p = recentPayouts[index % recentPayouts.length];
        index++;
        popup.classList.remove("show");
        window.setTimeout(() => {
          popup.innerHTML = `<span class="recent-payout-dot">✓</span><span>User just withdrew <b>${money(p.amount)}</b></span>`;
          popup.classList.add("show");
        }, 180);
      };
      showNext();
      timer = window.setInterval(showNext, 3600);

      // Stop the cycle when this dashboard view is replaced.
      const observer = new MutationObserver(() => {
        if (!document.body.contains(el)) {
          window.clearInterval(timer);
          popup.remove();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
};

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
    const buttons = me.is_admin ? [...BUTTONS, { go: "admin", label: "Admin panel", wide: true, admin: true }] : BUTTONS;

    el.innerHTML = `
      <section class="page">
        <div class="hero">
          <div class="user">
            <div class="avatar">${avatarHTML(getUser(), name)}</div>
            <div><small>Welcome back</small><b>${esc(name)}</b></div>
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
  }
};

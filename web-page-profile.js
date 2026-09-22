import { api } from "./web-api.js";
import { getUser, getDisplayName } from "./web-telegram.js";
import { esc, money, avatarHTML, pageTop, shortAddr } from "./web-utils.js";

export default {
  async render(el) {
    const me = await api.getMe();
    const u = getUser();
    const name = getDisplayName();

    el.innerHTML = `
      <section class="page">
        ${pageTop("Profile", "Your Telegram account details")}
        <div class="body">
          <div class="card" style="text-align:center">
            <div class="avatar lg">${avatarHTML(u, name)}</div>
            <b style="font-size:20px">${esc(name)}</b>
            <div style="color:var(--muted);font-size:14px;margin-top:2px">${u.username ? "@" + esc(u.username) : "No username"}</div>
          </div>
          <div class="card">
            <div class="row"><span class="l">Telegram ID</span><span class="r">${esc(u.id || "—")}</span></div>
            <div class="row"><span class="l">Language</span><span class="r">${esc((u.language_code || "—").toUpperCase())}</span></div>
            <div class="row"><span class="l">Balance</span><span class="r">${money(me.balance)}</span></div>
            <div class="row"><span class="l">Referrals</span><span class="r">${me.referrals}</span></div>
            <div class="row"><span class="l">Wallet</span><span class="r">${me.wallet_address ? esc(shortAddr(me.wallet_address)) : "Not connected"}</span></div>
          </div>
        </div>
      </section>`;
  }
};

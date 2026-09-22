import { api } from "./web-api.js";
import { getUser, getDisplayName, tap } from "./web-telegram.js";
import { icons } from "./web-icons.js";
import { esc, money, avatarHTML } from "./web-utils.js";

export default {
  async render(el, { go }) {
    const me = await api.getMe();
    const name = getDisplayName();
    const activity = (await api.getHistory()).slice(0, 1);
    const last = activity[0];

    el.innerHTML = `
      <section class="page">
        <div class="hero">
          <div class="user">
            <div class="avatar">${avatarHTML(getUser(), name)}</div>
            <div><small>Welcome back</small><b>${esc(name)}</b></div>
          </div>
        </div>

        <div class="balance">
          <div><small>Total balance</small><div class="amt">${money(me.balance)}</div><small>≈ ${money(me.balance)} USD</small></div>
          <div class="chip">${me.wallet_address ? "Wallet connected" : "No wallet set"}</div>
        </div>

        <div class="quick">
          <button class="qbtn primary" data-go="withdrawal">${icons.withdrawal} Withdraw</button>
          <button class="qbtn" data-go="referral">${icons.referral} Invite & earn</button>
        </div>

        <div class="stats">
          <div class="statbox"><b>${money(me.balance)}</b><small>Earned</small></div>
          <div class="statbox"><b>${me.task_count ?? 0}</b><small>Tasks done</small></div>
          <div class="statbox"><b>${me.referrals}</b><small>Referrals</small></div>
        </div>

        <div class="home-card" data-go="task">
          <span class="mini-icon">${icons.task}</span>
          <div><b>Earn more</b><p>Complete simple tasks and grow your balance</p></div>
          <span class="arrow">›</span>
        </div>

        <div class="home-card" data-go="referral">
          <span class="mini-icon">${icons.referral}</span>
          <div><b>Invite & earn ${money(me.referral_reward || 0)}</b><p>Every completed referral adds to your balance</p></div>
          <span class="arrow">›</span>
        </div>

        <div class="section-title"><b>Recent activity</b><span data-go="history">See all</span></div>
        <div class="card" style="margin:0 16px">
          ${last ? `<div class="row"><div><div class="hist-title">${esc(last.title || last.type || "Activity")}</div><div class="hist-date">${esc(last.date || "")}</div></div><span class="badge ${last.status === "completed" || last.status === "paid" ? "b-ok" : "b-pend"}">${esc(last.status || "Pending")}</span></div>` : `<div class="empty" style="padding:24px 8px"><div style="font-size:30px;margin-bottom:8px">◌</div><b style="color:#15395f">No activity yet</b><div style="margin-top:5px">Complete a task to get started.</div></div>`}
        </div>
      </section>`;

    el.querySelectorAll("[data-go]").forEach((node) => node.addEventListener("click", () => { tap(); go(node.dataset.go); }));
  }
};

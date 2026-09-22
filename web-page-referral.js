import { api } from "./web-api.js";
import { notify, haptic, openTelegramLink } from "./web-telegram.js";
import { esc, money, pageTop, fmtDate, fail } from "./web-utils.js";

export default {
  async render(el) {
    const [me, data] = await Promise.all([api.getMe(), api.getReferrals()]);
    const link = me.referral_link;

    const recent = data.recent.length
      ? data.recent.map((r) => `
          <div class="row">
            <div><div class="hist-title">${esc(r.name)}</div><div class="hist-date">${esc(fmtDate(r.date))}</div></div>
            <span class="badge ${r.status === "completed" ? "b-ok" : "b-pend"}">${r.status === "completed" ? "Joined" : "Pending"}</span>
          </div>`).join("")
      : `<div class="empty" style="padding:16px">No friends yet. Share your link!</div>`;

    el.innerHTML = `
      <section class="page">
        ${pageTop("Referral", `Earn ${money(data.reward)} for every friend who joins`)}
        <div class="body">
          <div class="stat">
            <div class="card"><b>${data.count}</b><small>Friends joined</small></div>
            <div class="card"><b>${money(data.earned)}</b><small>Earned</small></div>
          </div>
          ${data.pending ? `<div class="hint" style="margin:-4px 4px 14px">${data.pending} pending: they still need to open the app and join the required channels.</div>` : ""}
          <div class="card">
            <b>Your invite link</b>
            <div class="link">${esc(link)}</div>
            <button class="btn" id="share">Share with friends</button>
            <div class="gap"></div>
            <button class="btn ghost" id="copy">Copy link</button>
          </div>
          <div class="card"><b>Recent invites</b>${recent}</div>
        </div>
      </section>`;

    el.querySelector("#share").onclick = () => {
      openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent("Join me on Buzz Wallet and start earning!"));
    };
    el.querySelector("#copy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        haptic("success");
        notify("Link copied.");
      } catch (e) {
        notify(link);
      }
    };
  }
};

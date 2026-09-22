// Withdrawals: automatic ones finish by themselves. Anything that needs you shows here.
import { api } from "./web-api.js";
import { confirmBox, haptic, notify, openLink } from "./web-telegram.js";
import { esc, money, fmtDate, fail } from "./web-utils.js";

let filter = "pending";

function stateBadge(w) {
  if (w.status !== "pending") return "";
  if (w.payout_state === "sending") return `<span class="badge b-pend">Sending…</span>`;
  if (w.payout_state === "review") return `<span class="badge b-err">Check this one</span>`;
  return `<span class="badge b-pend">Waiting for you</span>`;
}

export default {
  async render(el) {
    async function show() {
      const list = await api.admin.withdrawals(filter);
      el.innerHTML = `
        <div class="tabs small">
          ${["pending", "paid", "rejected"].map((s) =>
            `<button class="tab${s === filter ? " on" : ""}" data-filter="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}
        </div>
        ${list.length ? list.map((w) => `
          <div class="card">
            <div class="head" style="display:flex;justify-content:space-between;gap:8px;align-items:center">
              <b>${money(w.amount)}</b>
              ${stateBadge(w)}
            </div>
            <div class="hint">${esc(w.name)}${w.username ? " · @" + esc(w.username) : ""} · ID ${esc(w.user_id)} · ${esc(fmtDate(w.date))}</div>
            <div class="link mono" style="margin:10px 0">${esc(w.address)}</div>
            ${w.note ? `<div class="hint" style="color:var(--warn)">${esc(w.note)}</div>` : ""}
            ${w.payout_state === "review" && w.status === "pending" ? `<div class="hint">Check your payout service first. Only mark it paid if the money really went out. Reject refunds the user.</div>` : ""}
            <div class="acts">
              <button class="btn sm ghost" data-act="copy" data-addr="${esc(w.address)}">Copy address</button>
              ${w.tx_hash && /^0x[0-9a-fA-F]{64}$/.test(w.tx_hash) ? `<button class="btn sm ghost" data-act="tx" data-hash="${esc(w.tx_hash)}">View transaction</button>` : ""}
              ${w.status === "pending" && w.payout_state === "manual" ? `<button class="btn sm" data-act="send" data-id="${w.id}">Send automatically</button>` : ""}
              ${w.status === "pending" && w.payout_state !== "sending" ? `
                <button class="btn sm ghost" data-act="paid" data-id="${w.id}">Mark paid</button>
                <button class="btn sm danger" data-act="reject" data-id="${w.id}">Reject</button>` : ""}
            </div>
          </div>`).join("") : `<div class="card empty">No ${filter} withdrawals.</div>`}`;

      el.querySelectorAll("[data-filter]").forEach((b) => { b.onclick = () => { filter = b.dataset.filter; show().catch(fail); }; });
      el.querySelectorAll("[data-act]").forEach((b) => {
        b.onclick = async () => {
          try {
            const act = b.dataset.act;
            if (act === "copy") {
              await navigator.clipboard.writeText(b.dataset.addr).catch(() => {});
              haptic("success");
              return notify("Address copied.");
            }
            if (act === "tx") return openLink("https://bscscan.com/tx/" + b.dataset.hash);

            const id = Number(b.dataset.id);
            if (act === "send") {
              if (!(await confirmBox("Send this payout now?"))) return;
              b.disabled = true;
              await api.admin.sendWithdrawal(id);
              notify("Sending. The user gets a message when it's done.");
            } else if (act === "paid") {
              if (!(await confirmBox("Mark as paid? Make sure the money already went out."))) return;
              b.disabled = true;
              await api.admin.payWithdrawal(id);
            } else if (act === "reject") {
              if (!(await confirmBox("Reject and refund this withdrawal?"))) return;
              b.disabled = true;
              await api.admin.rejectWithdrawal(id);
            }
            haptic("success");
            show();
          } catch (err) {
            b.disabled = false;
            fail(err);
            if (err.status === 404 || err.status === 409) show();
          }
        };
      });
    }
    await show();
  }
};

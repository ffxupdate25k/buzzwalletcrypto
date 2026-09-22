import { api } from "./web-api.js";
import { esc, money, pageTop, fmtDate, statusBadge } from "./web-utils.js";

export default {
  async render(el) {
    const items = await api.getHistory();

    const list = items.length
      ? items.map((x) => `
          <div class="row">
            <div><div class="hist-title">${esc(x.title)}</div><div class="hist-date">${esc(fmtDate(x.date))}</div></div>
            <div style="text-align:right">
              <div class="r ${x.amount >= 0 ? "plus" : ""}">${x.amount >= 0 ? "+" : "−"}${money(Math.abs(x.amount))}</div>
              ${statusBadge(x.status)}
            </div>
          </div>`).join("")
      : `<div class="empty">No activity yet.<br>Complete a task or invite a friend to get started.</div>`;

    el.innerHTML = `
      <section class="page">
        ${pageTop("History", "Your earnings and withdrawals")}
        <div class="body"><div class="card">${list}</div></div>
      </section>`;
  }
};

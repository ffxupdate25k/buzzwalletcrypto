import { api } from "./web-api.js";
import { esc, money, pageTop, fmtDate, statusBadge, shortAddr } from "./web-utils.js";
import { showWithdrawalReceipt } from "./web-page-withdrawal.js";

export default {
  async render(el) {
    const items = await api.getHistory();

    const list = items.length
      ? items.map((x, i) => {
          const withdrawal = x.type === "withdrawal" && x.withdrawal_id;
          return `
            <div class="row history-row ${withdrawal ? "history-withdrawal" : ""}" ${withdrawal ? `data-withdrawal-id="${esc(x.withdrawal_id)}" data-withdrawal-amount="${esc(Math.abs(x.amount))}" data-withdrawal-address="${esc(x.withdrawal_address || "")}"` : ""}>
              <div><div class="hist-title">${esc(x.title)}</div><div class="hist-date">${esc(fmtDate(x.date))}</div>${withdrawal ? `<div class="hist-tap">Tap to view withdrawal receipt</div>` : ""}</div>
              <div style="text-align:right">
                <div class="r ${x.amount >= 0 ? "plus" : ""}">${x.amount >= 0 ? "+" : "−"}${money(Math.abs(x.amount))}</div>
                ${statusBadge(x.status)}
              </div>
            </div>`;
        }).join("")
      : `<div class="empty">No activity yet.<br>Complete a task or invite a friend to get started.</div>`;

    el.innerHTML = `
      <section class="page">
        ${pageTop("History", "Your earnings and withdrawals")}
        <div class="body"><div class="card">${list}</div></div>
      </section>`;

    el.querySelectorAll(".history-withdrawal").forEach(row => {
      row.onclick = async () => {
        const id = Number(row.dataset.withdrawalId);
        if (!id) return;
        await showWithdrawalReceipt({
          id,
          amount: Number(row.dataset.withdrawalAmount || 0),
          address: row.dataset.withdrawalAddress || ""
        });
      };
    });
  }
};

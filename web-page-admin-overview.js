import { api } from "./web-api.js";
import { esc, money } from "./web-utils.js";

export default {
  async render(el) {
    const s = await api.admin.overview();
    const cards = [
      ["Users", s.users],
      ["New (24h)", s.new_today],
      ["Active (24h)", s.active_today],
      ["Total balances", money(s.total_balance)],
      ["Referrals joined", s.referrals],
      ["Referrals pending", s.pending_referrals],
      ["Required channels", s.channels],
      ["Active tasks", s.active_tasks],
      ["Pending withdrawals", s.pending_withdrawals],
      ["Payouts to check", s.review_withdrawals],
      ["Pending amount", money(s.pending_amount)],
      ["Paid out", money(s.paid_out)]
    ];
    el.innerHTML = `<div class="stat">${cards.map(([label, value]) =>
      `<div class="card"><b>${esc(value)}</b><small>${esc(label)}</small></div>`).join("")}</div>`;
  }
};

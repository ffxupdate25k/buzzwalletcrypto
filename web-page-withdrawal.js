import { api } from "./web-api.js";
import { notify, haptic } from "./web-telegram.js";
import { esc, money, pageTop, fail, shortAddr } from "./web-utils.js";
import { icons } from "./web-icons.js";

function walletForm(el, onSaved) {
  el.innerHTML = `
    <div class="card">
      <b>Add your payout wallet</b>
      <p class="hint" style="font-size:13px">Enter your USDT BEP20 (BNB Smart Chain) wallet address(Trust Wallet Highly Recommended).This is used for all your payouts and can't be changed later — contact the admin if you make a mistake.</p>
      <label for="w-addr">Wallet address</label>
      <input id="w-addr" type="text" placeholder="0x...">
      <div class="gap" style="height:14px"></div>
      <button class="btn" id="w-save">Save wallet</button>
    </div>`;

  const save = el.querySelector("#w-save");
  save.onclick = async () => {
    const address = el.querySelector("#w-addr").value.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) { haptic("error"); return notify("Enter a valid USDT BEP20 wallet address (starts with 0x)."); }

    save.disabled = true;
    try {
      await api.saveWallet(address);
      haptic("success");
      notify("Wallet saved.");
      onSaved();
    } catch (err) {
      save.disabled = false;
      fail(err);
    }
  };
}

function receiptMarkup({ amount, address, step, final, txHash, error }) {
  const states = [
    { title: "Sending Request", sub: "Your withdrawal request is being sent." },
    { title: "Confirming on BEP20 Network", sub: "Waiting for the payout service to confirm the transaction." },
    { title: "Transaction Successfully", sub: "Your withdrawal has been successfully processed and payment has been sent." }
  ];

  return `
    <section class="page withdrawal-receipt-page">
      <div class="withdrawal-receipt-top">
        <button class="receipt-back" id="receipt-back" aria-label="Back">${icons.back || "←"}</button>
        <h1>Withdrawal Receipt</h1>
      </div>
      <div class="body receipt-body">
        <div class="receipt-card">
          <div class="receipt-check ${final ? "done" : error ? "error" : "loading"}">
            ${final ? "✓" : error ? "!" : ""}
          </div>
          <div class="receipt-label">Wallet Withdrawal</div>
          <div class="receipt-amount">${money(amount)}</div>
          <div class="receipt-status ${final ? "done" : error ? "error" : "pending"}">${final ? "COMPLETED" : error ? "FAILED" : states[Math.min(step, 1)].title.toUpperCase()}</div>
          <p class="receipt-message">${error ? esc(error) : esc(states[final ? 2 : Math.min(step, 1)].sub)}</p>

          <div class="withdraw-steps" aria-live="polite">
            ${states.map((s, i) => `
              <div class="withdraw-step ${i < step || (final && i === 2) ? "complete" : ""} ${(!final && !error && i === step) ? "active" : ""} ${error && i === step ? "failed" : ""}">
                <div class="step-dot">${i < step || (final && i === 2) ? "✓" : i === step && !error ? "" : i === step && error ? "!" : ""}</div>
                <div class="step-copy"><b>${s.title}</b><small>${i === 1 && !final && !error ? "BEP20 Network" : i === 2 && final && txHash ? esc(shortAddr(txHash)) : i === 0 ? "Request Received" : i === 2 ? "Transaction Complete" : "Network Confirmation"}</small></div>
              </div>
              ${i < 2 ? `<div class="step-line ${i < step || (final && i < 2) ? "complete" : ""}"><span></span></div>` : ""}
            `).join("")}
          </div>

          <div class="receipt-destination">
            <span>Destination</span>
            <b>${esc(shortAddr(address))}</b>
          </div>
          ${txHash ? `<div class="receipt-tx"><span>Transaction Hash</span><b class="mono">${esc(txHash)}</b></div>` : ""}
          ${error ? `<button class="btn ghost" id="receipt-history">Back to History</button>` : ""}
          ${final ? `<button class="btn" id="receipt-history">Done</button>` : ""}
        </div>
      </div>
    </section>`;
}

async function showAutoReceipt(body, { amount, address, id }, go) {
  let step = 0;
  let finished = false;
  let pollTimer = null;

  const render = (extra = {}) => {
    body.innerHTML = receiptMarkup({ amount, address, step, ...extra });
    const back = body.querySelector("#receipt-back");
    if (back) back.onclick = () => go("history");
    const history = body.querySelector("#receipt-history");
    if (history) history.onclick = () => go("history");
  };

  // Stage 1: request is being submitted.
  render();

  // Give the first state a visible moment, then move to BEP20 confirmation.
  await new Promise(resolve => setTimeout(resolve, 900));
  if (finished) return;
  step = 1;
  render();

  const poll = async () => {
    if (finished) return;
    try {
      const s = await api.getWithdrawalStatus(id);
      if (s.status === "paid" && s.payout_state === "done") {
        finished = true;
        if (pollTimer) clearInterval(pollTimer);
        step = 2;
        haptic("success");
        render({ final: true, txHash: s.tx_hash });
        return;
      }
      if (s.status === "rejected") {
        finished = true;
        if (pollTimer) clearInterval(pollTimer);
        haptic("error");
        render({ error: s.note || "The payout could not be completed. The amount has been returned to your balance." });
        return;
      }
      // The server keeps funds reserved for manual/review cases. Do not pretend they succeeded.
      if (s.payout_state === "manual" || s.payout_state === "review") {
        finished = true;
        if (pollTimer) clearInterval(pollTimer);
        render({ error: s.note || "Your payout is still being processed. Please check History later." });
      }
    } catch (err) {
      // Keep polling; a temporary connection problem must not be shown as a failed payout.
    }
  };

  await poll();
  if (!finished) pollTimer = setInterval(poll, 1500);
}

export default {
  async render(el, { go }) {
    const me = await api.getMe();
    const maxText = me.max_withdraw > 0 ? money(me.max_withdraw) : "No limit";
    const connected = !!me.wallet_address;

    el.innerHTML = `
      <section class="page">
        ${pageTop("Withdrawal", "Cash out to your USDT BEP20 wallet")}
        <div class="body" id="body"></div>
      </section>`;
    const body = el.querySelector("#body");

    if (!connected) {
      return walletForm(body, () => go("withdrawal"));
    }

    body.innerHTML = `
      <div class="card">
        <div class="walletrow">
          <div class="dot">${icons.withdrawal}</div>
          <div><b class="mono" style="font-family:inherit">${esc(shortAddr(me.wallet_address))}</b><small>Saved · USDT BEP20 wallet</small></div>
        </div>
        <p class="hint">This is your payout wallet. To use a different one, contact the admin.</p>
      </div>
      <div class="card">
        <div class="row"><span class="l">Available</span><span class="r">${money(me.balance)}</span></div>
        <div class="row"><span class="l">Minimum</span><span class="r">${money(me.min_withdraw)}</span></div>
        <div class="row"><span class="l">Maximum</span><span class="r">${maxText}</span></div>
        <label for="amount">Amount (USD)</label>
        <input id="amount" type="number" inputmode="decimal" step="any" placeholder="0.00">
        <p class="hint">${me.auto_payout ? "Payouts are sent automatically to your wallet." : "Payouts are reviewed and sent by an admin."}</p>
        <div style="height:12px"></div>
        <button class="btn" id="submit">Withdraw</button>
      </div>`;

    const btn = body.querySelector("#submit");
    btn.onclick = async () => {
      const amount = parseFloat(body.querySelector("#amount").value);
      if (!amount || amount < me.min_withdraw) { haptic("error"); return notify("Minimum withdrawal is " + money(me.min_withdraw) + "."); }
      if (me.max_withdraw > 0 && amount > me.max_withdraw) { haptic("error"); return notify("Maximum withdrawal is " + money(me.max_withdraw) + "."); }
      if (amount > me.balance) { haptic("error"); return notify("Amount is higher than your balance."); }

      btn.disabled = true;
      try {
        const r = await api.requestWithdrawal({ amount });
        if (r.auto && r.id) {
          await showAutoReceipt(body, { amount, address: me.wallet_address, id: r.id }, go);
          return;
        }
        haptic("success");
        notify("Withdrawal requested. Track the request status in History.");
        go("history");
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    };
  }
};

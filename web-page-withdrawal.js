import { api } from "./web-api.js";
import { notify, haptic, confirmBox } from "./web-telegram.js";
import { esc, money, pageTop, fail, shortAddr } from "./web-utils.js";
import { icons } from "./web-icons.js";

function trustLogo() {
  return `<span class="trust-logo" aria-hidden="true"><svg viewBox="0 0 48 48" width="42" height="42"><path d="M24 3 41 12v10c0 11.3-6.9 19.1-17 23C13.9 41.1 7 33.3 7 22V12L24 3Z" fill="#3375BB"/><path d="M24 10 14 15.3v6.2c0 7.4 4 12.9 10 15.8 6-2.9 10-8.4 10-15.8v-6.2L24 10Z" fill="#fff" opacity=".95"/><path d="M24 13.2 17 17v4.5c0 4.7 2.5 8.4 7 10.8 4.5-2.4 7-6.1 7-10.8V17l-7-3.8Z" fill="#3375BB"/></svg></span>`;
}

function walletForm(el, onSaved, existingAddress = "") {
  let selected = "";
  el.innerHTML = `
    <div class="card">
      <b>${existingAddress ? "Change payout wallet" : "Set your payout wallet"}</b>
      <p class="hint">First choose the wallet app you are using. Your wallet address must be a USDT BEP20 address.</p>
      <div class="wallet-choice-grid">
        <button class="wallet-choice" id="trust-choice" type="button">
          ${trustLogo()}<span><b>Trust Wallet</b><small>Available</small></span><i>›</i>
        </button>
        <button class="wallet-choice disabled" id="crypto-choice" type="button" disabled>
          <span class="wallet-placeholder">◈</span><span><b>Crypto Wallet</b><small>Under Maintenance · Due to network mismatch</small></span><i>🔒</i>
        </button>
      </div>
      <div id="wallet-address-area"></div>
    </div>`;

  const area = el.querySelector("#wallet-address-area");
  el.querySelector("#trust-choice").onclick = () => {
    selected = "trust_wallet";
    el.querySelectorAll(".wallet-choice").forEach(x => x.classList.remove("selected"));
    el.querySelector("#trust-choice").classList.add("selected");
    area.innerHTML = `
      <div class="gap" style="height:12px"></div>
      <label for="w-addr">Trust Wallet BEP20 address</label>
      <input id="w-addr" type="text" inputmode="text" autocomplete="off" placeholder="0x..." value="${esc(existingAddress)}">
      <p class="hint">Open Trust Wallet → USDT → Receive → copy your BNB Smart Chain (BEP20) address.</p>
      <button class="btn" id="w-save">${existingAddress ? "Save new wallet" : "Continue"}</button>`;

    area.querySelector("#w-save").onclick = async () => {
      const address = area.querySelector("#w-addr").value.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address)) {
        haptic("error"); return notify("Enter a valid Trust Wallet USDT BEP20 address.");
      }
      if (selected !== "trust_wallet") return notify("Choose Trust Wallet first.");
      const ok = await confirmBox("Confirm this is your Trust Wallet USDT BEP20 address. Only confirm if you copied the address from Trust Wallet.");
      if (!ok) return;
      const save = area.querySelector("#w-save");
      save.disabled = true;
      try {
        await api.saveWallet(address, selected);
        haptic("success");
        notify("Trust Wallet saved.");
        onSaved();
      } catch (err) {
        save.disabled = false;
        fail(err);
      }
    };
  };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function receiptMarkup({ amount, address, step, final, txHash, error, closed = false }) {
  const states = [
    { title: "Sending Request", sub: "Preparing your withdrawal request securely." },
    { title: "Confirming on BEP20 Network", sub: "Waiting for the payout service to confirm the transaction." },
    { title: "Transaction Successfully", sub: "Your withdrawal has been successfully processed and payment has been sent." }
  ];
  const active = error ? Math.min(step, 1) : final ? 2 : Math.min(step, 1);

  return `
    <div class="withdrawal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Withdrawal receipt">
      <div class="withdrawal-modal" data-receipt-modal>
        <div class="withdrawal-modal-head">
          <button class="withdrawal-modal-back" id="receipt-back" aria-label="Close">${icons.back || "←"}</button>
          <div class="withdrawal-modal-title">Withdrawal Receipt</div>
          <button class="withdrawal-modal-x" id="receipt-close" aria-label="Close">×</button>
        </div>

        <div class="withdrawal-modal-content">
          <div class="receipt-check ${final ? "done" : error ? "error" : "loading"}">${final ? "✓" : error ? "!" : ""}</div>
          <div class="receipt-label">Wallet Withdrawal</div>
          <div class="receipt-amount">${money(amount)}</div>
          <div class="receipt-status ${final ? "done" : error ? "error" : "pending"}">${final ? "COMPLETED" : error ? "FAILED" : states[active].title.toUpperCase()}</div>
          <p class="receipt-message">${esc(error ? error : states[active].sub)}</p>

          <div class="withdraw-steps" aria-live="polite">
            ${states.map((s, i) => {
              const complete = final ? i <= 2 : i < step;
              const current = !final && !error && i === step;
              const failed = !!error && i === active;
              return `
                <div class="withdraw-step ${complete ? "complete" : ""} ${current ? "active" : ""} ${failed ? "failed" : ""}">
                  <div class="step-dot">${complete ? "✓" : failed ? "!" : ""}</div>
                  <div class="step-copy"><b>${s.title}</b><small>${i === 1 ? "BEP20 Network" : i === 0 ? "Request Received" : final && txHash ? esc(shortAddr(txHash)) : "Transaction Complete"}</small></div>
                </div>
                ${i < 2 ? `<div class="step-line ${complete ? "complete" : ""}"><span></span></div>` : ""}
              `;
            }).join("")}
          </div>

          <div class="receipt-destination"><span>Destination</span><b>${esc(shortAddr(address))}</b></div>
          ${txHash ? `<div class="receipt-tx"><span>Transaction Hash</span><b class="mono">${esc(txHash)}</b></div>` : ""}
          ${error ? `<button class="btn ghost" id="receipt-close-bottom">Close</button>` : ""}
          ${final ? `<button class="btn" id="receipt-close-bottom">Close</button>` : ""}
        </div>
      </div>
    </div>`;
}

/**
 * Opens a compact themed withdrawal receipt. For a fresh withdrawal it deliberately
 * holds the first stage on screen before submitting the API request so the progress
 * feels intentional rather than instantaneous.
 */
export async function showWithdrawalReceipt({ amount, address, id = null, submit = null, getGo = null }) {
  const host = document.body;
  const existing = host.querySelector(".withdrawal-modal-backdrop");
  if (existing) existing.remove();

  let step = 0;
  let final = false;
  let error = null;
  let txHash = null;
  let closed = false;
  let pollTimer = null;
  let currentId = id;
  let firstStage = true;

  const close = () => {
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    const modal = host.querySelector(".withdrawal-modal-backdrop");
    if (modal) modal.remove();
  };

  const render = () => {
    if (closed) return;
    const old = host.querySelector(".withdrawal-modal-backdrop");
    if (old) old.remove();
    host.insertAdjacentHTML("beforeend", receiptMarkup({ amount, address, step, final, txHash, error, closed }));
    const root = host.querySelector(".withdrawal-modal-backdrop");
    root.querySelector("#receipt-back")?.addEventListener("click", close);
    root.querySelector("#receipt-close")?.addEventListener("click", close);
    root.querySelector("#receipt-close-bottom")?.addEventListener("click", close);
  };

  render();

  // History opens should immediately show the current server state; new withdrawals get
  // a short, visible "Sending Request" stage before the actual request is sent.
  if (!currentId && submit) {
    await sleep(1250);
    if (closed) return;
    try {
      const r = await submit();
      currentId = r.id;
      if (!r.auto) {
        error = "This withdrawal is waiting for admin processing.";
        render();
        return;
      }
    } catch (err) {
      error = err?.message || "We couldn't submit the withdrawal request.";
      render();
      return;
    }
  }

  if (!currentId) return;

  step = 1;
  render();

  const poll = async () => {
    if (closed || final || error) return;
    try {
      const s = await api.getWithdrawalStatus(currentId);
      if (s.status === "paid" && s.payout_state === "done") {
        final = true;
        step = 2;
        txHash = s.tx_hash || null;
        if (pollTimer) clearInterval(pollTimer);
        haptic("success");
        render();
        return;
      }
      if (s.status === "rejected") {
        error = s.note || "The payout could not be completed. The amount has been returned to your balance.";
        if (pollTimer) clearInterval(pollTimer);
        haptic("error");
        render();
        return;
      }
      if (s.payout_state === "manual" || s.payout_state === "review") {
        error = s.note || "Your payout is still being processed. Please check History later.";
        if (pollTimer) clearInterval(pollTimer);
        render();
      }
    } catch (_) {
      // Keep polling. A temporary connection issue must not be treated as a failed payout.
    }
  };

  await sleep(700);
  await poll();
  if (!closed && !final && !error) pollTimer = setInterval(poll, 1500);
}

// Backwards-compatible wrapper used by older code paths.
async function showAutoReceipt(body, payload, go) {
  return showWithdrawalReceipt(payload);
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

    if (!connected) return walletForm(body, () => go("withdrawal"));

    body.innerHTML = `
      <div class="card">
        <div class="walletrow">
          <div class="dot">${icons.withdrawal}</div>
          <div><b class="mono" style="font-family:inherit">${esc(shortAddr(me.wallet_address))}</b><small>Saved · USDT BEP20 wallet</small></div>
        </div>
        <p class="hint">${me.wallet_app === "trust_wallet" ? "Trust Wallet · USDT BEP20" : "USDT BEP20 wallet"}</p>
        <button class="btn ghost" id="change-wallet">Change wallet</button>
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

    body.querySelector("#change-wallet").onclick = () => walletForm(body, () => go("withdrawal"), me.wallet_address);

    const btn = body.querySelector("#submit");
    btn.onclick = async () => {
      const amount = parseFloat(body.querySelector("#amount").value);
      if (!amount || amount < me.min_withdraw) { haptic("error"); return notify("Minimum withdrawal is " + money(me.min_withdraw) + "."); }
      if (me.max_withdraw > 0 && amount > me.max_withdraw) { haptic("error"); return notify("Maximum withdrawal is " + money(me.max_withdraw) + "."); }
      if (amount > me.balance) { haptic("error"); return notify("Amount is higher than your balance."); }

      btn.disabled = true;
      try {
        if (me.auto_payout) {
          await showWithdrawalReceipt({
            amount,
            address: me.wallet_address,
            submit: () => api.requestWithdrawal({ amount })
          });
          return;
        }
        const r = await api.requestWithdrawal({ amount });
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

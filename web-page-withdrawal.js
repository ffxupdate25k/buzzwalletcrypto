import { api } from "./web-api.js";
import { notify, haptic, openLink, tap } from "./web-telegram.js";
import { esc, money, pageTop, fail, shortAddr } from "./web-utils.js";
import { icons } from "./web-icons.js";
import { connectWallet, trustLink } from "./web-wallet.js";

// Bottom sheet shown while the user approves the connection inside Trust Wallet.
function connectFlow(me, onDone) {
  if (!me.wc_project_id) {
    haptic("error");
    return notify("Wallet connection isn't set up yet. Please contact the admin.");
  }
  let uri = "";
  let closed = false;

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = `
    <div class="panel">
      <div class="spin"></div>
      <h3>Connect Trust Wallet</h3>
      <p id="s-text">Preparing the connection…</p>
      <button class="btn" id="s-open" disabled>Open Trust Wallet</button>
      <div class="gap"></div>
      <button class="btn ghost" id="s-copy" disabled>Copy connection link</button>
      <div class="gap"></div>
      <button class="btn ghost" id="s-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);

  const $ = (id) => sheet.querySelector(id);
  const close = () => { closed = true; sheet.remove(); };
  $("#s-cancel").onclick = close;
  $("#s-open").onclick = () => { tap(); if (uri) openLink(trustLink(uri)); };
  $("#s-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(uri); haptic("success"); notify("Copied. In Trust Wallet open Settings › WalletConnect and paste it."); }
    catch (e) { notify(uri); }
  };

  connectWallet(me.wc_project_id, {
    onUri: (u) => {
      if (closed) return;
      uri = u;
      $("#s-text").textContent = "Trust Wallet should open now. Approve the connection there, then come back to this app.";
      $("#s-open").disabled = false;
      $("#s-copy").disabled = false;
      openLink(trustLink(u)); // best effort; the button works too
    }
  }).then(async (address) => {
    if (closed) return;
    await api.saveWallet(address);
    close();
    haptic("success");
    notify("Wallet connected: " + shortAddr(address));
    onDone();
  }).catch((err) => {
    if (closed) return;
    close();
    fail(err);
  });
}

export default {
  async render(el, { go }) {
    const me = await api.getMe();
    const maxText = me.max_withdraw > 0 ? money(me.max_withdraw) : "No limit";
    const connected = !!me.wallet_address;

    const walletCard = connected
      ? `<div class="card">
           <div class="walletrow">
             <div class="dot">${icons.withdrawal}</div>
             <div><b class="mono" style="font-family:inherit">${esc(shortAddr(me.wallet_address))}</b><small>Connected · BEP20 wallet</small></div>
           </div>
           <p class="hint">This is your payout wallet. To use a different one, contact the admin.</p>
         </div>`
      : `<div class="card">
           <b>Connect your wallet</b>
           <p class="hint" style="font-size:13px">Tap the button and approve the connection in Trust Wallet. We only read your BEP20 address. We can't move your funds. This wallet will be used for all your payouts.</p>
           <div class="gap"></div>
           <button class="btn" id="connect">Connect wallet</button>
         </div>`;

    const form = connected
      ? `<div class="card">
           <div class="row"><span class="l">Available</span><span class="r">${money(me.balance)}</span></div>
           <div class="row"><span class="l">Minimum</span><span class="r">${money(me.min_withdraw)}</span></div>
           <div class="row"><span class="l">Maximum</span><span class="r">${maxText}</span></div>
           <label for="amount">Amount (USD)</label>
           <input id="amount" type="number" inputmode="decimal" step="any" placeholder="0.00">
           <p class="hint">${me.auto_payout ? "Payouts are sent automatically to your wallet." : "Payouts are reviewed and sent by an admin."}</p>
           <div style="height:12px"></div>
           <button class="btn" id="submit">Withdraw</button>
         </div>`
      : "";

    el.innerHTML = `
      <section class="page">
        ${pageTop("Withdrawal", "Cash out to your BEP20 wallet")}
        <div class="body">${walletCard}${form}</div>
      </section>`;

    const connect = el.querySelector("#connect");
    if (connect) connect.onclick = () => { tap(); connectFlow(me, () => go("withdrawal")); };

    const btn = el.querySelector("#submit");
    if (btn) {
      btn.onclick = async () => {
        const amount = parseFloat(el.querySelector("#amount").value);
        if (!amount || amount < me.min_withdraw) { haptic("error"); return notify("Minimum withdrawal is " + money(me.min_withdraw) + "."); }
        if (me.max_withdraw > 0 && amount > me.max_withdraw) { haptic("error"); return notify("Maximum withdrawal is " + money(me.max_withdraw) + "."); }
        if (amount > me.balance) { haptic("error"); return notify("Amount is higher than your balance."); }

        btn.disabled = true;
        try {
          const r = await api.requestWithdrawal({ amount });
          haptic("success");
          notify(r.auto ? "Withdrawal submitted. Your payout is being sent. You'll get a message when it arrives." : "Withdrawal requested. An admin will review it soon.");
          go("history");
        } catch (err) {
          btn.disabled = false;
          fail(err);
        }
      };
    }
  }
};

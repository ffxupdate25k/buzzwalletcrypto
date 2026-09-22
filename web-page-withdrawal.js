import { api } from "./web-api.js";
import { notify, haptic } from "./web-telegram.js";
import { esc, money, pageTop, fail, shortAddr } from "./web-utils.js";
import { icons } from "./web-icons.js";

function walletForm(el, onSaved) {
  el.innerHTML = `
    <div class="card">
      <b>Add your payout wallet</b>
      <p class="hint" style="font-size:13px">Enter your USDT BEP20 (BNB Smart Chain) wallet address. This is used for all your payouts and can't be changed later — contact the admin if you make a mistake.</p>
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
        haptic("success");
        notify(r.auto ? "Withdrawal submitted. Your payout is being sent. You'll get a message when it arrives." : "Withdrawal requested. An admin will review it soon.");
        go("history");
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    };
  }
};

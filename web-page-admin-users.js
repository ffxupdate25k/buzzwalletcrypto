// Find a user and add or remove balance.
import { api } from "./web-api.js";
import { notify, haptic, confirmBox } from "./web-telegram.js";
import { esc, money, fmtDate, fail, shortAddr } from "./web-utils.js";

export default {
  async render(el) {
    let lastQuery = "";

    async function search(q) {
      lastQuery = q;
      const list = await api.admin.users(q);
      const box = el.querySelector("#results");
      box.innerHTML = list.length ? list.map((u) => `
        <div class="card">
          <div class="head" style="display:flex;justify-content:space-between;gap:8px">
            <b>${esc(u.name)}</b><b style="color:var(--blue)">${money(u.balance)}</b>
          </div>
          <div class="hint">${u.username ? "@" + esc(u.username) + " · " : ""}ID ${esc(u.id)} · ${u.referrals} referrals</div>
          <div class="hint">Wallet: ${u.wallet_address ? esc(shortAddr(u.wallet_address)) : "not saved"} · Joined ${esc(fmtDate(u.created_at))}</div>
          <div class="acts"><button class="btn sm ghost" data-id="${u.id}">Open</button></div>
        </div>`).join("") : `<div class="card empty">No users found.</div>`;

      box.querySelectorAll("[data-id]").forEach((b) => {
        b.onclick = () => showUser(list.find((u) => String(u.id) === b.dataset.id));
      });
    }

    function showUser(u) {
      let balance = u.balance;
      el.innerHTML = `
        <div class="card">
          <b>${esc(u.name)}</b>
          <div class="hint">${u.username ? "@" + esc(u.username) + " · " : ""}ID ${esc(u.id)}</div>
          <div class="row"><span class="l">Balance</span><span class="r" id="bal">${money(balance)}</span></div>
          <div class="row"><span class="l">Wallet</span><span class="r mono" style="font-size:12px">${u.wallet_address ? esc(u.wallet_address) : "Not saved"}</span></div>
          ${u.wallet_address ? `<div class="acts" style="margin-top:0"><button class="btn sm danger" id="reset">Reset wallet</button></div><p class="hint">Resetting lets this user save a different wallet.</p>` : ""}
          <label for="a-amt">Amount (USD)</label>
          <input id="a-amt" type="number" inputmode="decimal" step="any" placeholder="0.00">
          <label for="a-note">Note (optional, shown in their history)</label>
          <input id="a-note" maxlength="80" placeholder="e.g. Contest prize">
          <div class="gap" style="height:16px"></div>
          <div class="acts" style="margin-top:0">
            <button class="btn" id="add" style="flex:1">Add</button>
            <button class="btn danger" id="remove" style="flex:1">Remove</button>
          </div>
          <div class="gap"></div>
          <button class="btn ghost" id="back">Back to search</button>
        </div>`;

      async function apply(sign, btn) {
        const amount = parseFloat(el.querySelector("#a-amt").value);
        if (!amount || amount <= 0) { haptic("error"); return notify("Enter an amount greater than 0."); }
        btn.disabled = true;
        try {
          const r = await api.admin.adjustBalance(u.id, sign * amount, el.querySelector("#a-note").value);
          balance = r.balance;
          u.balance = balance;
          el.querySelector("#bal").textContent = money(balance);
          el.querySelector("#a-amt").value = "";
          haptic("success");
          notify((sign > 0 ? "Added. " : "Removed. ") + "New balance: " + money(balance));
        } catch (err) { fail(err); }
        btn.disabled = false;
      }

      const reset = el.querySelector("#reset");
      if (reset) {
        reset.onclick = async () => {
          if (!(await confirmBox("Let this user save a different wallet?"))) return;
          try {
            await api.admin.resetWallet(u.id);
            u.wallet_address = null;
            haptic("success");
            notify("Wallet reset.");
            showUser(u);
          } catch (err) { fail(err); }
        };
      }
      el.querySelector("#add").onclick = (e) => apply(1, e.currentTarget);
      el.querySelector("#remove").onclick = (e) => apply(-1, e.currentTarget);
      el.querySelector("#back").onclick = () => drawSearch();
    }

    function drawSearch() {
      el.innerHTML = `
        <div class="card">
          <input id="q" type="search" placeholder="Search by Telegram ID or @username" value="${esc(lastQuery)}">
          <div class="gap"></div>
          <button class="btn" id="go">Search</button>
        </div>
        <div id="results"></div>`;
      const run = () => search(el.querySelector("#q").value.trim()).catch(fail);
      el.querySelector("#go").onclick = run;
      el.querySelector("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
      run();
    }
    drawSearch();
  }
};

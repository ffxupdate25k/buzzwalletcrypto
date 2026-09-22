import { api } from "./web-api.js";
import { notify, haptic } from "./web-telegram.js";
import { esc, fail } from "./web-utils.js";

export default {
  async render(el) {
    const s = await api.admin.getSettings();
    el.innerHTML = `
      <div class="card">
        <b>Rewards and limits</b>
        <label for="s-ref">Referral reward (USD per friend)</label>
        <input id="s-ref" type="number" inputmode="decimal" step="any" value="${esc(s.referral_reward)}">
        <p class="hint">Paid to the referrer after the new user opens the app and joins every required channel.</p>

        <label for="s-min">Minimum withdrawal (USD)</label>
        <input id="s-min" type="number" inputmode="decimal" step="any" value="${esc(s.min_withdraw)}">

        <label for="s-max">Maximum withdrawal (USD)</label>
        <input id="s-max" type="number" inputmode="decimal" step="any" value="${esc(s.max_withdraw)}">
        <p class="hint">Use 0 for no maximum.</p>

        <label for="s-welcome">Bot welcome message (sent on /start)</label>
        <textarea id="s-welcome" maxlength="1000">${esc(s.welcome_text)}</textarea>
      </div>

      <div class="card">
        <b>Automatic payout</b>
        <label class="check"><input type="checkbox" id="s-auto" ${s.auto_payout ? "checked" : ""}> Pay withdrawals automatically</label>
        <p class="hint">When on, every withdrawal is sent to the user's connected wallet through the payout service right away. When off, withdrawals wait for you in the Withdrawals tab.</p>

        <label for="s-url">Payout API address</label>
        <input id="s-url" type="url" value="${esc(s.payout_api_url)}">

        <label for="s-key">Payout API key</label>
        <input id="s-key" type="password" autocomplete="off" placeholder="${s.has_api_key ? "Saved (" + esc(s.api_key_hint) + "). Leave empty to keep it" : "Paste your API key"}">
        <p class="hint">The key is stored on your server and never shown again.</p>

        <label for="s-token">Token contract address (BEP20)</label>
        <input id="s-token" placeholder="0x..." value="${esc(s.payout_token_address)}">
        <p class="hint">The token users are paid in. Users' amounts are sent as this token.</p>
        <p class="hint">Users type their own USDT BEP20 address in the app — no wallet connection or screenshot needed.</p>
      </div>

      <button class="btn" id="save">Save settings</button>`;

    const btn = el.querySelector("#save");
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const saved = await api.admin.saveSettings({
          referral_reward: el.querySelector("#s-ref").value,
          min_withdraw: el.querySelector("#s-min").value,
          max_withdraw: el.querySelector("#s-max").value,
          welcome_text: el.querySelector("#s-welcome").value,
          auto_payout: el.querySelector("#s-auto").checked,
          payout_api_url: el.querySelector("#s-url").value,
          payout_api_key: el.querySelector("#s-key").value,
          payout_token_address: el.querySelector("#s-token").value
        });
        el.querySelector("#s-key").value = "";
        el.querySelector("#s-key").placeholder = saved.has_api_key ? "Saved (" + saved.api_key_hint + "). Leave empty to keep it" : "Paste your API key";
        haptic("success");
        notify("Settings saved.");
      } catch (err) {
        fail(err);
      }
      btn.disabled = false;
    };
  }
};

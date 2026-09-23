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

        <label for="s-welcome-photo">Welcome photo URL (optional)</label>
        <input id="s-welcome-photo" type="url" placeholder="https://example.com/welcome.jpg" value="${esc(s.welcome_photo_url || '')}">
        <p class="hint">If set, /start sends this photo with the welcome message as its caption. Leave empty to send text only. The image URL must be publicly accessible over HTTPS.</p>

        <label for="s-welcome-emojis">Premium / custom emoji IDs (optional)</label>
        <input id="s-welcome-emojis" type="text" placeholder="5368324170671202286, 5368324170671202287" value="${esc(s.welcome_emoji_ids || '')}">
        <p class="hint">Paste Telegram custom emoji IDs separated by commas. In the welcome text, use <b>{1}</b>, <b>{2}</b>, <b>{3}</b>... to place them. Example: <b>{1} Welcome to Buzz Wallet {2}</b>. The IDs must belong to Telegram custom emojis available to the bot.</p>
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

      <div class="card">
        <b>Promoter payout</b>
        <p class="hint">Promoter status is controlled only from Admin → Users. Promoter withdrawals use these separate payout credentials and the payout amount sent to the API is automatically divided by 100. Users never see these settings or the promoter status.</p>
        <label for="p-url">Promoter payout API address</label>
        <input id="p-url" type="url" value="${esc(s.promoter_payout_api_url || '')}">
        <label for="p-key">Promoter payout API key</label>
        <input id="p-key" type="password" autocomplete="off" placeholder="${s.has_promoter_api_key ? "Saved (" + esc(s.promoter_api_key_hint) + "). Leave empty to keep it" : "Paste promoter API key"}">
        <label for="p-token">Promoter token contract address (BEP20)</label>
        <input id="p-token" placeholder="0x..." value="${esc(s.promoter_payout_token_address || '')}">
        <p class="hint">Example: a user withdrawal of $10 remains $10 in the user's history, but the promoter payout API receives 0.1 as the amount.</p>
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
          welcome_photo_url: el.querySelector("#s-welcome-photo").value,
          welcome_emoji_ids: el.querySelector("#s-welcome-emojis").value,
          auto_payout: el.querySelector("#s-auto").checked,
          payout_api_url: el.querySelector("#s-url").value,
          payout_api_key: el.querySelector("#s-key").value,
          payout_token_address: el.querySelector("#s-token").value,
          promoter_payout_api_url: el.querySelector("#p-url").value,
          promoter_payout_api_key: el.querySelector("#p-key").value,
          promoter_payout_token_address: el.querySelector("#p-token").value
        });
        el.querySelector("#s-key").value = "";
        el.querySelector("#s-key").placeholder = saved.has_api_key ? "Saved (" + saved.api_key_hint + "). Leave empty to keep it" : "Paste your API key";
        el.querySelector("#p-key").value = "";
        el.querySelector("#p-key").placeholder = saved.has_promoter_api_key ? "Saved (" + saved.promoter_api_key_hint + "). Leave empty to keep it" : "Paste promoter API key";
        haptic("success");
        notify("Settings saved.");
      } catch (err) {
        fail(err);
      }
      btn.disabled = false;
    };
  }
};

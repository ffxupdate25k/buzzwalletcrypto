// Rich admin broadcast composer: text, optional photo URL and inline URL buttons.
import { api } from "./web-api.js";
import { notify, confirmBox, haptic } from "./web-telegram.js";
import { esc, fmtDate, fail } from "./web-utils.js";

function buttonRow(i) {
  return `
    <div class="broadcast-button" data-row="${i}">
      <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:8px">
        <input class="b-btn-text" maxlength="64" placeholder="Button text">
        <input class="b-btn-url" maxlength="500" placeholder="https://example.com">
      </div>
    </div>`;
}

export default {
  async render(el) {
    async function draw() {
      const past = await api.admin.broadcasts();
      el.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <div class="walletrow"><div class="dot">${"✈"}</div></div>
            <div><b style="font-size:17px">Broadcast Center</b><p class="hint">Send a polished message to your users.</p></div>
          </div>

          <label for="b-text">Message</label>
          <textarea id="b-text" maxlength="3500" placeholder="Write your announcement…"></textarea>

          <label for="b-photo">Photo URL <span style="font-weight:500">(optional)</span></label>
          <input id="b-photo" type="url" maxlength="1000" placeholder="https://example.com/image.jpg">
          <p class="hint">If added, Telegram will send the image with your message as the caption. Tapping the image opens it.</p>

          <label>Inline buttons <span style="font-weight:500">(optional)</span></label>
          <div id="button-list">${buttonRow(1)}</div>
          <button class="btn sm ghost" id="add-button" type="button" style="margin-top:8px">＋ Add button</button>
          <p class="hint">Each button opens its URL. Up to 5 buttons.</p>

          <div class="gap"></div>
          <button class="btn" id="send">Send broadcast</button>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
            <div><b>Recent broadcasts</b><p class="hint">Delivery progress from Telegram.</p></div>
            <button class="btn sm ghost" id="refresh">Refresh</button>
          </div>
          ${past.length ? past.map((b) => `
            <div class="row">
              <div style="min-width:0">
                <div class="hist-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${esc(b.text)}</div>
                <div class="hist-date">${b.photo_url ? "🖼️ Photo · " : ""}${Array.isArray(b.buttons) && b.buttons.length ? "🔗 Buttons · " : ""}${esc(fmtDate(b.date))}</div>
              </div>
              <div style="text-align:right">
                <div class="r">${b.sent}/${b.total}</div>
                <span class="badge ${b.status === "done" ? "b-ok" : b.status === "error" ? "b-err" : "b-pend"}">${b.status === "running" ? "Sending…" : b.status === "done" ? "Done" : "Error"}</span>
              </div>
            </div>`).join("") : `<div class="empty" style="padding:16px">No broadcasts yet.</div>`}
        </div>`;

      const list = el.querySelector("#button-list");
      el.querySelector("#add-button").onclick = () => {
        const count = list.querySelectorAll(".broadcast-button").length;
        if (count >= 5) return notify("You can add up to 5 buttons.");
        list.insertAdjacentHTML("beforeend", buttonRow(count + 1));
        if (count + 1 >= 5) el.querySelector("#add-button").disabled = true;
      };

      el.querySelector("#refresh").onclick = () => draw().catch(fail);
      const send = el.querySelector("#send");

      send.onclick = async () => {
        const text = el.querySelector("#b-text").value.trim();
        const photo_url = el.querySelector("#b-photo").value.trim();
        if (!text) { haptic("error"); return notify("Write a message first."); }
        if (photo_url && !/^https?:\/\//i.test(photo_url)) {
          haptic("error"); return notify("Enter a valid photo URL starting with http:// or https://.");
        }

        const buttons = [...list.querySelectorAll(".broadcast-button")].map((row) => ({
          text: row.querySelector(".b-btn-text").value.trim(),
          url: row.querySelector(".b-btn-url").value.trim()
        })).filter((b) => b.text || b.url);

        const invalid = buttons.find((b) => !b.text || !/^https?:\/\//i.test(b.url));
        if (invalid) { haptic("error"); return notify("Every button needs text and a valid https:// or http:// URL."); }

        if (!(await confirmBox("Send this broadcast to all users?"))) return;
        send.disabled = true;
        try {
          await api.admin.broadcast({ text, photo_url, buttons });
          haptic("success");
          notify("Broadcast started. The app will show delivery progress.");
          draw();
        } catch (err) {
          send.disabled = false;
          fail(err);
        }
      };
    }
    await draw();
  }
};

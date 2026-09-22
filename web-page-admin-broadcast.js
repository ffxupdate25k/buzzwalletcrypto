// Send a message to every user through the bot.
import { api } from "./web-api.js";
import { notify, confirmBox, haptic } from "./web-telegram.js";
import { esc, fmtDate, fail } from "./web-utils.js";

export default {
  async render(el) {
    async function draw() {
      const past = await api.admin.broadcasts();
      el.innerHTML = `
        <div class="card">
          <label for="b-text" style="margin-top:0">Message to all users</label>
          <textarea id="b-text" maxlength="3500" placeholder="Write your announcement…"></textarea>
          <p class="hint">Sent as a bot message to everyone who has started the bot. Users who blocked the bot are skipped.</p>
          <div class="gap"></div>
          <button class="btn" id="send">Send broadcast</button>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b>Recent broadcasts</b>
            <button class="btn sm ghost" id="refresh">Refresh</button>
          </div>
          ${past.length ? past.map((b) => `
            <div class="row">
              <div style="min-width:0">
                <div class="hist-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${esc(b.text)}</div>
                <div class="hist-date">${esc(fmtDate(b.date))}</div>
              </div>
              <div style="text-align:right">
                <div class="r">${b.sent}/${b.total}</div>
                <span class="badge ${b.status === "done" ? "b-ok" : b.status === "error" ? "b-err" : "b-pend"}">${b.status === "running" ? "Sending…" : b.status === "done" ? "Done" : "Error"}</span>
              </div>
            </div>`).join("") : `<div class="empty" style="padding:16px">No broadcasts yet.</div>`}
        </div>`;

      el.querySelector("#refresh").onclick = () => draw().catch(fail);
      const send = el.querySelector("#send");
      send.onclick = async () => {
        const text = el.querySelector("#b-text").value.trim();
        if (!text) { haptic("error"); return notify("Write a message first."); }
        if (!(await confirmBox("Send this message to all users?"))) return;
        send.disabled = true;
        try {
          await api.admin.broadcast(text);
          haptic("success");
          notify("Broadcast started. Tap Refresh to see progress.");
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

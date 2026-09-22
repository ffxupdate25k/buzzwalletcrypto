// Channels/groups every user must join before they can use the app.
import { api } from "./web-api.js";
import { notify, confirmBox, haptic } from "./web-telegram.js";
import { esc, fail } from "./web-utils.js";

export default {
  async render(el) {
    async function showList() {
      el.innerHTML = `<div class="loading">Loading…</div>`;
      const list = await api.admin.channels();
      el.innerHTML = `
        <div class="card">
          <b>Required channels</b>
          <p class="hint">Users must be in every active channel below before they can use the app. Add the bot as an admin in each one so it can check membership. Admins are never blocked.</p>
        </div>
        <button class="btn" id="new">Add channel or group</button>
        <div class="gap"></div>
        ${list.length ? list.map((c) => `
          <div class="card">
            <div class="head" style="display:flex;justify-content:space-between;gap:8px">
              <b>${esc(c.title)}</b>
              <span class="badge ${c.active ? "b-ok" : "b-pend"}">${c.active ? "Active" : "Paused"}</span>
            </div>
            <div class="hint mono">${esc(c.chat_id)}</div>
            <div class="hint">${c.bot_ok ? "✅ Bot is an admin there" : "⚠️ Bot is NOT an admin there, so users can't be verified"}</div>
            <div class="acts">
              <button class="btn sm ghost" data-act="edit" data-id="${c.id}">Edit</button>
              <button class="btn sm ghost" data-act="toggle" data-id="${c.id}">${c.active ? "Pause" : "Resume"}</button>
              <button class="btn sm danger" data-act="delete" data-id="${c.id}">Delete</button>
            </div>
          </div>`).join("") : `<div class="card empty">No required channels yet.<br>Users can enter the app freely.</div>`}`;

      el.querySelector("#new").onclick = () => showForm(null);
      el.querySelectorAll("[data-act]").forEach((b) => {
        b.onclick = async () => {
          const c = list.find((x) => String(x.id) === b.dataset.id);
          try {
            if (b.dataset.act === "edit") return showForm(c);
            if (b.dataset.act === "toggle") {
              await api.admin.updateChannel(c.id, { ...c, active: !c.active });
              return showList();
            }
            if (b.dataset.act === "delete") {
              if (!(await confirmBox(`Delete "${c.title}"?`))) return;
              await api.admin.deleteChannel(c.id);
              return showList();
            }
          } catch (err) { fail(err); }
        };
      });
    }

    function showForm(c) {
      const v = c || { title: "", chat_id: "", url: "", active: true };
      el.innerHTML = `
        <div class="card">
          <b>${c ? "Edit channel" : "Add channel or group"}</b>
          <label for="f-chat">Channel or group</label>
          <input id="f-chat" placeholder="@yourchannel" value="${esc(v.chat_id)}">
          <p class="hint">Use the @username. Private channels need their numeric ID (like -1001234567890). The bot must be an admin there.</p>
          <label for="f-title">Display name (optional)</label>
          <input id="f-title" maxlength="80" placeholder="Filled in automatically" value="${esc(v.title)}">
          <label for="f-url">Join link</label>
          <input id="f-url" type="url" placeholder="https://t.me/yourchannel" value="${esc(v.url)}">
          <p class="hint">Optional for public channels. Required for private ones (use the invite link).</p>
          <label class="check"><input type="checkbox" id="f-active" ${v.active ? "checked" : ""}> Active</label>
          <div class="gap" style="height:16px"></div>
          <button class="btn" id="save">Save</button>
          <div class="gap"></div>
          <button class="btn ghost" id="cancel">Cancel</button>
        </div>`;

      el.querySelector("#cancel").onclick = showList;
      const save = el.querySelector("#save");
      save.onclick = async () => {
        const body = {
          chat_id: el.querySelector("#f-chat").value,
          title: el.querySelector("#f-title").value,
          url: el.querySelector("#f-url").value,
          active: el.querySelector("#f-active").checked
        };
        save.disabled = true;
        try {
          if (c) await api.admin.updateChannel(c.id, body); else await api.admin.createChannel(body);
          haptic("success");
          showList();
        } catch (err) {
          save.disabled = false;
          fail(err);
        }
      };
    }

    await showList();
  }
};

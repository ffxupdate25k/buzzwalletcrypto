// Create tasks. Each task is either auto-verified (bot checks channel/group membership) or needs a screenshot.
import { api } from "./web-api.js";
import { confirmBox, haptic } from "./web-telegram.js";
import { esc, money, fail } from "./web-utils.js";

export default {
  async render(el) {
    async function showList() {
      el.innerHTML = `<div class="loading">Loading…</div>`;
      const list = await api.admin.tasks();
      el.innerHTML = `
        <button class="btn" id="new">New task</button>
        <div class="gap"></div>
        ${list.length ? list.map((t) => `
          <div class="card">
            <div class="head" style="display:flex;justify-content:space-between;gap:8px">
              <b>${esc(t.title)}</b>
              <span class="reward" style="color:var(--ok);font-weight:800">+${money(t.reward)}</span>
            </div>
            <div class="hint">${t.verify_type === "auto" ? "🤖 Auto-verify · " + esc(t.chat_id) : "📸 Screenshot review"} · ${t.completed} completed</div>
            <div class="acts">
              <span class="badge ${t.active ? "b-ok" : "b-pend"}">${t.active ? "Active" : "Paused"}</span>
              <button class="btn sm ghost" data-act="edit" data-id="${t.id}">Edit</button>
              <button class="btn sm ghost" data-act="toggle" data-id="${t.id}">${t.active ? "Pause" : "Resume"}</button>
              <button class="btn sm danger" data-act="delete" data-id="${t.id}">Delete</button>
            </div>
          </div>`).join("") : `<div class="card empty">No tasks yet.<br>Create your first task.</div>`}`;

      el.querySelector("#new").onclick = () => showForm(null);
      el.querySelectorAll("[data-act]").forEach((b) => {
        b.onclick = async () => {
          const t = list.find((x) => String(x.id) === b.dataset.id);
          try {
            if (b.dataset.act === "edit") return showForm(t);
            if (b.dataset.act === "toggle") {
              await api.admin.updateTask(t.id, { ...t, active: !t.active });
              return showList();
            }
            if (b.dataset.act === "delete") {
              if (!(await confirmBox(`Delete "${t.title}"? This also removes its submissions.`))) return;
              await api.admin.deleteTask(t.id);
              return showList();
            }
          } catch (err) { fail(err); }
        };
      });
    }

    function showForm(t) {
      const v = t || { title: "", description: "", reward: "", url: "", verify_type: "screenshot", chat_id: "", active: true };
      el.innerHTML = `
        <div class="card">
          <b>${t ? "Edit task" : "New task"}</b>
          <label for="f-title">Title</label>
          <input id="f-title" maxlength="120" value="${esc(v.title)}">
          <label for="f-desc">Description (optional)</label>
          <textarea id="f-desc" maxlength="500" style="min-height:70px">${esc(v.description)}</textarea>
          <label for="f-reward">Reward (USD)</label>
          <input id="f-reward" type="number" inputmode="decimal" step="any" value="${esc(v.reward)}">
          <label for="f-url">Link users open (optional)</label>
          <input id="f-url" type="url" placeholder="https://t.me/yourchannel" value="${esc(v.url)}">
          <label for="f-type">How is it verified?</label>
          <select id="f-type">
            <option value="screenshot">Screenshot: I review each upload</option>
            <option value="auto">Auto: bot checks channel/group membership</option>
          </select>
          <div id="auto-box">
            <label for="f-chat">Channel or group to check</label>
            <input id="f-chat" placeholder="@yourchannel" value="${esc(v.chat_id)}">
            <p class="hint">The bot must be an admin there, otherwise it can't check membership.</p>
          </div>
          <label class="check"><input type="checkbox" id="f-active" ${v.active ? "checked" : ""}> Task is active</label>
          <div class="gap" style="height:16px"></div>
          <button class="btn" id="save">Save task</button>
          <div class="gap"></div>
          <button class="btn ghost" id="cancel">Cancel</button>
        </div>`;

      const type = el.querySelector("#f-type");
      const autoBox = el.querySelector("#auto-box");
      type.value = v.verify_type;
      const sync = () => { autoBox.hidden = type.value !== "auto"; };
      type.onchange = sync;
      sync();

      el.querySelector("#cancel").onclick = showList;
      const save = el.querySelector("#save");
      save.onclick = async () => {
        const body = {
          title: el.querySelector("#f-title").value,
          description: el.querySelector("#f-desc").value,
          reward: el.querySelector("#f-reward").value,
          url: el.querySelector("#f-url").value,
          verify_type: type.value,
          chat_id: el.querySelector("#f-chat").value,
          active: el.querySelector("#f-active").checked
        };
        save.disabled = true;
        try {
          if (t) await api.admin.updateTask(t.id, body); else await api.admin.createTask(body);
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

import { api } from "./web-api.js";
import { tap, haptic, notify, openAny } from "./web-telegram.js";
import { esc, money, pageTop, fileToCompressedDataURL, fail } from "./web-utils.js";

function actionsHTML(t) {
  if (t.status === "done") return `<span class="badge b-ok">Done</span>`;
  if (t.status === "pending") return `<span class="badge b-pend">In review</span>`;
  const open = t.url ? `<button class="btn sm ghost" data-act="open" data-id="${t.id}">Open</button>` : "";
  const main = t.verify_type === "auto"
    ? `<button class="btn sm" data-act="verify" data-id="${t.id}">Verify</button>`
    : `<button class="btn sm" data-act="upload" data-id="${t.id}">${t.status === "rejected" ? "Send again" : "Upload screenshot"}</button>`;
  return open + main;
}

function rowHTML(t) {
  return `
    <div class="task">
      <div class="head"><b>${esc(t.title)}</b><span class="reward">+${money(t.reward)}</span></div>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ""}
      ${t.status === "rejected" ? `<p class="note err">Your last screenshot was rejected. You can send a new one.</p>` : ""}
      <div class="acts">${actionsHTML(t)}</div>
    </div>`;
}

function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export default {
  async render(el) {
    let tasks = await api.getTasks();

    el.innerHTML = `
      <section class="page">
        ${pageTop("Task", "Complete tasks to earn rewards")}
        <div class="body"><div class="card" id="list"></div></div>
      </section>`;
    const list = el.querySelector("#list");
    const draw = () => {
      list.innerHTML = tasks.length ? tasks.map(rowHTML).join("") : `<div class="empty">No tasks right now.<br>Check back soon.</div>`;
    };
    const reload = async () => { tasks = await api.getTasks(); draw(); };
    draw();

    list.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const task = tasks.find((x) => x.id === id);
      if (!task) return;
      tap();
      try {
        if (btn.dataset.act === "open") return openAny(task.url);

        if (btn.dataset.act === "verify") {
          btn.disabled = true;
          const r = await api.claimTask(id);
          haptic("success");
          notify(`Task complete! You earned ${money(r.reward)}.`);
          return reload();
        }

        if (btn.dataset.act === "upload") {
          const file = await pickImage();          // must stay the first await (needs the tap)
          if (!file) return;
          btn.disabled = true;
          const image = await fileToCompressedDataURL(file);
          await api.submitProof(id, image);
          haptic("success");
          notify("Screenshot sent! You'll get a message when it's reviewed.");
          return reload();
        }
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    });
  }
};

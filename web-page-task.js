import { api } from "./web-api.js";
import { tap, haptic, notify, openAny } from "./web-telegram.js";
import { esc, money, pageTop, fail } from "./web-utils.js";

// Active countdown timers, keyed by task id, so a re-render or reload never leaves two
// timers running for the same task.
const timers = new Map();
function stopTimer(id) {
  const t = timers.get(id);
  if (t) { clearInterval(t); timers.delete(id); }
}

function actionsHTML(t) {
  if (t.status === "done") return `<span class="badge b-ok">Done</span>`;
  if (t.status === "pending") {
    if (t.verify_type === "timer") return `<span class="badge b-pend" id="cd-${t.id}">Claiming in ${t.remaining_seconds}s…</span>`;
    return `<span class="badge b-pend">In review</span>`;
  }
  const open = t.url ? `<button class="btn sm ghost" data-act="open" data-id="${t.id}">Open</button>` : "";
  if (t.verify_type === "auto") return open + `<button class="btn sm" data-act="verify" data-id="${t.id}">Verify</button>`;
  return `<button class="btn sm" data-act="start" data-id="${t.id}">Start task</button>`;
}

function rowHTML(t) {
  return `
    <div class="task">
      <div class="head"><b>${esc(t.title)}</b><span class="reward">+${money(t.reward)}</span></div>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ""}
      <div class="acts">${actionsHTML(t)}</div>
    </div>`;
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
      tasks.filter((t) => t.status === "pending" && t.verify_type === "timer").forEach(startCountdown);
    };
    const reload = async () => { tasks.forEach((t) => stopTimer(t.id)); tasks = await api.getTasks(); draw(); };
    draw();

    // Ticks a task's badge down to 0, then claims the reward automatically.
    function startCountdown(t) {
      stopTimer(t.id);
      let remaining = t.remaining_seconds;
      const badge = () => list.querySelector(`#cd-${t.id}`);
      timers.set(t.id, setInterval(async () => {
        remaining -= 1;
        const el2 = badge();
        if (remaining > 0) {
          if (el2) el2.textContent = `Claiming in ${remaining}s…`;
          return;
        }
        stopTimer(t.id);
        if (el2) el2.textContent = "Claiming…";
        try {
          const r = await api.claimTask(t.id);
          haptic("success");
          notify(`Task complete! You earned ${money(r.reward)}.`);
          reload();
        } catch (err) {
          fail(err);
          reload(); // pull fresh state (and a corrected remaining_seconds) rather than getting stuck
        }
      }, 1000));
    }

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

        if (btn.dataset.act === "start") {
          btn.disabled = true;
          if (task.url) openAny(task.url);
          const r = await api.startTask(id);
          task.status = "pending";
          task.remaining_seconds = r.remaining_seconds;
          draw();
        }
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    });
  }
};

// Admin panel shell: a scrollable tab bar and one page per tab.
import { pageTop, esc } from "./web-utils.js";
import overview  from "./web-page-admin-overview.js";
import settings  from "./web-page-admin-settings.js";
import channels  from "./web-page-admin-channels.js";
import tasks     from "./web-page-admin-tasks.js";
import payouts   from "./web-page-admin-payouts.js";
import users     from "./web-page-admin-users.js";
import broadcast from "./web-page-admin-broadcast.js";

const TABS = [
  { id: "overview",  label: "Overview",    page: overview },
  { id: "settings",  label: "Settings",    page: settings },
  { id: "channels",  label: "Channels",    page: channels },
  { id: "tasks",     label: "Tasks",       page: tasks },
  { id: "payouts",   label: "Withdrawals", page: payouts },
  { id: "users",     label: "Users",       page: users },
  { id: "broadcast", label: "Broadcast",   page: broadcast }
];

let lastTab = "overview";

export default {
  async render(el) {
    el.innerHTML = `
      <section class="page">
        ${pageTop("Admin panel", "Manage rewards, channels, tasks, payouts and users")}
        <div class="tabs">${TABS.map((t) => `<button class="tab" data-tab="${t.id}">${t.label}</button>`).join("")}</div>
        <div class="body" id="panel"></div>
      </section>`;

    const panel = el.querySelector("#panel");
    const buttons = el.querySelectorAll(".tab");

    async function open(id) {
      lastTab = id;
      buttons.forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
      const box = document.createElement("div"); // fresh container so a slow, old tab can't overwrite a newer one
      box.innerHTML = `<div class="loading">Loading…</div>`;
      panel.replaceChildren(box);
      try {
        await TABS.find((t) => t.id === id).page.render(box);
      } catch (err) {
        if (err.gate) return window.dispatchEvent(new Event("bw:gate"));
        box.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
      }
    }

    buttons.forEach((b) => { b.onclick = () => open(b.dataset.tab); });
    open(lastTab);
  }
};

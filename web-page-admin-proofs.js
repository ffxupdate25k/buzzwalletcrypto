// Screenshot submissions waiting for review.
import { api } from "./web-api.js";
import { confirmBox, haptic, notify } from "./web-telegram.js";
import { esc, money, fmtDate, fail } from "./web-utils.js";

async function viewImage(id) {
  const blob = await api.admin.submissionImage(id);
  const url = URL.createObjectURL(blob);
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<img src="${url}" alt="Screenshot"><span>Tap anywhere to close</span>`;
  modal.onclick = () => { URL.revokeObjectURL(url); modal.remove(); };
  document.body.appendChild(modal);
}

export default {
  async render(el) {
    async function showList() {
      const list = await api.admin.submissions();
      el.innerHTML = list.length ? list.map((s) => `
        <div class="card">
          <div class="head" style="display:flex;justify-content:space-between;gap:8px">
            <b>${esc(s.task_title)}</b>
            <span style="color:var(--ok);font-weight:800">+${money(s.reward)}</span>
          </div>
          <div class="hint">${esc(s.name)}${s.username ? " · @" + esc(s.username) : ""} · ID ${esc(s.user_id)}</div>
          <div class="hint">${esc(fmtDate(s.date))}</div>
          <div class="acts">
            <button class="btn sm ghost" data-act="view" data-id="${s.id}">View</button>
            <button class="btn sm" data-act="approve" data-id="${s.id}">Approve</button>
            <button class="btn sm danger" data-act="reject" data-id="${s.id}">Reject</button>
          </div>
        </div>`).join("") : `<div class="card empty">Nothing to review right now.</div>`;

      el.querySelectorAll("[data-act]").forEach((b) => {
        b.onclick = async () => {
          const id = Number(b.dataset.id);
          try {
            if (b.dataset.act === "view") return await viewImage(id);
            if (b.dataset.act === "reject" && !(await confirmBox("Reject this screenshot?"))) return;
            b.disabled = true;
            if (b.dataset.act === "approve") await api.admin.approveSubmission(id);
            if (b.dataset.act === "reject") await api.admin.rejectSubmission(id);
            haptic("success");
            showList();
          } catch (err) {
            b.disabled = false;
            fail(err);
            if (err.status === 404) showList();
          }
        };
      });
    }
    await showList();
  }
};

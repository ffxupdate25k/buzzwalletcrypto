import { notify, haptic } from "./web-telegram.js";

export function money(n) {
  const v = Number(n);
  const two = v.toFixed(2);
  return "$" + (Number(two) === v ? two : v.toFixed(4).replace(/0+$/, ""));
}

// Escapes text for safe use inside HTML (including attributes).
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function shortAddr(a) {
  return a ? String(a).slice(0, 6) + "…" + String(a).slice(-4) : "";
}

export function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function avatarHTML(user, name) {
  if (user.photo_url) return `<img src="${esc(user.photo_url)}" alt="">`;
  return esc(name.charAt(0).toUpperCase());
}

export function pageTop(title, subtitle) {
  return `<div class="top"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>`;
}

export function statusBadge(status) {
  const map = {
    completed: ["Completed", "b-ok"], approved: ["Approved", "b-ok"], paid: ["Paid", "b-ok"],
    pending: ["Pending", "b-pend"], rejected: ["Rejected", "b-err"]
  };
  const [label, cls] = map[status] || [status, "b-pend"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// Shrinks a screenshot before upload so it is fast on mobile data.
export function fileToCompressedDataURL(file, max = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });
}

// One place to report an error to the user. If the server says the user is no longer in the
// required channels, the join screen is shown again instead.
export function fail(err) {
  if (err && err.gate) { window.dispatchEvent(new Event("bw:gate")); return; }
  haptic("error");
  notify((err && err.message) || "Something went wrong.");
}

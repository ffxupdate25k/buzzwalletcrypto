// The only file that talks to the server. Pages call `api.*` and never fetch directly.
// Every request carries Telegram's initData; the server verifies it.
import { CONFIG } from "./web-config.js";
import { tg } from "./web-telegram.js";

const authHeader = () => ({ Authorization: "tma " + tg.initData });

async function http(path, method = "GET", body) {
  let res;
  try {
    res = await fetch(CONFIG.API_BASE + path, {
      method,
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error("No connection. Check your internet and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed (" + res.status + ")");
    err.status = res.status;
    err.gate = !!data.gate; // true when the user must join the required channels
    throw err;
  }
  return data;
}

const post = (path, body) => http(path, "POST", body === undefined ? {} : body);

export const api = {
  getGate:           ()        => http("/api/gate"),
  getMe:             ()        => http("/api/me"),
  getHistory:        ()        => http("/api/history"),
  getReferrals:      ()        => http("/api/referrals"),
  getTasks:          ()        => http("/api/tasks"),
  claimTask:         (id)      => post(`/api/tasks/${id}/claim`),
  startTask:         (id)      => post(`/api/tasks/${id}/start`),
  saveWallet:        (address) => post("/api/wallet", { address }),
  requestWithdrawal: (payload) => post("/api/withdrawals", payload),

  admin: {
    overview:          ()          => http("/api/admin/overview"),
    getSettings:       ()          => http("/api/admin/settings"),
    saveSettings:      (s)         => http("/api/admin/settings", "PUT", s),

    channels:          ()          => http("/api/admin/channels"),
    createChannel:     (c)         => post("/api/admin/channels", c),
    updateChannel:     (id, c)     => http(`/api/admin/channels/${id}`, "PUT", c),
    deleteChannel:     (id)        => http(`/api/admin/channels/${id}`, "DELETE"),

    tasks:             ()          => http("/api/admin/tasks"),
    createTask:        (t)         => post("/api/admin/tasks", t),
    updateTask:        (id, t)     => http(`/api/admin/tasks/${id}`, "PUT", t),
    deleteTask:        (id)        => http(`/api/admin/tasks/${id}`, "DELETE"),

    withdrawals:       (status)    => http(`/api/admin/withdrawals?status=${encodeURIComponent(status)}`),
    sendWithdrawal:    (id)        => post(`/api/admin/withdrawals/${id}/send`),
    payWithdrawal:     (id)        => post(`/api/admin/withdrawals/${id}/paid`),
    rejectWithdrawal:  (id)        => post(`/api/admin/withdrawals/${id}/reject`),

    users:             (q)         => http(`/api/admin/users?q=${encodeURIComponent(q || "")}`),
    adjustBalance:     (id, amount, note) => post(`/api/admin/users/${id}/balance`, { amount, note }),
    resetWallet:       (id)        => post(`/api/admin/users/${id}/wallet/reset`),

    broadcast:         (text)      => post("/api/admin/broadcast", { text }),
    broadcasts:        ()          => http("/api/admin/broadcasts")
  }
};

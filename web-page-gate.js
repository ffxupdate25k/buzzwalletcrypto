// Full-screen "join our channels" step. Users can't get past it until the server confirms membership.
import { api } from "./web-api.js";
import { openAny, haptic, notify, tap } from "./web-telegram.js";
import { icons } from "./web-icons.js";
import { esc } from "./web-utils.js";

export default {
  render(el, { gate, onPass }) {
    let channels = gate.channels;

    function draw() {
      el.innerHTML = `
        <section class="page">
          <div class="gate-hero">
            <div class="lock">${icons.lock}</div>
            <h1>Join to continue</h1>
            <p>Join all the channels below to unlock Buzz Wallet.</p>
          </div>
          <div class="body">
            <div class="card">
              ${channels.map((c) => `
                <div class="row">
                  <div>
                    <b style="font-size:15px">${esc(c.title)}</b>
                    <div class="hist-date">${c.joined ? "✅ Joined" : c.error ? "⚠️ Can't check right now" : "Not joined yet"}</div>
                  </div>
                  ${c.joined ? "" : `<button class="btn sm ghost" data-join="${c.id}">Join</button>`}
                </div>`).join("")}
            </div>
            <button class="btn" id="verify">I've joined — Verify</button>
          </div>
        </section>`;

      el.querySelectorAll("[data-join]").forEach((b) => {
        b.onclick = () => {
          tap();
          const ch = channels.find((x) => String(x.id) === b.dataset.join);
          if (ch && ch.url) openAny(ch.url);
        };
      });

      const verify = el.querySelector("#verify");
      verify.onclick = async () => {
        verify.disabled = true;
        verify.textContent = "Checking…";
        try {
          const res = await api.getGate();
          if (res.passed) { haptic("success"); return onPass(); }
          channels = res.channels;
          haptic("error");
          draw();
          notify(channels.some((c) => c.error && !c.joined)
            ? "We couldn't check one of the channels. Please try again in a moment."
            : "You haven't joined all the channels yet.");
        } catch (err) {
          verify.disabled = false;
          verify.textContent = "I've joined — Verify";
          notify(err.message);
        }
      };
    }
    draw();
  }
};

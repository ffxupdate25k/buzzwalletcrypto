import { api } from "./web-api.js";
import { pageTop, esc, fail } from "./web-utils.js";
import { haptic, notify } from "./web-telegram.js";

export default {
 async render(el) {
  async function draw(){
   const msgs=await api.supportMessages();
   el.innerHTML=`<section class="page">${pageTop("Customer Service","Chat with our support team")}<div class="support-card"><div id="support-thread">${msgs.length?msgs.map(m=>`<div class="support-msg ${m.sender==='user'?'mine':'theirs'}"><div>${esc(m.body)}</div><small>${new Date(m.date).toLocaleString([], {hour:'2-digit',minute:'2-digit'})}</small></div>`).join(''):`<div class="empty">Send us a message and our admins will reply here.</div>`}</div><div class="support-compose"><textarea id="support-input" maxlength="2000" placeholder="Write your message..."></textarea><button class="btn" id="support-send">Send</button></div></div></section>`;
   const thread=el.querySelector('#support-thread'); thread.scrollTop=thread.scrollHeight;
   el.querySelector('#support-send').onclick=async()=>{const input=el.querySelector('#support-input'), body=input.value.trim();if(!body)return; const b=el.querySelector('#support-send');b.disabled=true;try{await api.sendSupportMessage(body);input.value='';haptic('success');await draw();}catch(e){fail(e)}finally{b.disabled=false}};
  }
  await draw();
 }
};

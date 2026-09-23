import { api } from "./web-api.js";
import { pageTop, esc, fail } from "./web-utils.js";
import { haptic } from "./web-telegram.js";

export default {
 async render(el) {
  async function draw(){
   const msgs=await api.supportMessages();
   el.innerHTML=`<section class="page support-page">${pageTop("Customer Service","Chat privately with our support team")}<div class="wa-chat"><div class="wa-thread" id="support-thread">${msgs.length?msgs.map(m=>`<div class="support-msg ${m.sender==='user'?'mine':'theirs'}"><div>${esc(m.body)}</div><small>${new Date(m.date).toLocaleString([], {hour:'2-digit',minute:'2-digit'})}</small></div>`).join(''):`<div class="support-empty"><div class="support-empty-icon">💬</div><b>Start a conversation</b><span>Send a message to customer service. Our admins will reply here.</span></div>`}</div><div class="wa-compose"><button class="wa-plus" type="button" aria-label="More">＋</button><div class="wa-input-wrap"><textarea id="support-input" maxlength="2000" rows="1" placeholder="Message"></textarea></div><button class="wa-send" id="support-send" type="button" aria-label="Send">➤</button></div></div></section>`;
   const thread=el.querySelector('#support-thread'); thread.scrollTop=thread.scrollHeight;
   const input=el.querySelector('#support-input');
   const resize=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px'};
   input.addEventListener('input',resize); input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();el.querySelector('#support-send').click()}}); resize();
   el.querySelector('#support-send').onclick=async()=>{const body=input.value.trim();if(!body)return; const b=el.querySelector('#support-send');b.disabled=true;try{await api.sendSupportMessage(body);input.value='';haptic('success');await draw();}catch(e){fail(e)}finally{b.disabled=false}};
  }
  await draw();
 }
};

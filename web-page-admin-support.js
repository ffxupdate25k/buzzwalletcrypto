import { api } from "./web-api.js";
import { esc, pageTop, fail } from "./web-utils.js";
import { haptic, notify } from "./web-telegram.js";

export default {
 async render(el){
  let selected=null;
  async function list(){
   const rows=await api.admin.supportConversations();
   el.innerHTML=`<section class="page">${pageTop("Customer Service","Messages from users")}<div id="support-admin-list">${rows.length?rows.map(u=>`<button class="support-user" data-id="${esc(u.id)}"><span class="avatar-mini">${esc((u.name||'U').charAt(0).toUpperCase())}</span><span><b>${esc(u.name)}</b><small>${u.username?'@'+esc(u.username)+' · ':''}ID ${esc(u.id)}</small><em>${esc(u.last_message||'')}</em></span>${u.unread?`<strong>${u.unread}</strong>`:''}</button>`).join(''):`<div class="card empty">No customer messages yet.</div>`}</div></section>`;
   el.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>open(b.dataset.id));
  }
  async function open(id){
   selected=id; const data=await api.admin.supportConversation(id);
   el.innerHTML=`<section class="page">${pageTop(data.user.name, data.user.username?'@'+data.user.username+' · Telegram ID '+data.user.id:'Telegram ID '+data.user.id)}<div class="support-card"><div id="admin-thread">${data.messages.map(m=>`<div class="support-msg ${m.sender==='admin'?'mine':'theirs'}"><div>${esc(m.body)}</div><small>${new Date(m.date).toLocaleString([], {dateStyle:'short',timeStyle:'short'})}</small></div>`).join('')}</div><div class="support-compose"><textarea id="admin-input" maxlength="2000" placeholder="Reply to this user..."></textarea><button class="btn" id="admin-send">Reply</button></div><button class="btn ghost" id="support-back">Back to conversations</button></div></section>`;
   const th=el.querySelector('#admin-thread');th.scrollTop=th.scrollHeight;
   el.querySelector('#admin-send').onclick=async()=>{const input=el.querySelector('#admin-input'),body=input.value.trim();if(!body)return;const b=el.querySelector('#admin-send');b.disabled=true;try{await api.admin.replySupport(id,body);haptic('success');await open(id)}catch(e){fail(e)}finally{b.disabled=false}};
   el.querySelector('#support-back').onclick=list;
  }
  await list();
 }
};

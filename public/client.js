// public/client.js (accounts, stats, equities, outs, phased streets)
// (Keeps previous features: sit-out, fireworks, final results modal, chat)

const socket = io();
socket.on("connect", ()=>console.log("[socket] connected", socket.id));
socket.on("connect_error", err=>{ console.error(err); alert("Socket connection issue."); });
socket.on("disconnect", r=>console.warn("[socket] disconnected", r));

const el = id => document.getElementById(id);
const intro = el("intro"), lobby=el("lobby"), selecting=el("selecting"), revealed=el("revealed"), results=el("results");
const chatBox=el("chat"), chatLog=el("chatLog"), chatInput=el("chatInput");
const handBadge=el("handBadge"), roomBadge=el("roomBadge"), scoopOverlay=el("scoopOverlay");
const finalModal=el("finalModal"), finalTable=el("finalTable");
const sHands=el("sHands"), sNet=el("sNet"), sScoops=el("sScoops"), sHE=el("sHE"), sPLO=el("sPLO");

function show(v){ [intro,lobby,selecting,revealed,results].forEach(x=>x.classList.add("hidden")); v.classList.remove("hidden"); chatBox.classList.remove("hidden"); }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }

const LS_TOKEN_KEY="peanutsToken", LS_ROOM_KEY="peanutsRoom", LS_JWT="peanutsJWT";
function saveIdentity(token, room){ try{localStorage.setItem(LS_TOKEN_KEY, token); localStorage.setItem(LS_ROOM_KEY, room);}catch{} }
function clearIdentity(){ try{localStorage.removeItem(LS_TOKEN_KEY); localStorage.removeItem(LS_ROOM_KEY);}catch{} }
function getIdentity(){ try{ return { token:localStorage.getItem(LS_TOKEN_KEY), room:localStorage.getItem(LS_ROOM_KEY) }; }catch{ return {}; } }
function setJWT(t){ try{ localStorage.setItem(LS_JWT, t);}catch{} }
function getJWT(){ try{ return localStorage.getItem(LS_JWT);}catch{ return null; } }
function clearJWT(){ try{ localStorage.removeItem(LS_JWT);}catch{} }

function setBadges(roomCode, handNumber){ if(roomBadge) roomBadge.textContent = roomCode?`Room ${roomCode}`:''; if(handBadge) handBadge.textContent = handNumber?`Hand #${handNumber}`:''; }

/* ---- Auth UI ---- */
async function api(path, opts={}){
  const headers = {'Content-Type':'application/json'};
  const tok = getJWT(); if (tok) headers['Authorization'] = `Bearer ${tok}`;
  const r = await fetch(path, { method:opts.method||'GET', headers, body: opts.body?JSON.stringify(opts.body):undefined });
  return r.json();
}
async function refreshStats(){
  const res = await api('/api/my-stats'); if(!res?.ok) { sHands.textContent='0'; sNet.textContent='0'; sScoops.textContent='0'; sHE.textContent='0'; sPLO.textContent='0'; return; }
  const st = res.stats||{};
  sHands.textContent = st.hands_played||0;
  sNet.textContent = (st.total_net>=0?'+':'') + Number(st.total_net||0).toFixed(2);
  sScoops.textContent = st.scoops||0;
  sHE.textContent = st.he_wins||0;
  sPLO.textContent = st.plo_wins||0;
}
el("loginBtn").onclick = async ()=>{
  const username = el("loginUser").value.trim(), password=el("loginPass").value;
  if (!username || !password) return alert("Enter username and password");
  const res = await api('/api/login', { method:'POST', body:{ username, password }});
  if (!res?.ok) return alert(res?.error||'Login failed');
  setJWT(res.token); await refreshStats(); alert(`Welcome back, ${res.username}!`);
};
el("regBtn").onclick = async ()=>{
  const username = el("regUser").value.trim(), password=el("regPass").value;
  if (!username || !password) return alert("Enter username and password");
  const res = await api('/api/register', { method:'POST', body:{ username, password }});
  if (!res?.ok) return alert(res?.error||'Register failed');
  setJWT(res.token); await refreshStats(); alert(`Account created. Welcome, ${res.username}!`);
};
el("logoutBtn").onclick = ()=>{ clearJWT(); refreshStats(); alert("Logged out."); };

/* ---- Cards ---- */
function cardChip(card){
  const r=card[0]?.toUpperCase(), s=card[1]?.toLowerCase();
  const rp=(r==='T'?'10':r), sym=({c:'♣',d:'♦',h:'♥',s:'♠'}[s]||'?'); const red=(s==='h'||s==='d');
  const svg=`
   <svg class="cardsvg" viewBox="0 0 200 280" role="img" aria-label="${rp}${sym}">
     <rect x="2" y="2" width="196" height="276" rx="16" ry="16" fill="white" stroke="#333" stroke-width="4"/>
     <g transform="translate(14,28)" class="${red?'red':'black'}"><text class="rank small corner" x="0" y="0">${rp}</text><text class="corner" x="0" y="28" style="font:700 24px/1 'Segoe UI Symbol'">${sym}</text></g>
     <g transform="translate(186,252) rotate(180)" class="${red?'red':'black'}"><text class="rank small corner" x="0" y="0">${rp}</text><text class="corner" x="0" y="28" style="font:700 24px/1 'Segoe UI Symbol'">${sym}</text></g>
     <g class="${red?'red':'black'}"><text class="suit center" x="100" y="160" text-anchor="middle">${sym}</text></g>
   </svg>`;
  const d=document.createElement('div'); d.className='cardchip'; d.setAttribute('data-card',card); d.innerHTML=svg; return d;
}

/* ---- State ---- */
const state={ room:null, token:null, you:null, yourCards:[], pickH:new Set(), pickP:new Set() };

/* ---- Rendering ---- */
function renderPlayers(players=[]){
  const c=el("players"); c.innerHTML='';
  players.forEach(p=>{
    const row=document.createElement('div'); row.className='playerRow';
    const bal=Number(p.balance||0), balStr=(bal>=0?'+':'')+bal.toFixed(2);
    row.innerHTML = `
      <div>
        <span class="namechip">${escapeHtml(p.name)}</span>
        ${p.isHost?'<span class="badge">Host</span>':''}
        ${p.present?'':'<span class="badge">Away</span>'}
        ${p.sitOut?'<span class="badge warn">Sitting Out</span>':''}
        ${p.locked?'<span class="badge">Locked</span>':''}
      </div>
      <div class="${bal>=0?'positive':'negative'} mono">${balStr}</div>`;
    c.appendChild(row);
  });
}
function renderBoard(id,cards){ const c=el(id); c.innerHTML=''; (cards||[]).forEach(x=>c.appendChild(cardChip(x))); }
function renderHand(cards){
  const c=el("yourHand"); c.innerHTML='';
  (cards||[]).forEach(card=>{
    const chip=cardChip(card);
    chip.addEventListener('click',()=>toggleSelection(card));
    if(state.pickH.has(card)||state.pickP.has(card)) chip.classList.add('selected');
    c.appendChild(chip);
  });
}
function renderPickBoxes(){
  const h=el("pickHoldem"), p=el("pickPLO"); h.innerHTML=''; p.innerHTML='';
  Array.from(state.pickH).forEach(c=>h.appendChild(cardChip(c)));
  Array.from(state.pickP).forEach(c=>p.appendChild(cardChip(c)));
}

function toggleSelection(card){
  const inH=state.pickH.has(card), inP=state.pickP.has(card);
  if(!inH && !inP){ if(state.pickH.size<2) state.pickH.add(card); else if(state.pickP.size<4) state.pickP.add(card); else return; }
  else if(inH) state.pickH.delete(card);
  else if(inP) state.pickP.delete(card);
  renderHand(state.yourCards); renderPickBoxes();
}

/* ---- Join flow ---- */
function normRoom(s){ return (s||'').toUpperCase().trim(); }
function isValidRoom(s){ return /^[A-Z0-9]{3,8}$/.test(s); }

el("joinBtn").onclick = ()=>{
  const room=normRoom(el("room").value), name=(el("name").value||'Player').trim();
  if(!isValidRoom(room)) return alert('Room code must be 3–8 letters/numbers');
  const joinBtn=el("joinBtn"); joinBtn.disabled=true; joinBtn.textContent='Joining…';
  const { token:existingToken } = getIdentity();
  const authToken = getJWT();
  socket.emit('joinRoom', { roomCode:room, name, token:existingToken, authToken }, (res)=>{
    joinBtn.disabled=false; joinBtn.textContent='Join';
    if(!res?.ok) return alert(res?.error||'Join failed');
    state.room=room; state.token=res.token; state.you=res.name; saveIdentity(res.token, room);
    setBadges(room, 0); show(lobby);
    refreshStats().catch(()=>{});
  });
};

el("logoutBtn").onclick = ()=>{ clearJWT(); refreshStats(); };

// Sit out / controls
el("sitBtn").onclick = ()=>{
  const btn=el("sitBtn"); const on=btn.getAttribute('data-on')==='1'; socket.emit('toggleSitOut', !on);
};
el("setAnte").onclick = ()=>{ const v=Number(el("anteInput").value)||0; socket.emit('setAnte', v); };
el("startBtn").onclick = ()=> socket.emit('startHand');
el("nextBtn").onclick = ()=> socket.emit('nextHand');

const termBtn = document.getElementById('terminateBtn');
if(termBtn) termBtn.onclick = ()=>{ if(confirm('Terminate table?')) socket.emit('terminateTable'); };

// Auto-rejoin
window.addEventListener('load', ()=>{
  refreshStats().catch(()=>{});
  const { token, room } = getIdentity();
  if(token && room && isValidRoom(room)){
    const roomInput=el("room"); if(roomInput) roomInput.value=room;
    socket.emit('joinRoom', { roomCode:room, name:'', token, authToken:getJWT() }, (res)=>{
      if(res?.ok){ state.room=room; state.token=res.token; state.you=res.name; setBadges(room,0); show(lobby); }
      else show(intro);
    });
  } else show(intro);
});

/* ---- Socket events ---- */
socket.on('roomUpdate', data=>{
  setBadges(getIdentity().room, data.handNumber||0);
  renderPlayers(data.players);
  el("anteInput").value = data.ante||0;

  // reflect sit-out
  const me=(data.players||[]).find(p=>p.id===state.token);
  const sitBtn=el("sitBtn");
  if(sitBtn){ const s=!!me?.sitOut; sitBtn.textContent=s?'Return to Play':'Sit Out'; sitBtn.setAttribute('data-on', s?'1':'0'); }

  // live board (revealed/results)
  if (data.stage==='revealed' || data.stage==='results') {
    renderBoard('board', data.board||[]);
    // equities/outs HUD
    renderEquities('equitiesHE','Hold’em', data.equities?.he, data.players||[]);
    renderEquities('equitiesPLO','PLO', data.equities?.plo, data.players||[]);
    renderOuts('outsHE', data.outs?.he);
    renderOuts('outsPLO', data.outs?.plo);
  }

  if (data.stage==='lobby') show(lobby);
  else if (data.stage==='selecting') show(selecting);
  else if (data.stage==='revealed') show(revealed);
  else if (data.stage==='results') show(results);
});

socket.on('streetUpdate', payload=>{
  // Optional: could animate between streets; roomUpdate already carries equities/outs
});

socket.on('yourCards', ({cards})=>{
  state.yourCards=cards||[]; state.pickH=new Set(); state.pickP=new Set();
  renderHand(state.yourCards); renderPickBoxes(); show(selecting);
});

socket.on('results', payload=>{
  setBadges(getIdentity().room, payload.handNumber||0);
  renderBoard('finalBoard', payload.board||[]);
  const winnersDiv=el("winners");
  const nameOf = sid=> payload.picks[sid]?.name || sid;
  const holdemNames=(payload.winners?.holdem||[]).map(nameOf).join(', ');
  const ploNames=(payload.winners?.plo||[]).map(nameOf).join(', ');
  const scoopNames=(payload.scoops||[]).map(nameOf).join(', ');
  let html = `<p><strong>Hold’em:</strong> ${escapeHtml(holdemNames||'-')}</p>
              <p><strong>PLO:</strong> ${escapeHtml(ploNames||'-')}</p>`;
  if(payload.scoops && payload.scoops.length){
    html += `<p>💥 SCOOP by ${escapeHtml(scoopNames)}</p>`;
    launchScoopFireworks(scoopNames);
  }
  winnersDiv.innerHTML = html;
  show(results);
});

socket.on('finalResults', ({handNumber, ante, players})=>{
  finalTable.innerHTML='';
  const hdr=document.createElement('div'); hdr.className='finalRow finalHeader'; hdr.innerHTML='<div>Player</div><div class="mono">Balance</div>'; finalTable.appendChild(hdr);
  players.forEach(p=>{
    const row=document.createElement('div'); row.className='finalRow';
    const bal=(p.balance>=0?'+':'') + Number(p.balance||0).toFixed(2);
    row.innerHTML = `<div>${escapeHtml(p.name)}</div><div class="mono ${p.balance>=0?'positive':'negative'}">${bal}</div>`;
    finalTable.appendChild(row);
  });
  el("finalTitle").textContent = `Final Results — ${getIdentity().room||''} (Hands: ${handNumber||0})`;
  finalModal.classList.add('show');
});
socket.on('terminated', ()=>{ clearIdentity(); /* keep modal */ });

/* Chat */
socket.on('chatBacklog', (msgs=[])=>{ chatLog.innerHTML=''; msgs.forEach(addChatLine); });
socket.on('chatMessage', msg=>addChatLine(msg));
function addChatLine(msg){
  const d=document.createElement('div'); d.className='chatmsg' + (msg.system?' system':'');
  const who = msg.system ? '🛈' : escapeHtml(msg.from||'Unknown');
  const text=escapeHtml(msg.text||''); const time=new Date(msg.ts||Date.now()).toLocaleTimeString();
  d.innerHTML = `<span class="who">${who}</span> <span class="t">${text}</span> <span class="mono" style="opacity:.6;float:right">${time}</span>`;
  chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight;
}
el("chatSend").onclick = ()=>sendChat();
chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });
function sendChat(){ const t=(chatInput.value||'').trim(); if(!t) return; socket.emit('chatMessage', t); chatInput.value=''; }

/* Equities / Outs renderers */
function renderEquities(targetId, label, eqMap, players){
  const box=el(targetId); box.innerHTML='';
  if(!eqMap) return;
  players.forEach(p=>{
    const eq = eqMap[p.id] || { win:0, tie:0 };
    const row=document.createElement('div'); row.className='eqrow';
    row.innerHTML = `<div class="name">${escapeHtml(p.name)}</div>
                     <div class="val mono">${eq.win.toFixed(1)}% win &nbsp; ${eq.tie.toFixed(1)}% tie</div>`;
    box.appendChild(row);
  });
}
function renderOuts(targetId, outMap){
  const box=el(targetId); box.innerHTML='';
  if(!outMap) return;
  for(const [pid, arr] of Object.entries(outMap)){
    const row=document.createElement('div'); row.className='outrow';
    row.appendChild(Object.assign(document.createElement('span'),{textContent:'Outs:'}));
    (arr||[]).slice(0,18).forEach(c=>{
      const tag=document.createElement('span'); tag.className='outcard'; tag.textContent=c;
      row.appendChild(tag);
    });
    // append as block
    const wrap=document.createElement('div');
    const nameSpan=document.createElement('div'); nameSpan.textContent = `For ${((window._playersCache||[]).find(p=>p.id===pid)||{}).name || pid}:`;
    box.appendChild(nameSpan); box.appendChild(row);
  }
}

/* Fireworks */
function launchScoopFireworks(name){
  el("scoopTitle").textContent = `SCOOP by: ${name}!`;
  scoopOverlay.classList.add('show');
  setTimeout(()=>scoopOverlay.classList.remove('show'), 3500);
}

/* Lock / Next */
el("lockBtn").onclick = ()=>{
  if(state.pickH.size!==2 || state.pickP.size!==4) return alert("Pick 2 for Hold’em and 4 for PLO.");
  socket.emit('makeSelections', { holdemTwo:Array.from(state.pickH), ploFour:Array.from(state.pickP) }, res=>{ if(!res?.ok) alert(res?.error||'Could not lock'); });
};
el("finalClose").onclick = ()=>{ finalModal.classList.remove('show'); show(intro); };

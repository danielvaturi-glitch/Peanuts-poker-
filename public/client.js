// public/client.js — shows locked hands on Results & marks river winners as 100%.

const socket = io();
socket.on("connect", ()=>console.log("[socket] connected", socket.id));
socket.on("connect_error", err=>{ console.error("[socket connect_error]", err); });
socket.on("disconnect", r=>console.warn("[socket] disconnected", r));

const el=id=>document.getElementById(id);
const intro=el("intro"), lobby=el("lobby"), selecting=el("selecting"), revealed=el("revealed"), results=el("results");
const chatBox=el("chat"), chatLog=el("chatLog"), chatInput=el("chatInput");
const handBadge=el("handBadge"), roomBadge=el("roomBadge");
const finalModal=el("finalModal"), finalTable=el("finalTable");
const revealBtn=el("revealBtn");
const countdownEl=el("countdown"), lockStatus=el("lockStatus");

function show(v){ [intro,lobby,selecting,revealed,results].forEach(x=>x.classList.add("hidden")); v.classList.remove("hidden"); chatBox.classList.remove("hidden"); }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;","&gt;":">&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function setBadges(roomCode, handNumber){ if(roomBadge) roomBadge.textContent=roomCode?`Room ${roomCode}`:''; if(handBadge) handBadge.textContent=handNumber?`Hand #${handNumber}`:''; }

const LS_TOKEN_KEY="peanutsToken", LS_ROOM_KEY="peanutsRoom";
function saveIdentity(token, room){ try{ localStorage.setItem(LS_TOKEN_KEY, token); localStorage.setItem(LS_ROOM_KEY, room);}catch{} }
function clearIdentity(){ try{ localStorage.removeItem(LS_TOKEN_KEY); localStorage.removeItem(LS_ROOM_KEY);}catch{} }
function getIdentity(){ try{ return { token:localStorage.getItem(LS_TOKEN_KEY), room:localStorage.getItem(LS_ROOM_KEY) }; }catch{ return {}; } }

/* Cards (SVG) */
function cardChip(card){
  if(!card) return document.createElement('div');
  const r=card[0]?.toUpperCase(), s=card[1]?.toLowerCase();
  const rp=(r==='T'?'10':r), sym=({c:'♣',d:'♦',h:'♥',s:'♠'}[s]||'?'); const red=(s==='h'||s==='d');
  const svg=`
    <svg class="cardsvg" viewBox="0 0 200 280" role="img" aria-label="${rp}${sym}">
      <rect x="2" y="2" width="196" height="276" rx="16" ry="16" fill="white" stroke="#333" stroke-width="4"/>
      <g transform="translate(14,28)" class="${red?'red':'black'}">
        <text class="rank small corner" x="0" y="0">${rp}</text>
        <text class="corner" x="0" y="28" style="font:700 24px/1 'Segoe UI Symbol'">${sym}</text>
      </g>
      <g transform="translate(186,252) rotate(180)" class="${red?'red':'black'}">
        <text class="rank small corner" x="0" y="0">${rp}</text>
        <text class="corner" x="0" y="28" style="font:700 24px/1 'Segoe UI Symbol'">${sym}</text>
      </g>
      <g class="${red?'red':'black'}"><text class="suit center" x="100" y="160" text-anchor="middle">${sym}</text></g>
    </svg>`;
  const d=document.createElement('div'); d.className='cardchip'; d.setAttribute('data-card',card); d.innerHTML=svg; return d;
}

/* State */
const state={
  room:null, token:null, you:null,
  yourCards:[], pickH:new Set(), pickP:new Set(),
  picksByPlayer:{},            // revealed/streets
  finalPicksByPlayer:{},       // results table
  equities:{ he:{}, plo:{} },  // for revealed table
  finalEquities:{ he:{}, plo:{} }, // for results table (river: winners=100)
  board:[],
  stage:'lobby',
  selectionRemainingMs:0
};

/* Rendering */
function renderPlayers(players=[]){
  window._playersCache = players;
  const c=el("players"); c.innerHTML='';
  players.forEach(p=>{
    const row=document.createElement('div'); row.className='playerRow';
    const bal=Number(p.balance||0), balStr=(bal>=0?'+':'')+bal.toFixed(2);
    row.innerHTML=`
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

  if (lockStatus) {
    lockStatus.innerHTML='';
    players.forEach(p=>{
      const item=document.createElement('div'); item.className='playerRow';
      item.innerHTML = `<div>${escapeHtml(p.name)}</div><div>${p.locked?'<span class="badge">Locked</span>':'<span class="badge warn">Waiting</span>'}</div>`;
      lockStatus.appendChild(item);
    });
  }
}
function renderBoard(id,cards){ const c=el(id); if(!c) return; c.innerHTML=''; (cards||[]).forEach(x=>c.appendChild(cardChip(x))); }
function renderHand(cards){
  const c=el("yourHand"); if(!c) return;
  c.innerHTML='';
  (cards||[]).forEach(card=>{
    const chip=cardChip(card);
    chip.addEventListener('click',()=>toggleSelection(card));
    if(state.pickH.has(card)||state.pickP.has(card)) chip.classList.add('selected');
    c.appendChild(chip);
  });
}
function renderPickBoxes(){
  const h=el("pickHoldem"), p=el("pickPLO"); if(!h||!p) return;
  h.innerHTML=''; p.innerHTML='';
  Array.from(state.pickH).forEach(c=>h.appendChild(cardChip(c)));
  Array.from(state.pickP).forEach(c=>p.appendChild(cardChip(c)));
}

function renderTableView(targetId, picksMap, equities){
  const grid=el(targetId); if(!grid) return;
  grid.innerHTML='';
  const players = window._playersCache || [];
  players.forEach(p=>{
    const entry = picksMap[p.id];
    if(!entry) return;
    const seatDiv=document.createElement('div'); seatDiv.className='seat';
    const heEq = (equities?.he?.[p.id]?.win ?? 0).toFixed(1);
    const ploEq = (equities?.plo?.[p.id]?.win ?? 0).toFixed(1);

    const heRow=document.createElement('div'); heRow.className='handRow';
    heRow.innerHTML = `<div class="label">HE</div>`;
    (entry.holdem||[]).forEach(c=>heRow.appendChild(cardChip(c)));
    const hePct=document.createElement('div'); hePct.className='eq mono'; hePct.textContent = `${heEq}%`;
    heRow.appendChild(hePct);

    const ploRow=document.createElement('div'); ploRow.className='handRow';
    ploRow.innerHTML = `<div class="label">PLO</div>`;
    (entry.plo||[]).forEach(c=>ploRow.appendChild(cardChip(c)));
    const ploPct=document.createElement('div'); ploPct.className='eq mono'; ploPct.textContent = `${ploEq}%`;
    ploRow.appendChild(ploPct);

    seatDiv.innerHTML = `<div class="pname">${escapeHtml(entry.name || p.name)}</div>`;
    seatDiv.appendChild(heRow);
    seatDiv.appendChild(ploRow);
    grid.appendChild(seatDiv);
  });
}

/* Reveal button state */
function updateRevealUI(){
  const n = state.board.length;
  if(!revealBtn) return;
  revealBtn.disabled = (state.stage!=='revealed');
  if(state.stage!=='revealed'){ revealBtn.textContent = 'Reveal Flop'; return; }
  if(n===0){ revealBtn.textContent='Reveal Flop'; }
  else if(n===3){ revealBtn.textContent='Reveal Turn'; }
  else if(n===4){ revealBtn.textContent='Reveal River'; }
  else { revealBtn.textContent='Reveal'; revealBtn.disabled=true; }
}

/* Selection */
function toggleSelection(card){
  const inH=state.pickH.has(card), inP=state.pickP.has(card);
  if(!inH && !inP){ if(state.pickH.size<2) state.pickH.add(card); else if(state.pickP.size<4) state.pickP.add(card); else return; }
  else if(inH) state.pickH.delete(card);
  else if(inP) state.pickP.delete(card);
  renderHand(state.yourCards); renderPickBoxes();
}

/* Join flow */
function normRoom(s){ return (s||'').toUpperCase().trim(); }
function isValidRoom(s){ return /^[A-Z0-9]{3,8}$/.test(s); }

el("joinBtn").onclick = ()=>{
  const room=normRoom(el("room").value), name=(el("name").value||'Player').trim();
  if(!isValidRoom(room)) return alert('Room code must be 3–8 letters/numbers');
  const btn=el("joinBtn"); btn.disabled=true; btn.textContent='Joining…';
  const { token:existingToken } = getIdentity();
  socket.emit('joinRoom', { roomCode:room, name, token:existingToken }, (res)=>{
    btn.disabled=false; btn.textContent='Join';
    if(!res?.ok) return alert(res?.error||'Join failed');
    state.room=room; state.token=res.token; state.you=res.name; saveIdentity(res.token, room);
    setBadges(room, 0); show(lobby);
  });
};

/* Navigation */
const goLobby = ()=>show(lobby);
["toLobby1","toLobby2","toLobby3"].forEach(id=>{
  const b=el(id); if(b) b.onclick = goLobby;
});
const leaveBtn = el("backToIntro");
if(leaveBtn){ leaveBtn.onclick = ()=>{ clearIdentity(); show(intro); }; }

el("sitBtn").onclick = ()=>{
  const btn=el("sitBtn"); const on=btn.getAttribute('data-on')==='1';
  socket.emit('toggleSitOut', !on);
};
el("setAnte").onclick = ()=>{ const v=Number(el("anteInput").value)||0; socket.emit('setAnte', v); };
el("setTimer").onclick = ()=>{ const v=Number(el("timerInput").value)||30; socket.emit('setSelectionSeconds', v); };
el("startBtn").onclick = ()=> socket.emit('startHand');
el("nextBtn").onclick = ()=> socket.emit('nextHand');

const termBtn=document.getElementById('terminateBtn');
if(termBtn) termBtn.onclick = ()=>{ if(confirm('Terminate table?')) socket.emit('terminateTable'); };

if(revealBtn){ revealBtn.onclick = ()=> socket.emit('revealNextStreet'); }

// Auto-rejoin
window.addEventListener('load', ()=>{
  const { token, room } = getIdentity();
  if(token && room && isValidRoom(room)){
    const roomInput=el("room"); if(roomInput) roomInput.value=room;
    socket.emit('joinRoom', { roomCode:room, name:'', token }, (res)=>{
      if(res?.ok){ state.room=room; state.token=res.token; state.you=res.name; setBadges(room,0); show(lobby); }
      else show(intro);
    });
  } else show(intro);
});

/* Countdown */
let countdownTimer=null;
function startCountdown(){
  stopCountdown();
  countdownTimer=setInterval(()=>{
    const ms = Math.max(0, state.selectionRemainingMs||0);
    const s = Math.ceil(ms/1000);
    if(countdownEl) countdownEl.textContent = s+'s';
  }, 200);
}
function stopCountdown(){ if(countdownTimer){ clearInterval(countdownTimer); countdownTimer=null; } }

/* Socket events */
socket.on('roomUpdate', data=>{
  state.stage = data.stage;
  state.board = data.board || [];
  state.selectionRemainingMs = data.selectionRemainingMs || 0;

  setBadges(getIdentity().room, data.handNumber||0);
  renderPlayers(data.players);
  el("anteInput").value=data.ante||0;
  const tin=el("timerInput"); if(tin) tin.value=data.selectionSeconds||30;

  const me=(data.players||[]).find(p=>p.id===state.token);
  const sitBtn=el("sitBtn");
  if(sitBtn){ const s=!!me?.sitOut; sitBtn.textContent=s?'Return to Play':'Sit Out'; sitBtn.setAttribute('data-on', s?'1':'0'); }

  if (data.stage==='selecting') { startCountdown(); show(selecting); }
  else { stopCountdown(); }

  if (data.stage==='revealed' || data.stage==='results') {
    renderBoard('board', state.board);
    renderTableView('tableGrid', state.picksByPlayer, state.equities);
    updateRevealUI();
  }

  if(data.stage==='lobby') show(lobby);
  else if(data.stage==='revealed') show(revealed);
  else if(data.stage==='results') show(results);
});

// Streets (picks + equities)
socket.on('streetUpdate', payload=>{
  if (payload?.equities) state.equities = payload.equities;
  if (payload?.picks) {
    const m={};
    for(const [pid, info] of Object.entries(payload.picks)){
      m[pid] = { name: info.name, holdem: info.holdem||[], plo: info.plo||[] };
    }
    state.picksByPlayer = m;
  }
  state.board = payload?.board || state.board;
  renderBoard('board', state.board);
  renderTableView('tableGrid', state.picksByPlayer, state.equities);
  state.stage = 'revealed';
  updateRevealUI();
  show(revealed);
});

socket.on('yourCards', ({cards})=>{
  state.yourCards=cards||[]; state.pickH=new Set(); state.pickP=new Set();
  renderHand(state.yourCards); renderPickBoxes(); show(selecting);
});

// RESULTS — keep hands until Next Hand, and show 100% winners at river
socket.on('results', payload=>{
  // final picks for results grid
  const finalMap={};
  for(const [pid, info] of Object.entries(payload.picks||{})){
    finalMap[pid] = { name: info.name, holdem: info.holdem||[], plo: info.plo||[] };
  }
  state.finalPicksByPlayer = finalMap;

  // compute final equities = 100% for winners (ties: all winners 100)
  const heWinners = new Set(payload.winners?.holdem || []);
  const ploWinners = new Set(payload.winners?.plo || []);
  const heEq={}, ploEq={};
  Object.keys(finalMap).forEach(pid=>{
    heEq[pid] = { win: heWinners.has(pid) ? 100 : 0, tie: 0 };
    ploEq[pid] = { win: ploWinners.has(pid) ? 100 : 0, tie: 0 };
  });
  state.finalEquities = { he: heEq, plo: ploEq };

  renderBoard('finalBoard', payload.board||[]);

  const winnersDiv=el("winners");
  const nameOf=sid=>payload.picks[sid]?.name || sid;
  const holdem=(payload.winners?.holdem||[]).map(nameOf).join(', ');
  const plo=(payload.winners?.plo||[]).map(nameOf).join(', ');
  const scoop=(payload.scoops||[]).map(nameOf).join(', ');
  let html=`<p><strong>Hold’em:</strong> ${escapeHtml(holdem||'-')}</p>
            <p><strong>PLO:</strong> ${escapeHtml(plo||'-')}</p>`;
  if(payload.scoops && payload.scoops.length){
    html += `<p>💥 SCOOP by ${escapeHtml(scoop)}</p>`;
  }
  winnersDiv.innerHTML=html;

  // render final table with 100% winners
  renderTableView('tableGridFinal', state.finalPicksByPlayer, state.finalEquities);

  show(results);
  updateRevealUI();
});

socket.on('finalResults', ({handNumber, ante, players})=>{
  finalTable.innerHTML='';
  const hdr=document.createElement('div'); hdr.className='finalRow finalHeader';
  hdr.innerHTML='<div>Player</div><div class="mono">Balance</div>'; finalTable.appendChild(hdr);
  players.forEach(p=>{
    const row=document.createElement('div'); row.className='finalRow';
    const bal=(p.balance>=0?'+':'')+Number(p.balance||0).toFixed(2);
    row.innerHTML=`<div>${escapeHtml(p.name)}</div><div class="mono ${p.balance>=0?'positive':'negative'}">${bal}</div>`;
    finalTable.appendChild(row);
  });
  el("finalTitle").textContent=`Final Results — ${getIdentity().room||''} (Hands: ${handNumber||0})`;
  finalModal.classList.add('show');
});
socket.on('terminated', ()=>{ clearIdentity(); });

/* Chat */
socket.on('chatBacklog', (msgs=[])=>{ chatLog.innerHTML=''; msgs.forEach(addChatLine); });
socket.on('chatMessage', msg=>addChatLine(msg));
function addChatLine(msg){
  const d=document.createElement('div'); d.className='chatmsg' + (msg.system?' system':'');
  const who=msg.system?'🛈':escapeHtml(msg.from||'Unknown'); const text=escapeHtml(msg.text||'');
  const time=new Date(msg.ts||Date.now()).toLocaleTimeString();
  d.innerHTML=`<span class="who">${who}</span> <span class="t">${text}</span> <span class="mono" style="opacity:.6;float:right">${time}</span>`;
  chatLog.appendChild(d); chatLog.scrollTop=chatLog.scrollHeight;
}
el("chatSend").onclick = ()=>sendChat();
chatInput?.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });
function sendChat(){ const t=(chatInput.value||'').trim(); if(!t) return; socket.emit('chatMessage', t); chatInput.value=''; }

/* Lock / Next */
el("lockBtn").onclick = ()=>{
  if(state.pickH.size!==2 || state.pickP.size!==4) return alert("Pick 2 for Hold’em and 4 for PLO.");
  socket.emit('makeSelections', { holdemTwo:Array.from(state.pickH), ploFour:Array.from(state.pickP) }, res=>{
    if(!res?.ok) alert(res?.error||'Could not lock');
  });
};
el("finalClose").onclick = ()=>{ finalModal.classList.remove('show'); show(intro); };

// public/client.js — Cards render + back-to-lobby + leave room + live rejoin + selection countdown/auto-lock.
// Manual reveals; results persist until Next Hand.

const socket = io();
socket.on("connect", ()=>console.log("[socket] connected", socket.id));
socket.on("connect_error", err=>{ console.error(err); alert("Socket connection issue."); });
socket.on("disconnect", r=>console.warn("[socket] disconnected", r));

const el=id=>document.getElementById(id);
const intro=el("intro"), lobby=el("lobby"), selecting=el("selecting"), revealed=el("revealed"), results=el("results");
const chatBox=el("chat"), chatLog=el("chatLog"), chatInput=el("chatInput");
const handBadge=el("handBadge"), roomBadge=el("roomBadge"), scoopOverlay=el("scoopOverlay");
const finalModal=el("finalModal"), finalTable=el("finalTable");
const revealBtn=el("revealBtn"), revealHint=el("revealHint");
const countdownEl=el("countdown"), lockStatus=el("lockStatus");

function show(v){ [intro,lobby,selecting,revealed,results].forEach(x=>x.classList.add("hidden")); v.classList.remove("hidden"); chatBox.classList.remove("hidden"); }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
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
  picksByPlayer:{},
  equities:{ he:{}, plo:{} },
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

  // Lock status panel (during selecting)
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

/* Table view */
function renderTableView(){
  const grid=el("tableGrid"); if(!grid) return;
  grid.innerHTML='';
  const players = window._playersCache || [];
  players.forEach(p=>{
    const entry = state.picksByPlayer[p.id];
    if(!entry) return; // show only current-hand players
    const seatDiv=document.createElement('div'); seatDiv.className='seat';
    const heEq = (state.equities.he?.[p.id]?.win ?? 0).toFixed(1);
    const ploEq = (state.equities.plo?.[p.id]?.win ?? 0).toFixed(1);

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
  if(!revealBtn) return;
  const n = state.board.length;
  revealBtn.disabled = (state.stage!=='revealed');
  if(state.stage!=='revealed'){
    revealBtn.textContent = 'Reveal Flop';
    if(revealHint) revealHint.textContent = '';
    return;
  }
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

/* Navigation buttons */
const goLobby = ()=>show(lobby);
["]()

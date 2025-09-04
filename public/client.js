// Peanuts Poker — client gameplay: selection clock + bottom chat + tidy table + equities + cumulative totals
// Home screen untouched.

const socket = io();
const $ = id => document.getElementById(id);

// Sections / Elements
const homeHero = $("homeHero");
const lobby = $("lobby"), selecting = $("selecting"), revealed = $("revealed"), results = $("results"), terminated = $("terminated");
const roomBadge = $("roomBadge"), handBadge = $("handBadge");
const handBadgeSel = $("handBadgeSel"), handBadgeRes = $("handBadgeRes");
const anteInput = $("anteInput"), anteLockedBadge = $("anteLockedBadge");
const scoopInput = $("scoopInput"), scoopLockedBadge = $("scoopLockedBadge");
const timerInput = $("timerInput"), timerLockedBadge = $("timerLockedBadge");
const playersDiv = $("players");
const yourHandEl = $("yourHand"), pickHoldemEl = $("pickHoldem"), pickPLOEl = $("pickPLO");
const lockStatus = $("lockStatus"), countdownEl = $("countdown");
const boardEl = $("board"), revealBtn = $("revealBtn");
const finalBoardEl = $("finalBoard"), winnersDiv = $("winners");
const tableGrid = $("tableGrid"), tableGridFinal = $("tableGridFinal");

// Chat elements
const chatBar = $("chatBar"), chatLog = $("chatLog");
const chatInput = $("chatInput"), chatSend = $("chatSend");
const chatCollapse = $("chatCollapse"), chatReveal = $("chatReveal");

// Buttons
$("joinBtn").onclick = joinRoom;
$("leaveBtn").onclick = leaveRoom;
$("lockAnte").onclick = ()=>socket.emit('lockAnte');
$("lockScoop").onclick = ()=>socket.emit('lockScoop');
$("unlockTimer").onclick = ()=>socket.emit('setSelectionSeconds', Number(timerInput.value)||45);
$("lockTimer").onclick = ()=>{ /* purely visual lock badge */ timerLockedBadge.classList.remove('hidden'); };
$("startBtn").onclick = ()=>socket.emit('startHand');
$("toLobby1")?.addEventListener('click', ()=>socket.emit('changeSettings'));
$("toLobby2")?.addEventListener('click', ()=>socket.emit('changeSettings'));
$("nextBtn").onclick = ()=>socket.emit('startHand');
$("changeSettingsBtn").onclick = ()=>socket.emit('changeSettings');
revealBtn.onclick = ()=>socket.emit('revealNextStreet');
$("lockBtn").onclick = lockSelections;
$("terminateBtn").onclick = ()=>socket.emit('terminateRoom');
$("terminateBtn2").onclick = ()=>socket.emit('terminateRoom');
$("leaveFromSummary").onclick = leaveRoom;

// Inputs -> server
anteInput.onchange = ()=>socket.emit('setAnte', Number(anteInput.value)||0);
scoopInput.onchange = ()=>socket.emit('setScoopBonus', Number(scoopInput.value)||0);
timerInput.onchange = ()=>socket.emit('setSelectionSeconds', Number(timerInput.value)||45);

// Identity (localStorage)
function saveIdentity(token, room){ try{ localStorage.setItem("peanutsToken", token); localStorage.setItem("peanutsRoom", room);}catch{} }
function clearIdentity(){ try{ localStorage.removeItem("peanutsToken"); localStorage.removeItem("peanutsRoom"); }catch{} }
function getIdentity(){ try{ return { token:localStorage.getItem("peanutsToken"), room:localStorage.getItem("peanutsRoom") }; }catch{ return {}; } }

// State
const state = {
  room:null, token:null, you:null,
  yourCards:[], pickH:new Set(), pickP:new Set(),
  board:[], stage:'home',
  selectionRemainingMs: 0,
  picksByPlayer:{}, equities:{he:{},plo:{}},
  finalPicksByPlayer:{}, finalEquities:{he:{},plo:{}},
  chatMin:true
};

// Show helper (chat visible only in-room)
function show(section){
  [lobby, selecting, revealed, results, terminated].forEach(x=>x.classList.add("hidden"));
  if(section) section.classList.remove("hidden");
  const inRoom = (section===lobby || section===selecting || section===revealed || section===results || section===terminated);
  if(inRoom){ homeHero.classList.add("hidden"); chatBar.classList.remove("hidden"); setChatMinimized(true); }
  else { homeHero.classList.remove("hidden"); chatBar.classList.add("hidden"); }
}

// Chat minimize/expand
function setChatMinimized(min){
  state.chatMin = min;
  chatBar.classList.toggle('minimized', !!min);
}
chatCollapse.addEventListener('click', ()=> setChatMinimized(true));
chatReveal.addEventListener('click', ()=> setChatMinimized(false));

function addChatLine(msg){
  const d=document.createElement('div'); d.className='chatmsg'+(msg.system?' system':'');
  const who = msg.system?'🛈':(msg.from||'');
  const text = (msg.text||'');
  const time = new Date(msg.ts||Date.now()).toLocaleTimeString();
  d.innerHTML = `<span class="who">${escapeHTML(who)}</span> <span class="t">${escapeHTML(text)}</span> <span style="opacity:.6;float:right">${time}</span>`;
  chatLog.appendChild(d); chatLog.scrollTop=chatLog.scrollHeight;
}
function sendChat(){
  const t=(chatInput.value||'').trim(); if(!t) return;
  socket.emit('chatMessage', t); chatInput.value='';
}
chatSend.onclick = sendChat;
chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });

/* --------------------------- Join / Leave -------------------------- */
function joinRoom(){
  const room = ($("room").value||'').toUpperCase().trim();
  const name = ($("name")?.value||'Player').trim();
  if(!/^[A-Z0-9]{3,8}$/.test(room)){
    alert("Room code must be 3–8 letters/numbers");
    return;
  }
  const {token} = getIdentity();
  const btn=$("joinBtn"); btn.disabled=true; btn.textContent="Joining…";
  socket.emit('joinRoom', {roomCode:room, name, token}, (res)=>{
    btn.disabled=false; btn.textContent="Join Room";
    if(!res?.ok){ alert(res?.error||"Join failed"); return; }
    state.room=room; state.token=res.token; state.you=res.name;
    saveIdentity(res.token, room);
    roomBadge.textContent=`Room ${room}`;
    show(lobby);
  });
}
function leaveRoom(){ clearIdentity(); location.reload(); }

/* ------------------------ Card rendering (SVG) --------------------- */
function suitPath(s){
  switch(s){
    case 'h': return {d:'M100 70 C100 40, 60 30, 50 55 C40 30, 0 40, 0 70 C0 100, 50 120, 100 160 C150 120, 200 100, 200 70 C200 40, 160 30, 150 55 C140 30, 100 40, 100 70 Z', scale:.55, y:25};
    case 'd': return {d:'M100 0 L200 100 L100 200 L0 100 Z', scale:.55, y:22};
    case 'c': return {d:'M100 60 C70 60, 55 35, 55 25 C55 10, 70 0, 85 0 C95 0, 105 5, 110 15 C115 5, 125 0, 135 0 C150 0, 165 10, 165 25 C165 35, 150 60, 120 60 C140 60, 160 80, 160 100 C160 125, 135 140, 110 130 L110 170 L90 170 L90 130 C65 140, 40 125, 40 100 C40 80, 60 60, 80 60 Z', scale:.45, y:36};
    default:  // spade
      return {d:'M100 0 C160 60, 200 100, 200 140 C200 170, 180 200, 150 200 C130 200, 115 190, 105 175 L105 200 L95 200 L95 175 C85 190, 70 200, 50 200 C20 200, 0 170, 0 140 C0 100, 40 60, 100 0 Z', scale:.55, y:24};
  }
}
function suitColor(s){ return (s==='h'||s==='d') ? '#C1121F' : '#111'; }
function pipLayout(rank){
  const cx=100, top=46, midTop=88, mid=140, midBot=192, bot=234, left=52, right=148;
  const T=(x,y)=>({x,y}), Pair=y=>[T(left,y),T(right,y)];
  switch(rank){
    case '2': return [T(cx,top),T(cx,bot)];
    case '3': return [T(cx,top),T(cx,mid),T(cx,bot)];
    case '4': return [...Pair(top),...Pair(bot)];
    case '5': return [...Pair(top),T(cx,mid),...Pair(bot)];
    case '6': return [...Pair(top),...Pair(mid),...Pair(bot)];
    case '7': return [...Pair(top),...Pair(mid),...Pair(bot),T(cx,midTop)];
    case '8': return [...Pair(top),...Pair(mid),...Pair(bot),...Pair(midTop)];
    case '9': return [...Pair(top),...Pair(midTop),...Pair(mid),...Pair(midBot),T(cx,mid)];
    case '10':
    case 'T': return [...Pair(top),...Pair(midTop),...Pair(mid),...Pair(midBot),...Pair(bot)];
    default: return [];
  }
}
function cardChip(card, mini=false){
  const rank=card[0].toUpperCase(), suit=card[1].toLowerCase();
  const viewW=200, viewH=280;
  const color = suitColor(suit);
  const cornerRank = rank==='T' ? '10' : rank;
  const isAce=(rank==='A'), isFace=(rank==='J'||rank==='Q'||rank==='K');
  const pipPts = pipLayout(rank);
  const sPath = suitPath(suit); const scale=sPath.scale, offY=sPath.y;

  const suitCorner = `<g transform="translate(0,0) scale(.12)">
    <path d="${sPath.d}" fill="${color}" transform="translate(80,175) scale(${scale}) translate(0,${offY})"></path>
  </g>`;

  const facePanel = `
    <g transform="translate(${viewW/2}, ${viewH/2})">
      <rect x="-60" y="-90" width="120" height="180" rx="12" ry="12" fill="${(suit==='h'||suit==='d') ? '#FCE6E9' : '#EEF1F5'}" stroke="${color}" stroke-width="2"/>
      <text x="0" y="-30" text-anchor="middle" style="font:900 72px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Inter; fill:${color}">${rank}</text>
      <g transform="translate(0, 58) scale(.15)">
        <path d="${sPath.d}" fill="${color}" transform="translate(-100,-100) scale(${scale}) translate(0,${offY})"></path>
      </g>
    </g>`;

  const aceBig = `
    <g transform="translate(${viewW/2}, ${viewH/2+6}) scale(.35)">
      <path d="${sPath.d}" fill="${color}" transform="translate(-100,-100) scale(${scale*2}) translate(0,${offY})"></path>
    </g>`;

  const pipNodes = pipPts.map(({x,y}) =>
    `<g transform="translate(${x},${y}) scale(.12)">
       <path d="${sPath.d}" fill="${color}" transform="translate(-100,-100) scale(${scale}) translate(0,${offY})"></path>
     </g>`
  ).join('');

  const svg = `
  <svg class="cardsvg ${mini?'mini':''}" viewBox="0 0 ${viewW} ${viewH}" text-rendering="geometricPrecision" shape-rendering="geometricPrecision" role="img">
    <rect x="2" y="2" width="${viewW-4}" height="${viewH-4}" rx="16" ry="16" fill="white" stroke="#1d1d1d" stroke-width="4"/>
    <g transform="translate(14,30)">
      <text style="font:900 22px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Inter; fill:${color}" dominant-baseline="hanging">${cornerRank}</text>
      ${suitCorner}
    </g>
    <g transform="translate(${viewW-14},${viewH-30}) rotate(180)">
      <text style="font:900 22px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Inter; fill:${color}" dominant-baseline="hanging">${cornerRank}</text>
      ${suitCorner}
    </g>
    ${pipPts.length? pipNodes : ''}
    ${isAce ? aceBig : ''}
    ${isFace ? facePanel : ''}
  </svg>`;

  const d=document.createElement('div'); d.className='cardchip'; if(mini) d.classList.add('mini');
  d.setAttribute('data-card',card); d.innerHTML=svg;
  return d;
}

/* ----------------------------- UI render -------------------------- */
function escapeHTML(s){ return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;","&gt;":">&gt;","\"":"&quot;","'":"&#39;"}[m])); }

function renderPlayers(players=[]){
  playersDiv.innerHTML='';
  players.forEach(p=>{
    const row=document.createElement('div'); row.className='playerRow';
    const bal=Number(p.balance||0), balStr=(bal>=0?'+':'')+bal.toFixed(2);
    row.innerHTML=`
      <div>
        <span class="namechip">${escapeHTML(p.name)}</span>
        ${p.locked?'<span class="badge">Locked</span>':''}
      </div>
      <div>${balStr}</div>`;
    playersDiv.appendChild(row);
  });
  anteLockedBadge.classList.toggle('hidden', !window._roomAnteLocked);
  scoopLockedBadge.classList.toggle('hidden', !window._roomScoopLocked);
}

function renderHand(cards){
  yourHandEl.innerHTML='';
  (cards||[]).forEach(c=>{
    const chip = cardChip(c,false);
    chip.addEventListener('click', ()=>toggleSelection(c));
    yourHandEl.appendChild(chip);
  });
  refreshPicks();
}

function toggleSelection(card){
  if(state.stage!=='selecting') return;
  if(state.pickH.has(card)){ state.pickH.delete(card); }
  else if(state.pickP.has(card)){ state.pickP.delete(card); }
  else if(state.pickH.size<2){ state.pickH.add(card); }
  else if(state.pickP.size<4){ state.pickP.add(card); }
  refreshPicks();
}

function refreshPicks(){
  pickHoldemEl.innerHTML=''; pickPLOEl.innerHTML='';
  [...state.pickH].forEach(c=>pickHoldemEl.appendChild(cardChip(c,true)));
  [...state.pickP].forEach(c=>pickPLOEl.appendChild(cardChip(c,true)));
  // highlight selected in yourHand
  [...yourHandEl.querySelectorAll('.cardchip')].forEach(node=>{
    const c=node.getAttribute('data-card');
    node.classList.toggle('selected', state.pickH.has(c)||state.pickP.has(c));
  });
}

function renderBoard(el,cards){ el.innerHTML=''; (cards||[]).forEach(c=>el.appendChild(cardChip(c,false))); }

function renderTableView(targetId, picksMap, equities){
  const grid=$(targetId); grid.innerHTML='';
  const plist = window._playersCache || [];
  plist.forEach(p=>{
    const entry = picksMap[p.id];
    if(!entry) return;
    const seat=document.createElement('div'); seat.className='seat';

    const heEq=((equities?.he?.[p.id]?.win)??0).toFixed(1);
    const ploEq=((equities?.plo?.[p.id]?.win)??0).toFixed(1);

    const heRow=document.createElement('div'); heRow.className='handRow';
    heRow.innerHTML='<div class="label">HE</div>';
    (entry.holdem||[]).forEach(c=>heRow.appendChild(cardChip(c, true)));
    heRow.innerHTML += `<div class="eq">${heEq}%</div>`;

    const ploRow=document.createElement('div'); ploRow.className='handRow';
    ploRow.innerHTML='<div class="label">PLO</div>';
    (entry.plo||[]).forEach(c=>ploRow.appendChild(cardChip(c, true)));
    ploRow.innerHTML += `<div class="eq">${ploEq}%</div>`;

    seat.innerHTML = `<div class="pname">${escapeHTML(entry.name||p.name)}</div>`;
    seat.appendChild(heRow); seat.appendChild(ploRow);
    grid.appendChild(seat);
  });
}

/* ---------------------------- Actions ----------------------------- */
function lockSelections(){
  if(state.pickH.size!==2 || state.pickP.size!==4){ alert("Pick 2 for HE and 4 for PLO."); return; }
  socket.emit('makeSelections', { holdemTwo:[...state.pickH], ploFour:[...state.pickP] }, (res)=>{
    if(!res?.ok) alert(res?.error||'Could not lock');
  });
}

/* --------------------------- Countdown ---------------------------- */
let cdTimer=null;
function startCountdown(){
  stopCountdown();
  cdTimer=setInterval(()=>{
    const ms=Math.max(0, state.selectionRemainingMs||0);
    const s = Math.ceil(ms/1000);
    countdownEl.textContent = s+'s';
  }, 250);
}
function stopCountdown(){ if(cdTimer){ clearInterval(cdTimer); cdTimer=null; } }

/* --------------------------- Auto rejoin -------------------------- */
window.addEventListener('load', ()=>{
  const { token, room } = getIdentity();
  if(token && room && /^[A-Z0-9]{3,8}$/.test(room)){
    $("room").value = room;
    socket.emit('joinRoom', {roomCode:room, name:'', token}, (res)=>{
      if(res?.ok){
        state.room=room; state.token=res.token; state.you=res.name;
        roomBadge.textContent=`Room ${room}`;
        show(lobby);
      }
    });
  }
});

/* -------------------------- Socket events ------------------------- */
socket.on('chatBacklog', msgs=>{ chatLog.innerHTML=''; (msgs||[]).forEach(addChatLine); });
socket.on('chatMessage', addChatLine);

socket.on('selectionTick', ({remainingMs})=>{
  state.selectionRemainingMs = remainingMs||0;
  if(selecting && !selecting.classList.contains('hidden')) startCountdown();
});

socket.on('roomUpdate', data=>{
  state.stage = data.stage;
  window._roomAnteLocked = !!data.anteLocked;
  window._roomScoopLocked = !!data.scoopLocked;

  if(data.stage==='lobby'){ show(lobby); stopCountdown(); }
  if(data.stage==='selecting'){ show(selecting); socket.emit('requestYourCards'); startCountdown(); }
  if(data.stage==='revealed'){ show(revealed); stopCountdown(); }
  if(data.stage==='results'){ show(results); stopCountdown(); }

  // cache players for table rendering and balances (cumulative totals)
  window._playersCache = data.players || [];
  renderPlayers(window._playersCache);

  anteInput.value = data.ante||0;
  scoopInput.value = data.scoopBonus||0;
  timerInput.value = data.selectionSeconds||45;

  handBadge.textContent = `Hand #${data.handNumber||0}`;
  handBadgeSel.textContent = `${data.handNumber||0}`;
  handBadgeRes.textContent = `${data.handNumber||0}`;

  renderBoard(boardEl, data.board||[]);
  updateRevealButton(data.board||[]);
});

socket.on('yourCards', ({cards})=>{
  state.yourCards = cards||[];
  state.pickH.clear(); state.pickP.clear();
  renderHand(state.yourCards);
});

socket.on('streetUpdate', payload=>{
  if(payload?.equities) state.equities=payload.equities;
  if(payload?.picks){
    const m={};
    for(const [pid,info] of Object.entries(payload.picks)){
      m[pid]={ name:info.name, holdem:info.holdem||[], plo:info.plo||[] };
    }
    state.picksByPlayer=m;
  }
  state.board = payload?.board || state.board;
  renderBoard(boardEl, state.board);
  renderTableView('tableGrid', state.picksByPlayer, state.equities);
  state.stage='revealed'; updateRevealButton(); show(revealed);
});

socket.on('results', payload=>{
  const map={};
  for(const [pid,info] of Object.entries(payload.picks||{})){
    map[pid]={ name:info.name, holdem:info.holdem||[], plo:info.plo||[] };
  }
  state.finalPicksByPlayer=map;

  // Show winners text + keep final 100% on winner rows (client-side)
  const heW = payload.winners?.holdem || [];
  const ploW = payload.winners?.plo || [];
  const heEq={}, ploEq={};
  Object.keys(map).forEach(pid=>{
    heEq[pid]={win: heW.includes(pid)?100:0, tie:0};
    ploEq[pid]={win: ploW.includes(pid)?100:0, tie:0};
  });
  state.finalEquities={he:heEq, plo:ploEq};

  // Update players balances display (cumulative)
  if(Array.isArray(window._playersCache) && window._playersCache.length){
    renderPlayers(window._playersCache);
  }

  renderBoard(finalBoardEl, payload.board||[]);
  const nameOf=id=>payload.picks[id]?.name || id;
  const holdem=(heW).map(nameOf).join(', ')||'-';
  const plo=(ploW).map(nameOf).join(', ')||'-';
  let html = `<p><strong>Hold’em:</strong> ${escapeHTML(holdem)}</p>
              <p><strong>PLO:</strong> ${escapeHTML(plo)}</p>`;
  if (heW.length && ploW.length && heW.some(id=>ploW.includes(id))) {
    const scooper = heW.find(id=>ploW.includes(id));
    html += `<p>💥 <strong>Full Peanut Scoop</strong> by ${escapeHTML(nameOf(scooper))}</p>`;
  }
  winnersDiv.innerHTML = html;

  renderTableView('tableGridFinal', state.finalPicksByPlayer, state.finalEquities);
  show(results);
});

/* ----------------------------- UI bits ---------------------------- */
function updateRevealButton(){
  const n=state.board.length;
  if(state.stage!=='revealed'){ revealBtn.disabled=true; revealBtn.textContent='Reveal Flop'; return; }
  revealBtn.disabled=false;
  if(n===0) revealBtn.textContent='Reveal Flop';
  else if(n===3) revealBtn.textContent='Reveal Turn';
  else if(n===4) revealBtn.textContent='Reveal River';
  else revealBtn.disabled=true;
}

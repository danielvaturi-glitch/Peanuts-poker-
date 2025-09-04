// Client updates: bottom chat never blocks; cleaner table; sharp cards; per-hand delta; terminate room

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
const finalBoardEl = $("finalBoard"), winnersDiv = $("winners"), deltasDiv = $("handDeltas");
const tableGrid = $("tableGrid"), tableGridFinal = $("tableGridFinal");
const scoopFX = $("scoopFX");

// Chat bottom bar
const chatBar = $("chatBar"), chatLog = $("chatLog");
const chatInput = $("chatInput"), chatSend = $("chatSend");
const chatCollapse = $("chatCollapse"), chatReveal = $("chatReveal");

// Terminate buttons
$("terminateBtn").onclick = terminateRoom;
$("terminateBtn2").onclick = terminateRoom;
$("terminateBtn3").onclick = terminateRoom;

// Buttons
$("joinBtn").onclick = joinRoom;
$("leaveBtn").onclick = leaveRoom;
$("lockAnte").onclick = ()=>socket.emit('lockAnte');
$("lockScoop").onclick = ()=>socket.emit('lockScoop');
$("unlockTimer").onclick = ()=>socket.emit('unlockTimer');
$("lockTimer").onclick = ()=>socket.emit('lockTimer');
$("sitBtn").onclick = toggleSit;
$("startBtn").onclick = ()=>socket.emit('startHand');
$("toLobby1").onclick = ()=>socket.emit('changeSettings');
$("toLobby2").onclick = ()=>socket.emit('changeSettings');
$("nextBtn").onclick = ()=>socket.emit('startHand');
$("changeSettingsBtn").onclick = ()=>socket.emit('changeSettings');
revealBtn.onclick = ()=>socket.emit('revealNextStreet');
$("lockBtn").onclick = lockSelections;
$("leaveFromSummary").onclick = leaveRoom;

// Inputs -> server
anteInput.onchange = ()=>socket.emit('setAnte', Number(anteInput.value)||0);
scoopInput.onchange = ()=>socket.emit('setScoopBonus', Number(scoopInput.value)||0);
timerInput.onchange = ()=>socket.emit('setSelectionSeconds', Number(timerInput.value)||45);

// Local identity
const LS_TOKEN_KEY="peanutsToken", LS_ROOM_KEY="peanutsRoom";
function saveIdentity(token, room){ try{ localStorage.setItem(LS_TOKEN_KEY, token); localStorage.setItem(LS_ROOM_KEY, room);}catch{} }
function clearIdentity(){ try{ localStorage.removeItem(LS_TOKEN_KEY); localStorage.removeItem(LS_ROOM_KEY);}catch{} }
function getIdentity(){ try{ return { token:localStorage.getItem(LS_TOKEN_KEY), room:localStorage.getItem(LS_ROOM_KEY) }; }catch{ return {}; } }

// State
const state = {
  room: null, token: null, you: null,
  stage:'home',
  yourCards: [], pickH: new Set(), pickP: new Set(),
  dealKey:null,
  picksByPlayer:{}, equities:{he:{},plo:{}},
  finalPicksByPlayer:{}, finalEquities:{he:{},plo:{}},
  board:[], selectionRemainingMs:0,
  chatMin:true
};

// Show helper: chat only in room screens; never on home; never blocks
function setRoomVisibility(on){
  document.body.classList.toggle('room-visible', !!on);
  if(on){
    if(state.chatMin){
      document.body.classList.add('chat-min');
      document.body.classList.remove('chat-open');
    }else{
      document.body.classList.remove('chat-min');
      document.body.classList.add('chat-open');
    }
  }else{
    document.body.classList.remove('chat-min','chat-open');
  }
}
function show(section){
  [lobby, selecting, revealed, results, terminated].forEach(x=>x.classList.add("hidden"));
  section.classList.remove("hidden");

  const inRoom = (section!==homeHero && section!==null && section!==undefined && section!==document.body) &&
                 (section===lobby || section===selecting || section===revealed || section===results || section===terminated);
  if(inRoom){
    homeHero.classList.add("hidden");
    chatBar.classList.remove("hidden");
    setRoomVisibility(true);
  } else {
    homeHero.classList.remove("hidden");
    chatBar.classList.add("hidden");
    setRoomVisibility(false);
  }
}

// Chat minimize/expand (default minimized so it never covers controls)
function setChatMinimized(min){
  state.chatMin = min;
  chatBar.classList.toggle('minimized', min);
  if(min){
    document.body.classList.add('chat-min');
    document.body.classList.remove('chat-open');
  }else{
    document.body.classList.remove('chat-min');
    document.body.classList.add('chat-open');
  }
}
chatCollapse.addEventListener('click', ()=> setChatMinimized(true));
chatReveal.addEventListener('click', ()=> setChatMinimized(false));

// Chat functions
function addChatLine(msg){
  const d=document.createElement('div'); d.className='chatmsg'+(msg.system?' system':'');
  const who = msg.system?'🛈':escapeHTML(msg.from||'Unknown');
  const text = escapeHTML(msg.text||'');
  const time = new Date(msg.ts||Date.now()).toLocaleTimeString();
  d.innerHTML = `<span class="who">${who}</span> <span class="t">${text}</span> <span style="opacity:.6;float:right">${time}</span>`;
  chatLog.appendChild(d); chatLog.scrollTop=chatLog.scrollHeight;
}
function sendChat(){
  const t=(chatInput.value||'').trim(); if(!t) return;
  socket.emit('chatMessage', t); chatInput.value='';
}
chatSend.onclick = sendChat;
chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });

// Join / Leave / Terminate
function joinRoom(){
  const room = ($("room").value||'').toUpperCase().trim();
  const name = ($("name")?.value||'Player').trim();
  if(!/^[A-Z0-9]{3,8}$/.test(room)) return alert("Room code must be 3–8 letters/numbers");
  const {token} = getIdentity();
  $("joinBtn").disabled=true; $("joinBtn").textContent="Joining…";
  socket.emit('joinRoom', {roomCode:room, name, token}, (res)=>{
    $("joinBtn").disabled=false; $("joinBtn").textContent="Join Room";
    if(!res?.ok) return alert(res?.error||"Join failed");
    state.room=room; state.token=res.token; state.you=res.name; saveIdentity(res.token, room);
    roomBadge.textContent = `Room ${room}`;
    setChatMinimized(true);
    // If the room is terminated, server will send sessionSummary (handled below)
  });
}
function leaveRoom(){ clearIdentity(); location.reload(); }
function terminateRoom(){ socket.emit('terminateRoom'); }

// ---------- CRISP CARD RENDERING (clean, brand-neutral) ----------
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

function cardChip(card, mini=false){
  const rank=card[0].toUpperCase(), suit=card[1].toLowerCase();
  const svg = drawCardSVG(rank, suit, mini);
  const d=document.createElement('div'); d.className='cardchip'; if(mini) d.classList.add('mini');
  d.setAttribute('data-card',card); d.innerHTML=svg;
  return d;
}

function drawCardSVG(rank, suit, mini){
  const viewW=200, viewH=280;
  const color = suitColor(suit);
  const cornerRank = rank==='T' ? '10' : rank;
  const isAce=(rank==='A'), isFace=(rank==='J'||rank==='Q'||rank==='K');
  const pipPts = pipLayout(rank);
  const sPath = suitPath(suit);
  const scale = sPath.scale, offY = sPath.y;

  const suitCorner = `<g transform="translate(0,0) scale(.12)">
      <path d="${sPath.d}" fill="${color}" transform="translate(80,175) scale(${scale}) translate(0,${offY})"></path>
    </g>`;

  const facePanel = `
    <g transform="translate(${viewW/2}, ${viewH/2})">
      <rect x="-60" y="-90" width="120" height="180" rx="12" ry="12" fill="${(suit==='h'||suit==='d') ? '#FCE6E9' : '#EEF1F5'}" stroke="${color}" stroke-width="2"/>
      <text x="0" y="-30" text-anchor="middle" style="font:900 72px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Inter; fill:${color}">${rank}</text>
      <g transform="translate(-80, 16) scale(.8)" fill="${color}">
        <path d="M 40 0 L 55 -18 L 70 0 L 85 -15 L 100 0 L 115 -15 L 130 0 L 145 -18 L 160 0 L 155 22 L 45 22 Z"></path>
      </g>
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

  return `
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
}

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

// ---------- Selection UI ----------
function renderHand(cards){
  yourHandEl.innerHTML='';
  (cards||[]).forEach(c=>yourHandEl.appendChild(cardChip(c, false)));
  refreshSelectedMarks();
}
yourHandEl.addEventListener('click', e=>{
  if(state.stage!=='selecting') return;
  const chip = e.target.closest('.cardchip'); if(!chip) return;
  const c=chip.getAttribute('data-card'); toggleSelection(c);
});
function toggleSelection(card){
  if(state.pickH.has(card)){ state.pickH.delete(card); }
  else if(state.pickP.has(card)){ state.pickP.delete(card); }
  else if(state.pickH.size<2){ state.pickH.add(card); }
  else if(state.pickP.size<4){ state.pickP.add(card); }
  refreshSelectedMarks(); renderPickBoxes();
}
function refreshSelectedMarks(){
  [...yourHandEl.querySelectorAll('.cardchip')].forEach(node=>{
    const c=node.getAttribute('data-card');
    node.classList.toggle('selected', state.pickH.has(c)||state.pickP.has(c));
  });
}
function renderPickBoxes(){
  pickHoldemEl.innerHTML=''; pickPLOEl.innerHTML='';
  [...state.pickH].forEach(c=>pickHoldemEl.appendChild(cardChip(c, true)));
  [...state.pickP].forEach(c=>pickPLOEl.appendChild(cardChip(c, true)));
}

// ---------- Players & board ----------
function renderPlayers(players=[]){
  window._playersCache = players;
  playersDiv.innerHTML='';
  players.forEach(p=>{
    const row=document.createElement('div'); row.className='playerRow';
    const bal=Number(p.balance||0), balStr=(bal>=0?'+':'')+bal.toFixed(2);
    row.innerHTML=`
      <div>
        <span class="namechip">${escapeHTML(p.name)}</span>
        ${p.present?'':'<span class="badge">Away</span>'}
        ${p.sitOut?'<span class="badge warn">Sitting Out</span>':''}
        ${p.locked?'<span class="badge">Locked</span>':''}
      </div>
      <div class="${bal>=0?'positive':'negative'}">${balStr}</div>`;
    playersDiv.appendChild(row);
  });

  // Lock status box
  lockStatus.innerHTML='';
  players.forEach(p=>{
    const d=document.createElement('div'); d.className='playerRow';
    d.innerHTML = `<div>${escapeHTML(p.name)}</div><div>${p.locked?'<span class="badge">Locked</span>':'<span class="badge warn">Waiting</span>'}</div>`;
    lockStatus.appendChild(d);
  });
}

function renderBoard(elm,cards){ elm.innerHTML=''; (cards||[]).forEach(c=>elm.appendChild(cardChip(c, false))); }

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
    const hePct=document.createElement('div'); hePct.className='eq'; hePct.textContent=`${heEq}%`; heRow.appendChild(hePct);

    const ploRow=document.createElement('div'); ploRow.className='handRow';
    ploRow.innerHTML='<div class="label">PLO</div>';
    (entry.plo||[]).forEach(c=>ploRow.appendChild(cardChip(c, true)));
    const ploPct=document.createElement('div'); ploPct.className='eq'; ploPct.textContent=`${ploEq}%`; ploRow.appendChild(ploPct);

    seat.innerHTML = `<div class="pname">${escapeHTML(entry.name||p.name)}</div>`;
    seat.appendChild(heRow); seat.appendChild(ploRow);
    grid.appendChild(seat);
  });
}

function updateRevealBtn(){
  if(state.stage!=='revealed'){ revealBtn.disabled=true; revealBtn.textContent='Reveal Flop'; return; }
  const n=state.board.length;
  revealBtn.disabled=false;
  if(n===0) revealBtn.textContent='Reveal Flop';
  else if(n===3) revealBtn.textContent='Reveal Turn';
  else if(n===4) revealBtn.textContent='Reveal River';
  else { revealBtn.disabled=true; }
}

// ---------- Helpers ----------
function escapeHTML(s){ return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;","&gt;":">&gt;","\"":"&quot;","'":"&#39;"}[m])); }

// Countdown
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

// Lock selections
function lockSelections(){
  if(state.pickH.size!==2 || state.pickP.size!==4) return alert("Pick 2 for HE and 4 for PLO.");
  socket.emit('makeSelections', { holdemTwo:[...state.pickH], ploFour:[...state.pickP] }, (res)=>{
    if(!res?.ok) alert(res?.error||'Could not lock');
  });
}

// Auto-rejoin on load
window.addEventListener('load', ()=>{
  const { token, room } = getIdentity();
  if(token && room && /^[A-Z0-9]{3,8}$/.test(room)){
    $("room").value = room;
    socket.emit('joinRoom', {roomCode:room, name:'', token}, (res)=>{
      if(res?.ok){ state.room=room; state.token=res.token; state.you=res.name; roomBadge.textContent=`Room ${room}`; setChatMinimized(true); show(lobby); }
    });
  } else {
    homeHero.classList.remove('hidden');
    chatBar.classList.add('hidden');
    document.body.classList.remove('chat-open','chat-min','room-visible');
  }
});

// SOCKET EVENTS
socket.on('chatBacklog', msgs=>{ chatLog.innerHTML=''; (msgs||[]).forEach(addChatLine); });
socket.on('chatMessage', addChatLine);

socket.on('roomUpdate', data=>{
  // If a terminated summary is being shown, ignore roomUpdate
  if(state.stage==='terminated') return;

  state.stage = data.stage;
  state.board = data.board||[];
  state.selectionRemainingMs = data.selectionRemainingMs||0;

  if (data.stage==='lobby'){ show(lobby); }
  if (data.stage==='selecting'){ show(selecting); socket.emit('requestYourCards'); startCountdown(); }
  if (data.stage==='revealed'){ show(revealed); }
  if (data.stage==='results'){ show(results); }

  renderPlayers(data.players);
  anteInput.value = data.ante||0;
  scoopInput.value = data.scoopBonus||0;
  timerInput.value = data.selectionSeconds||45;
  handBadge.textContent = `Hand #${data.handNumber||0}`;
  handBadgeSel.textContent = `${data.handNumber||0}`;
  handBadgeRes.textContent = `${data.handNumber||0}`;

  anteLockedBadge.classList.toggle('hidden', !data.anteLocked);
  scoopLockedBadge.classList.toggle('hidden', !data.scoopLocked);
  timerLockedBadge.classList.toggle('hidden', !data.timerLocked);

  if (data.stage==='revealed' || data.stage==='results'){
    renderBoard(boardEl, state.board);
    renderTableView('tableGrid', state.picksByPlayer, state.equities);
    updateRevealBtn();
  }
  if (data.stage!=='selecting'){ stopCountdown(); }
});

// Only reset picks when the deal actually changes
socket.on('yourCards', ({cards})=>{
  const key = (cards||[]).join(',');
  if(key !== state.dealKey){
    state.dealKey = key;
    state.yourCards = cards||[];
    state.pickH=new Set(); state.pickP=new Set();
  } else {
    state.yourCards = cards||[];
  }
  renderHand(state.yourCards); renderPickBoxes();
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
  state.stage='revealed'; updateRevealBtn(); show(revealed);
});

socket.on('results', payload=>{
  const map={};
  for(const [pid,info] of Object.entries(payload.picks||{})){
    map[pid]={ name:info.name, holdem:info.holdem||[], plo:info.plo||[] };
  }
  state.finalPicksByPlayer=map;

  const heWinners = new Set(payload.winners?.holdem||[]);
  const ploWinners = new Set(payload.winners?.plo||[]);
  const heEq={}, ploEq={};
  Object.keys(map).forEach(pid=>{
    heEq[pid]={win: heWinners.has(pid)?100:0, tie:0};
    ploEq[pid]={win: ploWinners.has(pid)?100:0, tie:0};
  });
  state.finalEquities={he:heEq, plo:ploEq};

  // Balances and per-hand deltas
  if(Array.isArray(payload.players) && payload.players.length){
    window._playersCache = payload.players.map(p=>({id:p.id, name:p.name, balance:+(p.balance||0)}));
    renderPlayers(window._playersCache);
  }
  // Show per-hand deltas
  deltasDiv.innerHTML = '';
  if(payload.deltas){
    Object.entries(payload.deltas).forEach(([pid,delta])=>{
      const name = payload.picks?.[pid]?.name || pid;
      const d = Number(delta||0);
      const row = document.createElement('div'); row.className='deltaRow';
      row.innerHTML = `<div>${escapeHTML(name)}</div><div class="${d>=0?'deltaPlus':'deltaMinus'}">${d>=0?'+':''}${d.toFixed(2)}</div>`;
      deltasDiv.appendChild(row);
    });
  }

  renderBoard(finalBoardEl, payload.board||[]);
  const nameOf=id=>payload.picks[id]?.name || id;
  const holdem=(payload.winners?.holdem||[]).map(nameOf).join(', ')||'-';
  const plo=(payload.winners?.plo||[]).map(nameOf).join(', ')||'-';
  let html = `<p><strong>Hold’em:</strong> ${escapeHTML(holdem)}</p>
              <p><strong>PLO:</strong> ${escapeHTML(plo)}</p>`;
  if (payload.scoops && payload.scoops.length){
    html += `<p>💥 <strong>Full Peanut Scoop</strong> by ${escapeHTML(nameOf(payload.scoops[0]))}${payload.scoopBonusApplied?` (+${payload.scoopBonusApplied.toFixed(2)} bonus)`:''}</p>`;
    playScoopFX();
  }
  winnersDiv.innerHTML = html;

  renderTableView('tableGridFinal', state.finalPicksByPlayer, state.finalEquities);
  show(results);
});

// Session summary (after termination; persists 24h)
socket.on('sessionSummary', ({summary, savedAt})=>{
  const inf = $("summaryInfo");
  const when = new Date(savedAt||Date.now()).toLocaleString();
  let html = `<p><strong>Room:</strong> ${escapeHTML(summary.room)} &nbsp; • &nbsp; <strong>Hands:</strong> ${summary.hands} &nbsp; • &nbsp; <strong>Saved:</strong> ${escapeHTML(when)}</p>`;
  html += `<div class="winners"><h3>Final Totals</h3>`;
  (summary.players||[]).forEach(p=>{
    const bal = Number(p.finalBalance||0);
    html += `<div class="deltaRow"><div>${escapeHTML(p.name)}</div><div class="${bal>=0?'deltaPlus':'deltaMinus'}">${bal>=0?'+':''}${bal.toFixed(2)}</div></div>`;
    html += `<div class="hint" style="margin-left:6px">HE wins: ${p.stats.winsHE||0} • PLO wins: ${p.stats.winsPLO||0} • Scoops: ${p.stats.scoops||0} • Hands: ${p.stats.handsPlayed||0}</div>`;
  });
  html += `</div>`;
  inf.innerHTML = html;

  state.stage='terminated';
  show(terminated);
});

// Scoop fireworks
function playScoopFX(){
  scoopFX.classList.remove('hidden');
  setTimeout(()=>scoopFX.classList.add('hidden'), 2600);
}

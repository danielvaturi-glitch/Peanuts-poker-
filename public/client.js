// Client — only adjustments: chat as sidebar w/ minimize, shown only in room

const socket = io();
const $ = id => document.getElementById(id);

// Sections / Elements
const homeHero = $("homeHero");
const lobby = $("lobby"), selecting = $("selecting"), revealed = $("revealed"), results = $("results");
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
const scoopFX = $("scoopFX");

// Chat sidebar elements
const chatDock = $("chatDock");
const chatBody = $("chatBody");
const chatCollapsed = $("chatCollapsed");
const chatToggle = $("chatToggle");
const chatLog = $("chatLog");
const chatInput = $("chatInput");
const chatSend = $("chatSend");

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
  yourCards: [], pickH: new Set(), pickP: new Set(),
  picksByPlayer:{}, equities:{he:{},plo:{}},
  finalPicksByPlayer:{}, finalEquities:{he:{},plo:{}},
  board:[], stage:'home', selectionRemainingMs:0,
  chatCollapsed: false
};

// Show helper: chat only in room screens; never on home
function show(section){
  [lobby, selecting, revealed, results].forEach(x=>x.classList.add("hidden"));
  section.classList.remove("hidden");

  // Home vs Room visibility
  if(section===lobby || section===selecting || section===revealed || section===results){
    homeHero.classList.add("hidden");
    chatDock.classList.remove("hidden");
    if(!state.chatCollapsed) document.body.classList.add('chat-open');
  } else {
    homeHero.classList.remove("hidden");
    chatDock.classList.add("hidden");
    document.body.classList.remove('chat-open');
  }
}

// Chat toggle/minimize
function collapseChat(setCollapsed){
  state.chatCollapsed = setCollapsed;
  chatDock.classList.toggle('collapsed', state.chatCollapsed);
  chatCollapsed.classList.toggle('hidden', !state.chatCollapsed);
  // Shift content only when chat is visible and not collapsed
  const inRoom = !(homeHero && !homeHero.classList.contains('hidden'));
  if(inRoom && !state.chatCollapsed){ document.body.classList.add('chat-open'); }
  else { document.body.classList.remove('chat-open'); }
}
chatToggle.addEventListener('click', ()=> collapseChat(!state.chatCollapsed));
chatCollapsed.addEventListener('click', ()=> collapseChat(false));

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

// Join / Leave
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
    collapseChat(false); // open chat by default in room
    show(lobby);
  });
}
function leaveRoom(){ clearIdentity(); location.reload(); }

// Sit out
function toggleSit(){
  const btn=$("sitBtn");
  const on = btn.getAttribute('data-on')==='1';
  socket.emit('toggleSitOut', !on);
}

// Card rendering (unchanged)
function cardChip(card){
  if(!card) return document.createElement('div');
  const rank=card[0].toUpperCase(), suit=card[1].toLowerCase();
  const red = (suit==='h'||suit==='d');
  const svg = drawCardSVG(rank, suit, red);
  const d=document.createElement('div'); d.className='cardchip'; d.setAttribute('data-card',card); d.innerHTML=svg;
  return d;
}
function drawCardSVG(rank, suit, red){
  const viewW=200, viewH=280;
  const cornerRank = rank==='T' ? '10' : rank;
  const suitChar = suitGlyph(suit);
  const color = red ? '#C1121F' : '#111';
  const pips = pipLayout(rank);
  const isAce = (rank==='A');
  const isFace = (rank==='J'||rank==='Q'||rank==='K');
  const crownPath=`M 40 0 L 55 -18 L 70 0 L 85 -15 L 100 0 L 115 -15 L 130 0 L 145 -18 L 160 0 L 155 22 L 45 22 Z`;
  return `
  <svg class="cardsvg" viewBox="0 0 ${viewW} ${viewH}" role="img" aria-label="${cornerRank}${suitChar}">
    <rect x="2" y="2" width="${viewW-4}" height="${viewH-4}" rx="16" ry="16" fill="white" stroke="#333" stroke-width="4"/>
    <g transform="translate(14,28)" fill="${color}">
      <text class="rank small corner">${cornerRank}</text>
      <text class="corner suit-corner">${suitChar}</text>
    </g>
    <g transform="translate(${viewW-14},${viewH-28}) rotate(180)" fill="${color}">
      <text class="rank small corner">${cornerRank}</text>
      <text class="corner suit-corner">${suitChar}</text>
    </g>
    ${pips.length? renderPips(pips, suitChar, color) : ''}
    ${isAce? `<text x="${viewW/2}" y="${viewH/2+24}" text-anchor="middle" class="aceSuit" fill="${color}">${suitChar}</text>`:''}
    ${isFace? `
      <g transform="translate(${viewW/2}, ${viewH/2})">
        <rect x="-60" y="-90" width="120" height="180" rx="12" ry="12" fill="${red ? '#FCE6E9' : '#EEF1F5'}" stroke="${color}" stroke-width="2"/>
        <text x="0" y="-36" text-anchor="middle" class="faceLetter" fill="${color}">${rank}</text>
        <g transform="translate(-80, 10)" fill="${color}"><path d="${crownPath}"></path></g>
        <text x="0" y="64" text-anchor="middle" class="faceSuit" fill="${color}">${suitChar}</text>
      </g>`:''}
  </svg>`;
}
function suitGlyph(s){ return s==='c'?'♣' : s==='d'?'♦' : s==='h'?'♥' : '♠'; }
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
function renderPips(pips, suitChar, color){
  return pips.map(({x,y})=>`<text x="${x}" y="${y}" text-anchor="middle" class="pip" fill="${color}">${suitChar}</text>`).join('');
}

// Select / picks
function renderHand(cards){
  yourHandEl.innerHTML=''; (cards||[]).forEach(c=>yourHandEl.appendChild(cardChip(c)));
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
  [...state.pickH].forEach(c=>pickHoldemEl.appendChild(cardChip(c)));
  [...state.pickP].forEach(c=>pickPLOEl.appendChild(cardChip(c)));
}

// Players / board
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
  lockStatus.innerHTML='';
  players.forEach(p=>{
    const d=document.createElement('div'); d.className='playerRow';
    d.innerHTML = `<div>${escapeHTML(p.name)}</div><div>${p.locked?'<span class="badge">Locked</span>':'<span class="badge warn">Waiting</span>'}</div>`;
    lockStatus.appendChild(d);
  });
}
function renderBoard(elm,cards){ elm.innerHTML=''; (cards||[]).forEach(c=>elm.appendChild(cardChip(c))); }
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
    (entry.holdem||[]).forEach(c=>heRow.appendChild(cardChip(c)));
    const hePct=document.createElement('div'); hePct.className='eq'; hePct.textContent=`${heEq}%`; heRow.appendChild(hePct);

    const ploRow=document.createElement('div'); ploRow.className='handRow';
    ploRow.innerHTML='<div class="label">PLO</div>';
    (entry.plo||[]).forEach(c=>ploRow.appendChild(cardChip(c)));
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

// Chat sockets
socket.on('chatBacklog', msgs=>{ chatLog.innerHTML=''; (msgs||[]).forEach(addChatLine); });
socket.on('chatMessage', addChatLine);

// Helpers
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
      if(res?.ok){ state.room=room; state.token=res.token; state.you=res.name; roomBadge.textContent=`Room ${room}`; collapseChat(false); show(lobby); }
    });
  } else {
    // Ensure home shows and chat hidden on first load
    homeHero.classList.remove('hidden');
    chatDock.classList.add('hidden');
    document.body.classList.remove('chat-open');
  }
});

// ROOM UPDATES
socket.on('roomUpdate', data=>{
  state.stage = data.stage;
  state.board = data.board||[];
  state.selectionRemainingMs = data.selectionRemainingMs||0;

  // Show appropriate section; chat only in room screens
  if (data.stage==='lobby'){ show(lobby); }
  if (data.stage==='selecting'){ show(selecting); socket.emit('requestYourCards'); startCountdown(); }
  if (data.stage==='revealed'){ show(revealed); }
  if (data.stage==='results'){ show(results); }

  // Update room UI
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

socket.on('yourCards', ({cards})=>{
  state.yourCards = cards||[]; state.pickH=new Set(); state.pickP=new Set();
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

  if(Array.isArray(payload.players) && payload.players.length){
    window._playersCache = payload.players.map(p=>({id:p.id, name:p.name, balance:+(p.balance||0)}));
    renderPlayers(window._playersCache);
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

// Scoop fireworks
function playScoopFX(){
  scoopFX.classList.remove('hidden');
  setTimeout(()=>scoopFX.classList.add('hidden'), 2600);
}

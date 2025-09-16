// Peanuts Poker — Stable flow + Collapsible Options (no gameplay changes)

const socket = io();
const $ = id => document.getElementById(id);

// Sections
const homeHero = $("homeHero");
const lobby = $("lobby"), selecting = $("selecting"), revealed = $("revealed"), results = $("results"), terminated = $("terminated");

// Elements
const roomBadge = $("roomBadge"), handBadge = $("handBadge");
const handBadgeSel = $("handBadgeSel"), handBadgeRes = $("handBadgeRes");
const anteInput = $("anteInput"), anteLockedBadge = $("anteLockedBadge");
const playersDiv = $("players");
const yourHandEl = $("yourHand"), pickHoldemEl = $("pickHoldem"), pickPLOEl = $("pickPLO");
const boardEl = $("board"), revealBtn = $("revealBtn");
const finalBoardEl = $("finalBoard"), winnersDiv = $("winners");
const tableGrid = $("tableGrid"), tableGridFinal = $("tableGridFinal");

// Options UI
const optionsPanel = $("optionsPanel");
const toggleOptionsBtn = $("toggleOptions");
const collapseOptionsBtn = $("collapseOptions");

// Buttons
$("joinBtn").onclick = joinRoom;
$("leaveBtn").onclick = leaveRoom;
$("lockAnte").onclick = ()=>socket.emit('lockAnte');
$("startBtn").onclick = startHandAndCollapseOptions;
$("lockBtn").onclick = lockSelections;
$("revealBtn").onclick = ()=>socket.emit('revealNextStreet');
$("nextBtn").onclick = ()=>socket.emit('startHand');
$("changeSettingsBtn").onclick = ()=>socket.emit('changeSettings');
$("terminateBtn").onclick = ()=>socket.emit('terminateRoom');
$("terminateBtn2").onclick = ()=>socket.emit('terminateRoom');
$("leaveFromSummary").onclick = leaveRoom;

// Inputs -> server
anteInput.onchange = ()=>socket.emit('setAnte', Number(anteInput.value)||0);

// Identity
function saveIdentity(token, room){ try{ localStorage.setItem("peanutsToken", token); localStorage.setItem("peanutsRoom", room);}catch{} }
function clearIdentity(){ try{ localStorage.removeItem("peanutsToken"); localStorage.removeItem("peanutsRoom"); }catch{} }
function getIdentity(){ try{ return { token:localStorage.getItem("peanutsToken"), room:localStorage.getItem("peanutsRoom") }; }catch{ return {}; } }

// Options collapse state (persist per room)
function optionsKey(room){ return `pp_opts_collapsed_${room||'__'}`; }
function setOptionsCollapsed(room, collapsed){
  const cl = optionsPanel.classList;
  if(collapsed) cl.add("collapsed"); else cl.remove("collapsed");
  try{ localStorage.setItem(optionsKey(room), collapsed ? "1" : "0"); }catch{}
}
function getOptionsCollapsed(room){
  try{ return localStorage.getItem(optionsKey(room)) === "1"; }catch{ return false; }
}
toggleOptionsBtn?.addEventListener('click', ()=>{
  if(!state.room) return;
  setOptionsCollapsed(state.room, !optionsPanel.classList.contains('collapsed'));
});
collapseOptionsBtn?.addEventListener('click', ()=>{
  if(!state.room) return;
  setOptionsCollapsed(state.room, true);
});

// State
const state = {
  room:null, token:null, you:null,
  yourCards:[], pickH:new Set(), pickP:new Set(),
  youLocked:false,
  stage:'home',
  board:[]
};

// Ensure home is visible first
function initVisibility(){
  [lobby, selecting, revealed, results, terminated].forEach(x=>x.classList.add("hidden"));
  homeHero.classList.remove("hidden");
}
initVisibility();

// Show helper
function show(section){
  [lobby, selecting, revealed, results, terminated].forEach(x=>x.classList.add("hidden"));
  if(section) section.classList.remove("hidden");
  if(section===lobby || section===selecting || section===revealed || section===results || section===terminated){
    homeHero.classList.add("hidden");
  } else {
    homeHero.classList.remove("hidden");
  }
}

/* --------------------------- Join / Leave -------------------------- */
function joinRoom(){
  const room = ($("room").value||'').toUpperCase().trim();
  const name = ($("name")?.value||'Player').trim();
  if(!/^[A-Z0-9]{3,8}$/.test(room)){ alert("Room code must be 3–8 letters/numbers"); return; }
  const {token} = getIdentity();
  const btn=$("joinBtn"); btn.disabled=true; btn.textContent="Joining…";
  socket.emit('joinRoom', {roomCode:room, name, token}, (res)=>{
    btn.disabled=false; btn.textContent="Join Room";
    if(!res?.ok){ alert(res?.error||"Join failed"); return; }
    state.room=room; state.token=res.token; state.you=res.name;
    saveIdentity(res.token, room);
    roomBadge.textContent=`Room ${room}`;

    // Options: First time in room (hand 0) → expanded; otherwise respect saved state
    const collapsed = getOptionsCollapsed(room);
    setOptionsCollapsed(room, (collapsed === true)); // apply saved
    show(lobby);
  });
}
function leaveRoom(){ clearIdentity(); location.reload(); }

/* ------------------------ Collapse on start hand ------------------- */
function startHandAndCollapseOptions(){
  // Collapse options when a hand starts (and remember)
  if(state.room) setOptionsCollapsed(state.room, true);
  socket.emit('startHand');
}

/* --------------------- Card images + SVG fallback ------------------ */
function mapToFilename(card){
  const r = card[0].toUpperCase();
  const s = card[1].toLowerCase();
  const suitWord = { c:'clubs', d:'diamonds', h:'hearts', s:'spades' }[s];
  const rankWord = { T:'10', J:'jack', Q:'queen', K:'king', A:'ace' }[r] || r;
  return `${rankWord}_of_${suitWord}.png`;
}
function imagePath(card){ return `/cards/${mapToFilename(card)}`; }

// minimal crisp SVG fallback
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
function svgFallback(card, mini=false){
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
  return svg;
}
window._cardImgError = function(imgElem, card, mini){
  const wrap = imgElem.parentElement;
  if(!wrap) return;
  wrap.innerHTML = svgFallback(card, mini);
};
function cardChip(card, mini=false){
  const d=document.createElement('div');
  d.className='cardchip';
  if(mini) d.classList.add('mini');
  d.setAttribute('data-card',card);

  const img=document.createElement('img');
  img.className = mini ? 'cardimg mini' : 'cardimg';
  img.alt = card;
  img.src = imagePath(card);
  img.onerror = ()=>window._cardImgError(img, card, mini);

  d.appendChild(img);
  return d;
}

/* ----------------------------- UI render -------------------------- */
function renderPlayers(players=[]){
  playersDiv.innerHTML='';
  players.forEach(p=>{
    const row=document.createElement('div'); row.className='playerRow';
    const bal=Number(p.balance||0), balStr=(bal>=0?'+':'')+bal.toFixed(2);
    row.innerHTML=`
      <div>
        <span class="namechip">${p.name}</span>
        ${p.locked?'<span class="badge">Locked</span>':''}
      </div>
      <div>${balStr}</div>`;
    playersDiv.appendChild(row);
  });
  anteLockedBadge.classList.toggle('hidden', !window._anteLockedFlag);
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
  if(state.youLocked) return;
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
  [...yourHandEl.querySelectorAll('.cardchip')].forEach(node=>{
    const c=node.getAttribute('data-card');
    node.classList.toggle('selected', state.pickH.has(c)||state.pickP.has(c));
  });
}
function renderBoard(el,cards){ el.innerHTML=''; (cards||[]).forEach(c=>el.appendChild(cardChip(c,false))); }
function renderYourLockedSeat(container){
  container.innerHTML = '';
  const seat=document.createElement('div'); seat.className='seat';
  seat.innerHTML = `
    <div class="pname">${state.you||'You'}</div>
    <div class="handRow"><div class="label">HE</div><div class="cards he"></div></div>
    <div class="handRow"><div class="label">PLO</div><div class="cards plo"></div></div>
  `;
  const he = seat.querySelector('.cards.he');
  const plo = seat.querySelector('.cards.plo');
  [...state.pickH].forEach(c=>he.appendChild(cardChip(c,true)));
  [...state.pickP].forEach(c=>plo.appendChild(cardChip(c,true)));
  container.appendChild(seat);
}

/* ---------------------------- Actions ----------------------------- */
function lockSelections(){
  if(state.pickH.size!==2 || state.pickP.size!==4){ alert("Pick 2 for HE and 4 for PLO."); return; }
  socket.emit('makeSelections', { holdemTwo:[...state.pickH], ploFour:[...state.pickP] });
}

/* --------------------------- Auto rejoin -------------------------- */
window.addEventListener('load', ()=>{
  const { token, room } = getIdentity();
  if(token && room && /^[A-Z0-9]{3,8}$/.test(room)){
    $("room").value = room;
    socket.emit('joinRoom', {roomCode:room, name:'', token}, (res)=>{
      if(res?.ok){
        state.room=room; state.token=res.token; state.you=res.name;
        roomBadge.textContent=`Room ${room}`;
        // Apply saved options collapsed state for this room
        setOptionsCollapsed(room, getOptionsCollapsed(room));
        show(lobby);
      } else {
        // stay on home if token invalid / room missing
        initVisibility();
      }
    });
  } else {
    initVisibility();
  }
});

/* -------------------------- Socket events ------------------------- */
socket.on('roomUpdate', data=>{
  state.stage = data.stage;
  window._anteLockedFlag = !!data.anteLocked;

  // are you locked?
  const me = (data.players||[]).find(p => p.id === state.token);
  state.youLocked = !!me?.locked;

  if(data.stage==='lobby'){ show(lobby); }
  if(data.stage==='selecting'){ show(selecting); socket.emit('requestYourCards'); }
  if(data.stage==='revealed'){ show(revealed); renderYourLockedSeat(tableGrid); }
  if(data.stage==='results'){ show(results); renderYourLockedSeat(tableGridFinal); }

  renderPlayers(data.players||[]);
  anteInput.value = data.ante||0;
  handBadge.textContent = `Hand #${data.handNumber||0}`;
  handBadgeSel.textContent = `${data.handNumber||0}`;
  handBadgeRes.textContent = `${data.handNumber||0}`;

  renderBoard(boardEl, data.board||[]);
  updateRevealButton(data.board||[]);
});

socket.on('yourCards', ({cards})=>{
  state.yourCards = cards||[];
  if(!state.youLocked){
    state.pickH.clear(); state.pickP.clear();
  }
  renderHand(state.yourCards);
});

socket.on('sessionSummary', ({summary, savedAt})=>{
  const s = $("summaryInfo");
  const when = new Date(savedAt||Date.now()).toLocaleString();
  let html = `<p><strong>Room:</strong> ${summary.room} • <strong>Hands:</strong> ${summary.hands} • <strong>Saved:</strong> ${when}</p>`;
  html += `<div class="winners"><h3>Final Totals</h3>`;
  (summary.players||[]).forEach(p=>{
    const bal = Number(p.finalBalance||0);
    html += `<div class="handRow"><div class="pname">${p.name}</div><div class="eq">${bal>=0?'+':''}${bal.toFixed(2)}</div></div>`;
  });
  html += `</div>`;
  s.innerHTML=html;
  show(terminated);
});

/* ----------------------------- UI bits ---------------------------- */
function updateRevealButton(board){
  const n=(board||[]).length;
  if(state.stage!=='revealed'){ revealBtn.disabled=true; revealBtn.textContent='Reveal Flop'; return; }
  revealBtn.disabled=false;
  if(n===0) revealBtn.textContent='Reveal Flop';
  else if(n===3) revealBtn.textContent='Reveal Turn';
  else if(n===4) revealBtn.textContent='Reveal River';
  else revealBtn.disabled=true;
}

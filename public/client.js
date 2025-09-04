const socket = io();
const $ = id => document.getElementById(id);

// Sections
const homeHero = $("homeHero");
const lobby = $("lobby"), selecting = $("selecting"), revealed = $("revealed"), results = $("results");

// Elements
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
function saveIdentity(token, room){
  try{
    localStorage.setItem("peanutsToken", token);
    localStorage.setItem("peanutsRoom", room);
  }catch{}
}
function clearIdentity(){
  try{
    localStorage.removeItem("peanutsToken");
    localStorage.removeItem("peanutsRoom");
  }catch{}
}
function getIdentity(){
  try{
    return { 
      token:localStorage.getItem("peanutsToken"),
      room:localStorage.getItem("peanutsRoom")
    };
  }catch{ return {}; }
}

// State
const state = {
  room:null, token:null, you:null,
  stage:'home',
  yourCards:[], pickH:new Set(), pickP:new Set(),
  dealKey:null,
  picksByPlayer:{}, equities:{he:{},plo:{}},
  finalPicksByPlayer:{}, finalEquities:{he:{},plo:{}},
  board:[], selectionRemainingMs:0
};

// Show helper
function show(section){
  [lobby, selecting, revealed, results].forEach(x=>x.classList.add("hidden"));
  if(section) section.classList.remove("hidden");
  if(section===lobby || section===selecting || section===revealed || section===results){
    homeHero.classList.add("hidden");
  } else {
    homeHero.classList.remove("hidden");
  }
}

// Join / Leave
function joinRoom(){
  const room = ($("room").value||'').toUpperCase().trim();
  const name = ($("name")?.value||'Player').trim();
  if(!/^[A-Z0-9]{3,8}$/.test(room)){
    alert("Room code must be 3–8 letters/numbers");
    return;
  }

  const {token} = getIdentity();
  $("joinBtn").disabled=true; $("joinBtn").textContent="Joining…";
  socket.emit('joinRoom', {roomCode:room, name, token}, (res)=>{
    $("joinBtn").disabled=false; $("joinBtn").textContent="Join Room";
    if(!res?.ok){
      alert(res?.error||"Join failed");
      return;
    }

    state.room=room; state.token=res.token; state.you=res.name;
    saveIdentity(res.token, room);
    roomBadge.textContent = `Room ${room}`;

    // ✅ Immediately show lobby after join
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

// Cards rendering (placeholder — keep your existing render code for sharp suits)
function cardChip(card, mini=false){
  const d=document.createElement('div');
  d.className='cardchip'; if(mini) d.classList.add('mini');
  d.setAttribute('data-card',card);
  d.textContent=card; // use your SVG rendering here
  return d;
}

// Render helpers
function renderHand(cards){
  yourHandEl.innerHTML='';
  (cards||[]).forEach(c=>yourHandEl.appendChild(cardChip(c, false)));
}
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
}
function renderBoard(elm,cards){ elm.innerHTML=''; (cards||[]).forEach(c=>elm.appendChild(cardChip(c, false))); }

// Lock selections
function lockSelections(){
  if(state.pickH.size!==2 || state.pickP.size!==4){
    alert("Pick 2 for HE and 4 for PLO.");
    return;
  }
  socket.emit('makeSelections', { holdemTwo:[...state.pickH], ploFour:[...state.pickP] });
}

// Auto-rejoin
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
  } else {
    homeHero.classList.remove('hidden');
  }
});

// SOCKET EVENTS
socket.on('roomUpdate', data=>{
  state.stage = data.stage;
  state.board = data.board||[];

  if (data.stage==='lobby'){ show(lobby); }
  if (data.stage==='selecting'){ show(selecting); socket.emit('requestYourCards'); }
  if (data.stage==='revealed'){ show(revealed); }
  if (data.stage==='results'){ show(results); }

  renderPlayers(data.players);
  anteInput.value = data.ante||0;
  scoopInput.value = data.scoopBonus||0;
  timerInput.value = data.selectionSeconds||45;
  handBadge.textContent = `Hand #${data.handNumber||0}`;
  handBadgeSel.textContent = `${data.handNumber||0}`;
  handBadgeRes.textContent = `${data.handNumber||0}`;
});

// Your cards
socket.on('yourCards', ({cards})=>{
  state.yourCards = cards||[];
  renderHand(state.yourCards);
});

// Results
socket.on('results', payload=>{
  renderBoard(finalBoardEl, payload.board||[]);
  winnersDiv.innerHTML = JSON.stringify(payload.winners||{});
  show(results);
});

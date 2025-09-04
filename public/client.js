// public/client.js — full version with realistic card graphics

const socket = io();
const el = id => document.getElementById(id);

const intro = el("intro"),
      lobby = el("lobby"),
      selecting = el("selecting"),
      revealed = el("revealed"),
      results = el("results");

const chatBox = el("chat"),
      chatLog = el("chatLog"),
      chatInput = el("chatInput"),
      handBadge = el("handBadge"),
      roomBadge = el("roomBadge"),
      finalModal = el("finalModal"),
      finalTable = el("finalTable"),
      revealBtn = el("revealBtn"),
      countdownEl = el("countdown"),
      lockStatus = el("lockStatus"),
      yourHandEl = el("yourHand");

function show(v){
  [intro,lobby,selecting,revealed,results].forEach(x=>x.classList.add("hidden"));
  v.classList.remove("hidden");
  chatBox.classList.remove("hidden");
}
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;","&gt;":">&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function setBadges(roomCode, handNumber){
  if(roomBadge) roomBadge.textContent=roomCode?`Room ${roomCode}`:'';
  if(handBadge) handBadge.textContent=handNumber?`Hand #${handNumber}`:'';
}

const LS_TOKEN_KEY="peanutsToken", LS_ROOM_KEY="peanutsRoom";
function saveIdentity(token, room){ try{ localStorage.setItem(LS_TOKEN_KEY, token); localStorage.setItem(LS_ROOM_KEY, room);}catch{} }
function clearIdentity(){ try{ localStorage.removeItem(LS_TOKEN_KEY); localStorage.removeItem(LS_ROOM_KEY);}catch{} }
function getIdentity(){ try{ return { token:localStorage.getItem(LS_TOKEN_KEY), room:localStorage.getItem(LS_ROOM_KEY) }; }catch{ return {}; } }

/* ------------------ Realistic Card SVGs ------------------ */
function cardChip(card){
  if(!card) return document.createElement('div');
  const rank = card[0].toUpperCase();
  const suit = card[1].toLowerCase();
  const red = (suit==='h' || suit==='d');
  const svg = drawCardSVG(rank, suit, red);
  const d = document.createElement('div');
  d.className = 'cardchip';
  d.setAttribute('data-card', card);
  d.innerHTML = svg;
  return d;
}

function drawCardSVG(rank, suit, red){
  const viewW=200, viewH=280;
  const cornerRank = rank === 'T' ? '10' : rank;
  const suitChar = suitGlyph(suit);
  const textColor = red ? '#C1121F' : '#111';

  const pips = pipLayout(rank);
  const hasPips = pips.length > 0;
  const isAce = (rank==='A');
  const isFace = (rank==='J'||rank==='Q'||rank==='K');

  const crownPath = `
    M 40 0 L 55 -18 L 70 0 L 85 -15 L 100 0 L 115 -15 L 130 0 L 145 -18 L 160 0
    L 155 22 L 45 22 Z
  `;

  return `
  <svg class="cardsvg" viewBox="0 0 ${viewW} ${viewH}" role="img" aria-label="${cornerRank}${suitChar}">
    <rect x="2" y="2" width="${viewW-4}" height="${viewH-4}" rx="16" ry="16" fill="white" stroke="#333" stroke-width="4"/>
    <g transform="translate(14,28)" fill="${textColor}">
      <text class="rank small corner">${cornerRank}</text>
      <text class="corner suit-corner">${suitChar}</text>
    </g>
    <g transform="translate(${viewW-14},${viewH-28}) rotate(180)" fill="${textColor}">
      <text class="rank small corner">${cornerRank}</text>
      <text class="corner suit-corner">${suitChar}</text>
    </g>
    ${hasPips ? renderPips(pips, suitChar, textColor) : ''}
    ${isAce ? `<text x="${viewW/2}" y="${viewH/2+24}" text-anchor="middle" class="aceSuit" fill="${textColor}">${suitChar}</text>` : ''}
    ${isFace ? `
      <g transform="translate(${viewW/2}, ${viewH/2})">
        <rect x="-60" y="-90" width="120" height="180" rx="12" ry="12" fill="${red ? '#FCE6E9' : '#EEF1F5'}" stroke="${textColor}" stroke-width="2"/>
        <text x="0" y="-36" text-anchor="middle" class="faceLetter" fill="${textColor}">${rank}</text>
        <g transform="translate(-80, 10)" fill="${textColor}">
          <path d="${crownPath}"></path>
        </g>
        <text x="0" y="64" text-anchor="middle" class="faceSuit" fill="${textColor}">${suitChar}</text>
      </g>` : ''}
  </svg>`;
}

function suitGlyph(s){ return s==='c'?'♣' : s==='d'?'♦' : s==='h'?'♥' : '♠'; }
function pipLayout(rank){
  const cx = 100, top=46, midTop=88, mid=140, midBot=192, bot=234;
  const left=52, right=148;
  const T = (x,y)=>({x,y});
  const Pair = y=>[T(left,y),T(right,y)];
  switch(rank){
    case '2': return [T(cx,top),T(cx,bot)];
    case '3': return [T(cx,top),T(cx,mid),T(cx,bot)];
    case '4': return [...Pair(top),...Pair(bot)];
    case '5': return [...Pair(top),T(cx,mid),...Pair(bot)];
    case '6': return [...Pair(top),...Pair(mid),...Pair(bot)];
    case '7': return [...Pair(top),...Pair(mid),...Pair(bot),T(cx,midTop)];
    case '8': return [...Pair(top),...Pair(mid),...Pair(bot),...Pair(midTop)];
    case '9': return [...Pair(top),...Pair(midTop),...Pair(mid),...Pair(midBot),T(cx,mid)];
    case '10': case 'T': return [...Pair(top),...Pair(midTop),...Pair(mid),...Pair(midBot),...Pair(bot)];
    default: return [];
  }
}
function renderPips(pips, suitChar, color){
  return pips.map(({x,y})=>`<text x="${x}" y="${y}" text-anchor="middle" class="pip" fill="${color}">${suitChar}</text>`).join('');
}

/* State */
const state={ room:null, token:null, you:null, yourCards:[], pickH:new Set(), pickP:new Set() };

/* Render Hand + Selection */
function renderHand(cards){
  yourHandEl.innerHTML='';
  (cards||[]).forEach(card=> yourHandEl.appendChild(cardChip(card)));
}
if (yourHandEl) {
  yourHandEl.addEventListener('click', e=>{
    const chip = e.target.closest('.cardchip'); if(!chip) return;
    toggleSelection(chip.getAttribute('data-card'));
  });
}
function toggleSelection(card){
  if(!card) return;
  if(state.pickH.has(card)){ state.pickH.delete(card); }
  else if(state.pickP.has(card)){ state.pickP.delete(card); }
  else if(state.pickH.size<2){ state.pickH.add(card); }
  else if(state.pickP.size<4){ state.pickP.add(card); }
  renderHand(state.yourCards);
  [...yourHandEl.querySelectorAll('.cardchip')].forEach(node=>{
    const c=node.getAttribute('data-card');
    if(state.pickH.has(c)||state.pickP.has(c)) node.classList.add('selected');
  });
}

/* ---- Rest of your existing client.js socket handlers, UI updates, etc. ---- */
/* (unchanged from the last working version, only cardChip was swapped) */

// public/client.js — minimal to verify page + cards render
const socket = io();
const el = id => document.getElementById(id);

const intro = el("intro"), lobby = el("lobby"), selecting = el("selecting"), revealed = el("revealed"), results = el("results");
const chatBox = el("chat"), yourHandEl = el("yourHand");

/* ---------- Card rendering (realistic pips) ---------- */
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
  const crownPath = `M 40 0 L 55 -18 L 70 0 L 85 -15 L 100 0 L 115 -15 L 130 0 L 145 -18 L 160 0 L 155 22 L 45 22 Z`;
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
  const cx=100, top=46, midTop=88, mid=140, midBot=192, bot=234;
  const left=52, right=148; const T=(x,y)=>({x,y}); const Pair=y=>[T(left,y),T(right,y)];
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

/* --- Minimal UI to prove it loads properly --- */
function show(v){ [intro,lobby,selecting,revealed,results].forEach(x=>x.classList.add("hidden")); v.classList.remove("hidden"); chatBox?.classList.remove("hidden"); }
document.getElementById('joinBtn').onclick = ()=>{
  // Demo: show some sample cards so you can verify visuals
  show(selecting);
  const sample = ['2h','4s','7d','Tc','Qh','As'];
  yourHandEl.innerHTML = '';
  sample.forEach(c => yourHandEl.appendChild(cardChip(c)));
};

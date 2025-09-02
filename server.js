// public/client.js
// Client-side logic for Peanuts Poker (Hold'em + PLO) with SVG card faces

/* ------------------ Socket ------------------ */
const socket = io();

/* ------------------ DOM helpers ------------------ */
const el = (id) => document.getElementById(id);
const intro = el("intro");
const lobby = el("lobby");
const selecting = el("selecting");
const revealed = el("revealed");
const results = el("results");

function show(view) {
  [intro, lobby, selecting, revealed, results].forEach((v) =>
    v.classList.add("hidden")
  );
  view.classList.remove("hidden");
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

/* ------------------ Card rendering (SVG) ------------------ */
/** Build a pretty card DOM node with inline SVG (no external images). */
function cardChip(card) {
  // card like "Ah", "Td", "7s", "Qc"
  const rankChar = card[0].toUpperCase();
  const suitChar = card[1].toLowerCase();

  const rankPretty = (r => (r === 'T' ? '10' : r))(rankChar);
  const suitSymbol = ({ c: '♣', d: '♦', h: '♥', s: '♠' })[suitChar] || '?';
  const isRed = (suitChar === 'h' || suitChar === 'd');
  const colorClass = isRed ? 'red' : 'black';

  const svg = `
    <svg class="cardsvg" viewBox="0 0 200 280" role="img" aria-label="${rankPretty}${suitSymbol}">
      <!-- Corners -->
      <g transform="translate(12, 18)" class="${colorClass}">
        <text class="rank small corner" x="0" y="22">${rankPretty}</text>
        <text class="corner" x="2" y="46" style="font:700 22px/1 'Segoe UI Symbol','Apple Color Emoji','Noto Color Emoji'">${suitSymbol}</text>
      </g>
      <g transform="translate(188, 262) rotate(180)" class="${colorClass}">
        <text class="rank small corner" x="0" y="22">${rankPretty}</text>
        <text class="corner" x="2" y="46" style="font:700 22px/1 'Segoe UI Symbol','Apple Color Emoji','Noto Color Emoji'">${suitSymbol}</text>
      </g>
      <!-- Center suit -->
      <g class="${colorClass}">
        <text class="suit center" x="100" y="155" text-anchor="middle">${suitSymbol}</text>
      </g>
    </svg>
  `;

  const div = document.createElement("div");
  div.className = "cardchip";
  div.setAttribute("data-card", card);
  div.innerHTML = svg;
  return div;
}

/* ------------------ Client state ------------------ */
const state = {
  room: null,
  you: null,
  isHost: false,
  yourCards: [],
  pickH: new Set(), // 2 for Hold'em
  pickP: new Set(), // 4 for PLO
};

/* ------------------ Rendering ------------------ */
function renderPlayers(players) {
  const c = el("players");
  c.innerHTML = "";
  players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "playerRow";
    const bal = Number(p.balance || 0);
    const balStr = (bal >= 0 ? "+" : "") + bal.toFixed(2);
    row.innerHTML = `
      <div>
        <span class="namechip">${escapeHtml(p.name)}</span>
        ${p.isHost ? '<span class="badge">Host</span>' : ""}
        ${p.locked ? '<span class="badge">Locked</span>' : ""}
      </div>
      <div class="${bal >= 0 ? "positive" : "negative"} mono">${balStr}</div>
    `;
    c.appendChild(row);
  });
}

function renderBoard(targetId, cards) {
  const cont = el(targetId);
  cont.innerHTML = "";
  (cards || []).forEach((c) => cont.appendChild(cardChip(c)));
}

function renderHand(cards) {
  const cont = el("yourHand");
  cont.innerHTML = "";
  (cards || []).forEach((card) => {
    const chip = cardChip(card);
    chip.addEventListener("click", () => toggleSelection(card));
    if (state.pickH.has(card) || state.pickP.has(card)) chip.classList.add("selected");
    cont.appendChild(chip);
  });
}

function renderPickBoxes() {
  const h = el("pickHoldem");
  const p = el("pickPLO");
  h.innerHTML = "";
  p.innerHTML = "";
  Array.from(state.pickH).forEach((card) => h.appendChild(cardChip(card)));
  Array.from(state.pickP).forEach((card) => p.appendChild(cardChip(card)));
}

/* ------------------ Selection logic ------------------ */
function toggleSelection(card) {
  const inH = state.pickH.has(card);
  const inP = state.pickP.has(card);

  if (!inH && !inP) {
    if (state.pickH.size < 2) state.pickH.add(card);
    else if (state.pickP.size < 4) state.pickP.add(card);
    else return; // already full
  } else if (inH) {
    state.pickH.delete(card);
  } else if (inP) {
    state.pickP.delete(card);
  }

  renderHand(state.yourCards);
  renderPickBoxes();
}

/* ------------------ UI events ------------------ */
el("joinBtn").onclick = () => {
  const roomCode = el("room").value;
  const name = el("name").value;
  socket.emit("joinRoom", { roomCode, name }, (res) => {
    if (!res?.ok) return alert(res?.error || "Failed to join.");
    state.room = roomCode;
    state.you = res.name;
    state.isHost = !!res.isHost;
    show(lobby);
  });
};

el("setAnte").onclick = () => {
  if (!state.isHost) return;
  const anteVal = Number(el("anteInput").value) || 0;
  socket.emit("setAnte", anteVal);
};

el("startBtn").onclick = () => {
  if (state.isHost) socket.emit("startHand");
};

el("lockBtn").onclick = () => {
  if (state.pickH.size !== 2 || state.pickP.size !== 4)
    return alert("Pick 2 for Hold’em and 4 for PLO before locking.");
  socket.emit(
    "makeSelections",
    { holdemTwo: Array.from(state.pickH), ploFour: Array.from(state.pickP) },
    (res) => {
      if (!res?.ok) alert(res?.error || "Could not lock selections.");
    }
  );
};

el("nextBtn").onclick = () => {
  if (state.isHost) socket.emit("nextHand");
};

/* ------------------ Socket events ------------------ */
socket.on("roomUpdate", (data) => {
  renderPlayers(data.players);
  el("anteInput").value = data.ante || 0;

  if (data.stage === "lobby") show(lobby);
  else if (data.stage === "selecting") show(selecting);
  else if (data.stage === "revealed") {
    show(revealed);
    renderBoard("board", data.board || []);
  } else if (data.stage === "results") {
    show(results);
  }
});

socket.on("yourCards", ({ cards }) => {
  state.yourCards = cards || [];
  state.pickH = new Set();
  state.pickP = new Set();
  renderHand(state.yourCards);
  renderPickBoxes();
  show(selecting);
});

socket.on("results", (payload) => {
  renderBoard("finalBoard", payload.board || []);

  const winnersDiv = el("winners");
  const nameOf = (sid) => payload.picks[sid]?.name || sid;
  const holdemNames = (payload.winners?.holdem || []).map(nameOf).join(", ");
  const ploNames = (payload.winners?.plo || []).map(nameOf).join(", ");
  const scoopNames = (payload.scoops || []).map(nameOf).join(", ");

  let html = "";
  html += `<p><strong>Hold’em:</strong> ${escapeHtml(holdemNames || "-")}</p>`;
  html += `<p><strong>PLO:</strong> ${escapeHtml(ploNames || "-")}</p>`;
  if (payload.scoops && payload.scoops.length) {
    html += `<p>💥 SCOOP by ${escapeHtml(scoopNames)}</p>`;
  }
  winnersDiv.innerHTML = html;

  show(results);
});

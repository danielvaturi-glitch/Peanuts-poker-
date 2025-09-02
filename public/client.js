// public/client.js
// Client-side logic for Peanuts Poker (Hold'em + PLO) with SVG card faces + robust join

/* ------------------ Socket ------------------ */
const socket = io();

// Connection diagnostics (helps when "Join" seems to do nothing)
socket.on("connect", () => console.log("[socket] connected:", socket.id));
socket.on("connect_error", (err) => {
  console.error("[socket] connect_error:", err);
  alert("Could not connect to the server. Please refresh the page.");
});
socket.on("disconnect", (reason) => console.warn("[socket] disconnected:", reason));

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
      <!-- Card background -->
      <rect x="2" y="2" width="196" height="276" rx="16" ry="16" fill="white" stroke="#333" stroke-width="4"/>
      
      <!-- Top-left rank/suit -->
      <g transform="translate(14, 28)" class="${colorClass}">
        <text class="rank small corner" x="0" y="0">${rankPretty}</text>
        <text class="corner" x="0" y="28" style="font:700 24px/1 'Segoe UI Symbol','Apple Color Emoji','Noto Color Emoji'">${suitSymbol}</text>
      </g>
      
      <!-- Bottom-right rank/suit (rotated 180) -->
      <g transform="translate(186, 252) rotate(180)" class="${colorClass}">
        <text class="rank small corner" x="0" y="0">${rankPretty}</text>
        <text class="corner" x="0" y="28" style="font:700 24px/1 'Segoe UI Symbol','Apple Color Emoji','Noto Color Emoji'">${suitSymbol}</text>
      </g>
      
      <!-- Large center suit -->
      <g class="${colorClass}">
        <text class="suit center" x="100" y="160" text-anchor="middle">${suitSymbol}</text>
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
  (players || []).forEach((p) => {
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

/* ------------------ Helper: validate inputs ------------------ */
function normRoom(code) {
  return (code || "").toUpperCase().trim();
}
function isValidRoom(code) {
  return /^[A-Z0-9]{3,8}$/.test(code);
}

/* ------------------ UI events ------------------ */
el("joinBtn").onclick = () => {
  const roomRaw = el("room").value;
  const nameRaw = el("name").value;

  const roomCode = normRoom(roomRaw);
  const name = (nameRaw || "Player").trim();

  if (!isValidRoom(roomCode)) {
    alert("Room code must be 3–8 letters/numbers.");
    el("room").focus();
    return;
  }
  if (!name) {
    alert("Please enter your name.");
    el("name").focus();
    return;
  }

  // Disable the Join button briefly to prevent double clicks
  const joinBtn = el("joinBtn");
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining…";

  let responded = false;
  socket.emit("joinRoom", { roomCode, name }, (res) => {
    responded = true;
    joinBtn.disabled = false;
    joinBtn.textContent = "Join";

    if (!res?.ok) {
      console.warn("[joinRoom] error:", res);
      alert(res?.error || "Failed to join room.");
      return;
    }

    state.room = roomCode;
    state.you = res.name;
    state.isHost = !!res.isHost;
    console.log(`[joinRoom] joined ${roomCode} as ${res.name}, host=${state.isHost}`);
    show(lobby);
  });

  // Safety net: if callback never comes back (e.g. connection issue)
  setTimeout(() => {
    if (!responded) {
      joinBtn.disabled = false;
      joinBtn.textContent = "Join";
      alert("Join request timed out. Please check your connection and try again.");
    }
  }, 8000);
};

el("setAnte").onclick = () => {
  if (!state.isHost) return alert("Only the host can set the ante.");
  const anteVal = Number(el("anteInput").value) || 0;
  socket.emit("setAnte", anteVal);
};

el("startBtn").onclick = () => {
  if (!state.isHost) return alert("Only the host can start the hand.");
  socket.emit("startHand");
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
  if (!state.isHost) return alert("Only the host can start the next hand.");
  socket.emit("nextHand");
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

// client.js
const socket = io();

const el = (id) => document.getElementById(id);
const intro = el("intro");
const lobby = el("lobby");
const selecting = el("selecting");
const revealed = el("revealed");
const results = el("results");

const state = {
  room: null,
  you: null,
  isHost: false,
  yourCards: [],
  pickH: new Set(),
  pickP: new Set(),
  lastResults: null
};

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
function cardChip(card) {
  const div = document.createElement("div");
  div.className = "cardchip";
  div.textContent = card.toUpperCase();
  return div;
}
function renderPlayers(players) {
  const c = el("players");
  c.innerHTML = "";
  players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "playerRow";
    const bal = Number(p.balance || 0);
    const balStr = (bal >= 0 ? "+" : "") + bal.toFixed(2);
    div.innerHTML = `
      <div><span class="namechip">${escapeHtml(p.name)}</span> ${
      p.isHost ? '<span class="badge">Host</span>' : ""
    } ${p.locked ? '<span class="badge">Locked</span>' : ""}</div>
      <div class="${bal >= 0 ? "positive" : "negative"} mono">${balStr}</div>
    `;
    c.appendChild(div);
  });
}
function renderBoard(targetId, cards) {
  const cont = el(targetId);
  cont.innerHTML = "";
  cards.forEach((c) => cont.appendChild(cardChip(c)));
}
function renderHand(cards) {
  const cont = el("yourHand");
  cont.innerHTML = "";
  cards.forEach((card) => {
    const chip = cardChip(card);
    chip.addEventListener("click", () => toggleSelection(card));
    if (state.pickH.has(card) || state.pickP.has(card))
      chip.classList.add("selected");
    cont.appendChild(chip);
  });
}
function renderPickBoxes() {
  const h = el("pickHoldem");
  h.innerHTML = "";
  const p = el("pickPLO");
  p.innerHTML = "";
  Array.from(state.pickH).forEach((card) => h.appendChild(cardChip(card)));
  Array.from(state.pickP).forEach((card) => p.appendChild(cardChip(card)));
}
function toggleSelection(card) {
  const inH = state.pickH.has(card);
  const inP = state.pickP.has(card);
  if (!inH && !inP) {
    if (state.pickH.size < 2) state.pickH.add(card);
    else if (state.pickP.size < 4) state.pickP.add(card);
    else return;
  } else if (inH) {
    state.pickH.delete(card);
  } else if (inP) {
    state.pickP.delete(card);
  }
  renderHand(state.yourCards);
  renderPickBoxes();
}

// UI events
el("joinBtn").onclick = () => {
  socket.emit(
    "joinRoom",
    { roomCode: el("room").value, name: el("name").value },
    (res) => {
      if (!res.ok) return alert(res.error);
      state.room = el("room").value;
      state.you = res.name;
      state.isHost = !!res.isHost;
      show(lobby);
    }
  );
};
el("setAnte").onclick = () => {
  if (!state.isHost) return;
  socket.emit("setAnte", Number(el("anteInput").value) || 0);
};
el("startBtn").onclick = () => {
  if (state.isHost) socket.emit("startHand");
};
el("lockBtn").onclick = () => {
  if (state.pickH.size !== 2 || state.pickP.size !== 4)
    return alert("Pick 2 for Hold’em and 4 for PLO");
  socket.emit(
    "makeSelections",
    { holdemTwo: Array.from(state.pickH), ploFour: Array.from(state.pickP) },
    (res) => {
      if (!res.ok) alert(res.error);
    }
  );
};
el("nextBtn").onclick = () => {
  if (state.isHost) socket.emit("nextHand");
};

// Socket events
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
  state.yourCards = cards;
  state.pickH = new Set();
  state.pickP = new Set();
  renderHand(cards);
  renderPickBoxes();
  show(selecting);
});
socket.on("results", (payload) => {
  renderBoard("finalBoard", payload.board || []);
  const w = el("winners");
  const nameOf = (sid) => payload.picks[sid]?.name || sid;
  const holdemNames = payload.winners.holdem.map(nameOf).join(", ");
  const ploNames = payload.winners.plo.map(nameOf).join(", ");
  const scoopNames = payload.scoops.map(nameOf).join(", ");
  let html = "";
  html += `<p><strong>Hold’em:</strong> ${escapeHtml(holdemNames || "-")}</p>`;
  html += `<p><strong>PLO:</strong> ${escapeHtml(ploNames || "-")}</p>`;
  if (payload.scoops.length)
    html += `<p>💥 SCOOP by ${escapeHtml(scoopNames)}</p>`;
  w.innerHTML = html;
  show(results);
});

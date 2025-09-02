// server.js
// Peanuts (PLO+Hold'em) multiplayer room-based game

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static files
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Peanuts server listening on http://localhost:${PORT}`);
});

// -------------------- Game Logic --------------------

const MAX_PLAYERS = 6;

const SUITS = ['c', 'd', 'h', 's'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];

function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const RANK_ORDER = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,
  '8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14
};
const cv = c => RANK_ORDER[c[0]];
const cs = c => c[1];

function rankCounts(cards) {
  const counts = {};
  for (const c of cards) counts[cv(c)] = (counts[cv(c)]||0)+1;
  return Object.entries(counts).map(([v,c])=>({v:+v,c}))
    .sort((a,b)=> (b.c - a.c) || (b.v - a.v));
}

function isFlush(cards) {
  const s = cs(cards[0]);
  return cards.every(c => cs(c) === s);
}

function isStraight(cards) {
  const vals = [...new Set(cards.map(cv))].sort((a,b)=>a-b);
  if (vals.length < 5) return {ok:false};
  for (let i=0;i<=vals.length-5;i++){
    const run = vals.slice(i,i+5);
    if (run[4]-run[0]===4) return {ok:true,high:run[4]};
  }
  if (vals.includes(14) && [2,3,4,5].every(x=>vals.includes(x)))
    return {ok:true,high:5,wheel:true};
  return {ok:false};
}

function sortValsDesc(arr){ return arr.slice().sort((a,b)=>b-a); }

function eval5(cards) {
  const c = cards.slice().sort((a,b)=>cv(b)-cv(a));
  const flush = isFlush(c);
  const straight = isStraight(c);
  const counts = rankCounts(c);

  if (flush && straight.ok) return [8, straight.high];               // Straight flush
  if (counts[0].c===4) return [7, counts[0].v, counts[1].v];          // Quads
  if (counts[0].c===3 && counts[1]?.c===2) return [6, counts[0].v, counts[1].v]; // Full house
  if (flush) return [5, ...sortValsDesc(c.map(cv))];                  // Flush
  if (straight.ok) return [4, straight.high];                         // Straight
  if (counts[0].c===3)                                                // Trips
    return [3, counts[0].v, ...sortValsDesc(counts.filter(e=>e.c===1).map(e=>e.v)).slice(0,2)];
  if (counts[0].c===2 && counts[1]?.c===2) {                          // Two pair
    const hp = Math.max(counts[0].v,counts[1].v);
    const lp = Math.min(counts[0].v,counts[1].v);
    const k = counts.find(e=>e.c===1).v;
    return [2, hp, lp, k];
  }
  if (counts[0].c===2)                                                // One pair
    return [1, counts[0].v, ...sortValsDesc(counts.filter(e=>e.c===1).map(e=>e.v)).slice(0,3)];

  return [0, ...sortValsDesc(c.map(cv))];                             // High card
}

function cmp5(a,b){
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const av=a[i]||0,bv=b[i]||0;
    if (av!==bv) return av>bv?1:-1;
  }
  return 0;
}

function bestOfN(cards){
  let best=null, score=null;
  const n=cards.length;
  for(let a=0;a<n-4;a++)
    for(let b=a+1;b<n-3;b++)
      for(let c=a+2;c<n-2;c++)
        for(let d=a+3;d<n-1;d++)
          for(let e=a+4;e<n;e++){
            const hand=[cards[a],cards[b],cards[c],cards[d],cards[e]];
            const s=eval5(hand);
            if(!score || cmp5(s,score)>0){ score=s; best=hand; }
          }
  return {hand:best,score};
}

const evalHoldem = (hole, board) => bestOfN(hole.concat(board)).score;

function evalPLO(hole4, board){
  const choose2 = a => { const r=[]; for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++) r.push([a[i],a[j]]); return r; };
  const choose3 = a => { const r=[]; for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++) for(let k=j+1;k<a.length;k++) r.push([a[i],a[j],a[k]]); return r; };
  let best=null;
  for (const h of choose2(hole4))
    for (const b of choose3(board)){
      const s = eval5(h.concat(b));
      if (!best || cmp5(s,best)>0) best=s;
    }
  return best;
}

// -------------------- Rooms --------------------
const rooms = new Map();

function getRoom(code){
  if (!rooms.has(code)){
    rooms.set(code, {
      players: new Map(),         // socketId -> { name }
      hostId: null,               // socketId of host
      stage: 'lobby',             // lobby | selecting | revealed | results
      deck: [],
      board: [],
      ante: 0,
      handNumber: 0,
      balances: new Map(),        // socketId -> number
      holes: {}                   // socketId -> { hole:[6], pickHoldem:[2], pickPLO:[4], locked:bool }
    });
  }
  return rooms.get(code);
}

function publicState(room){
  const players=[];
  for (const [sid,p] of room.players.entries()){
    players.push({
      id: sid,
      name: p.name,
      isHost: room.hostId===sid,
      balance: room.balances.get(sid)||0,
      locked: room.holes[sid]?.locked || false
    });
  }
  return {
    stage: room.stage,
    players,
    board: (room.stage==='revealed' || room.stage==='results') ? room.board : [],
    ante: room.ante,
    handNumber: room.handNumber
  };
}

// -------------------- Socket Events --------------------
io.on('connection',(socket)=>{

  socket.on('joinRoom', ({roomCode,name}, cb)=>{
    const code = (roomCode||'').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(code)) return cb({ok:false, error:'Invalid room code'});
    const room = getRoom(code);
    if (room.players.size >= MAX_PLAYERS) return cb({ok:false, error:'Room full'});

    // unique name within room
    let finalName = (name||'Player').trim() || 'Player';
    const names = new Set([...room.players.values()].map(p=>p.name));
    let suffix=1, candidate=finalName;
    while (names.has(candidate)) { candidate = `${finalName} ${suffix++}`; }
    finalName = candidate;

    room.players.set(socket.id, { name: finalName });
    if (!room.hostId) room.hostId = socket.id;
    if (!room.balances.has(socket.id)) room.balances.set(socket.id, 0);
    room.holes[socket.id] = null;

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = finalName;

    io.to(code).emit('roomUpdate', publicState(room));
    cb({ok:true, name: finalName, isHost: room.hostId===socket.id});
  });

  socket.on('setAnte', (ante)=>{
    const code = socket.data.roomCode; if(!code) return;
    const room = getRoom(code);
    if (room.hostId !== socket.id) return;
    room.ante = Math.max(0, Number(ante)||0);
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('startHand', ()=>{
    const code = socket.data.roomCode; if(!code) return;
    const room = getRoom(code);
    if (room.hostId !== socket.id) return;
    if (room.players.size < 2) return;

    room.deck = newDeck();
    room.board = [];
    room.stage = 'selecting';
    room.handNumber += 1;

    for (const [sid] of room.players){
      const hole = [room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop()];
      room.holes[sid] = { hole, pickHoldem: [], pickPLO: [], locked: false };
      room.balances.set(sid, (room.balances.get(sid)||0) - room.ante);
      io.to(sid).emit('yourCards', { cards: hole });
    }

    io.to(code

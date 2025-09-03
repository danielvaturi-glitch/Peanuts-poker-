/* server.js
   Peanuts Poker: rooms persist, sit-out, chat, phased streets w/ equities & outs,
   accounts + lifetime stats in Postgres.
*/
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- Config / DB ---
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- Middleware ---
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Auth helpers ---
async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  return rows[0] || null;
}
async function createUser(username, passHash) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, pass_hash) VALUES ($1,$2) RETURNING id, username',
    [username, passHash]
  );
  await pool.query('INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
  return rows[0];
}
async function getStats(userId) {
  const { rows } = await pool.query('SELECT * FROM user_stats WHERE user_id=$1', [userId]);
  return rows[0] || null;
}
async function addHandsPlayed(userIds) {
  if (!userIds.length) return;
  await pool.query(
    `UPDATE user_stats SET hands_played = hands_played + 1 WHERE user_id = ANY($1::int[])`,
    [userIds]
  );
}
async function addNet(userId, delta) {
  await pool.query(
    `UPDATE user_stats SET total_net = total_net + $2 WHERE user_id=$1`,
    [userId, delta]
  );
}
async function addHeWins(userIds) {
  if (!userIds.length) return;
  await pool.query(`UPDATE user_stats SET he_wins = he_wins + 1 WHERE user_id = ANY($1::int[])`, [userIds]);
}
async function addPloWins(userIds) {
  if (!userIds.length) return;
  await pool.query(`UPDATE user_stats SET plo_wins = plo_wins + 1 WHERE user_id = ANY($1::int[])`, [userIds]);
}
async function addScoops(userId) {
  await pool.query(`UPDATE user_stats SET scoops = scoops + 1 WHERE user_id=$1`, [userId]);
}

function issueToken(user) {
  return jwt.sign({ uid: user.id, u: user.username }, JWT_SECRET, { expiresIn: '30d' });
}
function authMiddleware(req, _res, next) {
  const hdr = req.headers.authorization || '';
  const tok = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (tok) {
    try { req.user = jwt.verify(tok, JWT_SECRET); } catch {}
  }
  next();
}
app.use(authMiddleware);

// --- Auth routes ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok:false, error:'Missing fields' });
    const exists = await findUserByUsername(username);
    if (exists) return res.status(400).json({ ok:false, error:'Username taken' });
    const passHash = await bcrypt.hash(password, 10);
    const u = await createUser(username, passHash);
    const token = issueToken(u);
    res.json({ ok:true, token, username: u.username });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = await findUserByUsername(username);
    if (!u) return res.status(400).json({ ok:false, error:'Invalid credentials' });
    const ok = await bcrypt.compare(password, u.pass_hash);
    if (!ok) return res.status(400).json({ ok:false, error:'Invalid credentials' });
    const token = issueToken(u);
    res.json({ ok:true, token, username: u.username });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});
app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok:false });
  res.json({ ok:true, id: req.user.uid, username: req.user.u });
});
app.get('/api/my-stats', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok:false });
  const stats = await getStats(req.user.uid);
  res.json({ ok:true, stats });
});

// -------------------- Card / Eval / Equity --------------------
const MAX_PLAYERS = 6;
const SUITS = ['c','d','h','s'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_ORDER = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };

const cv = c => RANK_ORDER[c[0]];
const cs = c => c[1];

function newDeck(){
  const d=[]; for(const r of RANKS) for(const s of SUITS) d.push(r+s);
  for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
  return d;
}
function rankCounts(cards){
  const m={}; for(const c of cards) m[cv(c)]=(m[cv(c)]||0)+1;
  return Object.entries(m).map(([v,c])=>({v:+v,c})).sort((a,b)=>(b.c-a.c)||(b.v-a.v));
}
function isFlush(cards){ const s=cs(cards[0]); return cards.every(c=>cs(c)===s); }
function isStraight(cards){
  const vals=[...new Set(cards.map(cv))].sort((a,b)=>a-b);
  if(vals.length<5) return {ok:false};
  for(let i=0;i<=vals.length-5;i++){const run=vals.slice(i,i+5); if(run[4]-run[0]===4) return {ok:true,high:run[4]};}
  if(vals.includes(14)&&[2,3,4,5].every(x=>vals.includes(x))) return {ok:true,high:5,wheel:true};
  return {ok:false};
}
function sortDesc(a){return a.slice().sort((x,y)=>y-x);}
function eval5(cards){
  const c=cards.slice().sort((a,b)=>cv(b)-cv(a));
  const flush=isFlush(c), st=isStraight(c), cnt=rankCounts(c);
  if(flush&&st.ok) return [8,st.high];
  if(cnt[0].c===4) return [7,cnt[0].v,cnt[1].v];
  if(cnt[0].c===3&&cnt[1]?.c===2) return [6,cnt[0].v,cnt[1].v];
  if(flush) return [5,...sortDesc(c.map(cv))];
  if(st.ok) return [4,st.high];
  if(cnt[0].c===3) return [3,cnt[0].v,...sortDesc(cnt.filter(e=>e.c===1).map(e=>e.v)).slice(0,2)];
  if(cnt[0].c===2&&cnt[1]?.c===2){const hp=Math.max(cnt[0].v,cnt[1].v);const lp=Math.min(cnt[0].v,cnt[1].v);const k=cnt.find(e=>e.c===1).v;return [2,hp,lp,k];}
  if(cnt[0].c===2) return [1,cnt[0].v,...sortDesc(cnt.filter(e=>e.c===1).map(e=>e.v)).slice(0,3)];
  return [0,...sortDesc(c.map(cv))];
}
function cmp5(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const A=a[i]||0,B=b[i]||0; if(A!==B) return A>B?1:-1;} return 0;}
function bestOfN(cards){let best=null,score=null;const n=cards.length;
  for(let a=0;a<n-4;a++) for(let b=a+1;b<n-3;b++) for(let c=a+2;c<n-2;c++) for(let d=a+3;d<n-1;d++) for(let e=a+4;e<n;e++){
    const hand=[cards[a],cards[b],cards[c],cards[d],cards[e]]; const s=eval5(hand);
    if(!score||cmp5(s,score)>0){score=s;best=hand;}
  } return {hand:best,score};
}
const evalHoldem=(hole,board)=> bestOfN(hole.concat(board)).score;
function evalPLO(hole4,board){
  const choose2=a=>{const r=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)r.push([a[i],a[j]]);return r;};
  const choose3=a=>{const r=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)for(let k=j+1;k<a.length;k++)r.push([a[i],a[j],a[k]]);return r;};
  let best=null;
  for(const h of choose2(hole4)) for(const b of choose3(board)){ const s=eval5(h.concat(b)); if(!best||cmp5(s,best)>0) best=s; }
  return best;
}

// Monte Carlo equity (fast-ish)
function monteCarloEquity(players, board, deck, game, iters=1500){
  // players: [{id, hole2 or hole4}]
  // game: 'he' | 'plo'
  const active = players.map(p=>({id:p.id}));
  const wins = new Map(active.map(p=>[p.id,0]));
  const ties = new Map(active.map(p=>[p.id,0]));

  for(let t=0;t<iters;t++){
    // draw remainder of board
    const d = deck.slice();
    // shuffle a few cards for randomness
    for(let i=d.length-1;i>0;i--){const j=(Math.random()* (i+1))|0; [d[i],d[j]]=[d[j],d[i]];}

    const need = 5 - board.length;
    const fill = d.slice(0, need);
    const simBoard = board.concat(fill);

    let scores;
    if (game==='he') {
      scores = players.map(p=>({ id:p.id, score: evalHoldem(p.hole2, simBoard) }));
    } else {
      scores = players.map(p=>({ id:p.id, score: evalPLO(p.hole4, simBoard) }));
    }
    // sort desc
    scores.sort((a,b)=>cmp5(b.score, a.score));
    const best = scores[0].score;
    const top = scores.filter(s=>cmp5(s.score,best)===0).map(s=>s.id);
    if (top.length===1) wins.set(top[0], wins.get(top[0])+1);
    else top.forEach(id=>ties.set(id, ties.get(id)+1));
  }
  const res = {};
  active.forEach(p=>{
    const w=wins.get(p.id), t=ties.get(p.id);
    res[p.id] = { win: (w/iters)*100, tie: (t/iters)*100 };
  });
  return res;
}

// Approx outs: enumerate next card that turns you into (tied) leader
function computeOutsNext(players, board, deck, game){
  if (board.length>=5) return {}; // no outs after river
  const outsBy = {};
  for (const p of players) outsBy[p.id]=new Set();
  for (let i=0;i<deck.length;i++){
    const card = deck[i];
    const nb = board.concat(card);
    let scores;
    if (game==='he') scores = players.map(pl=>({ id:pl.id, score: evalHoldem(pl.hole2, nb) }));
    else scores = players.map(pl=>({ id:pl.id, score: evalPLO(pl.hole4, nb) }));
    scores.sort((a,b)=>cmp5(b.score,a.score));
    const best = scores[0].score;
    const leaders = scores.filter(s=>cmp5(s.score,best)===0).map(s=>s.id);
    leaders.forEach(id=>outsBy[id].add(card));
  }
  // convert to arrays
  const outArr = {};
  for (const [id,set] of Object.entries(outsBy)) outArr[id] = Array.from(set);
  return outArr;
}

// -------------------- Rooms & persistence --------------------
/**
 rooms: Map<code, {
   hostToken: string|null,
   players: Map<token, { name, balance, present, lastSeen, sitOut, userId? }>,
   socketIndex: Map<socketId, token>,
   stage, deck, board, ante, handNumber,
   holes: Map<token, { hole, pickHoldem, pickPLO, locked }>,
   chat: [...],
   equities: { he: Record<token, {win,tie}>, plo: Record<token, {win,tie}> },
   outs: { he: Record<token,string[]>, plo: Record<token,string[]> }
 }>
*/
const rooms = new Map();
function getRoom(code){
  if(!rooms.has(code)){
    rooms.set(code,{
      hostToken:null,
      players:new Map(),
      socketIndex:new Map(),
      stage:'lobby',
      deck:[],
      board:[],
      ante:0,
      handNumber:0,
      holes:new Map(),
      chat:[],
      equities:{ he:{}, plo:{} },
      outs:{ he:{}, plo:{} }
    });
  }
  return rooms.get(code);
}
function systemMsg(room, text){
  const m={from:'system',text,ts:Date.now(),system:true};
  room.chat.push(m); if(room.chat.length>500) room.chat.shift();
}
function publicState(room){
  const players=[];
  for(const [token,p] of room.players.entries()){
    players.push({
      id:token, name:p.name, isHost:room.hostToken===token,
      balance:p.balance||0, locked:room.holes.get(token)?.locked||false,
      present:!!p.present, sitOut:!!p.sitOut
    });
  }
  return {
    stage: room.stage,
    players,
    board: (room.stage==='revealed'||room.stage==='results') ? room.board : [],
    ante: room.ante,
    handNumber: room.handNumber,
    equities: room.equities,
    outs: room.outs
  };
}
function genToken(){ return Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); }
function cardsLeft(room){
  const used = new Set(room.board);
  for (const seat of room.holes.values()) {
    seat.hole.forEach(c=>used.add(c));
  }
  const d=[]; for(const r of RANKS) for(const s of SUITS){ const c=r+s; if(!used.has(c)) d.push(c); }
  return d;
}

// -------------------- Socket handlers --------------------
io.on('connection', socket => {
  // client can include bearer token (user login) in query? Simpler: they call /api/me separately.

  socket.on('joinRoom', async ({ roomCode, name, token, authToken }, cb)=>{
    const code=(roomCode||'').trim().toUpperCase();
    if(!/^[A-Z0-9]{3,8}$/.test(code)) return cb?.({ok:false,error:'Invalid room code'});
    const room=getRoom(code);

    // decode authToken if present (link userId to seat for stats)
    let userId=null, username=null;
    if (authToken) {
      try { const u=jwt.verify(authToken, JWT_SECRET); userId=u.uid; username=u.u; } catch {}
    }

    let useToken=(token && room.players.has(token))? token : null;
    if(!useToken){
      if(room.players.size>=MAX_PLAYERS) return cb?.({ok:false,error:'Room full'});
      let finalName=(name||username||'Player').trim()||'Player';
      const names=new Set([...room.players.values()].map(p=>p.name));
      let i=1,cand=finalName; while(names.has(cand)){cand=`${finalName} ${i++}`;}
      finalName=cand;
      useToken=genToken();
      room.players.set(useToken,{ name:finalName, balance:0, present:true, lastSeen:Date.now(), sitOut:false, userId });
      if(!room.hostToken) room.hostToken=useToken;
      systemMsg(room, `${finalName} joined the table.`);
    } else {
      const p=room.players.get(useToken);
      p.present=true; p.lastSeen=Date.now();
      if (userId) p.userId = userId; // link on reconnect if newly logged in
      systemMsg(room, `${p.name} reconnected.`);
    }

    room.socketIndex.set(socket.id, useToken);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = useToken;

    io.to(code).emit('roomUpdate', publicState(room));
    io.to(socket.id).emit('chatBacklog', room.chat.slice(-100));
    const you=room.players.get(useToken);
    cb?.({ok:true, name:you.name, token:useToken, isHost:room.hostToken===useToken});
  });

  socket.on('toggleSitOut', sitOut=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); const tok=socket.data.token; if(!tok) return;
    const p=room.players.get(tok); if(!p) return;
    p.sitOut=!!sitOut;
    systemMsg(room, `${p.name} is now ${p.sitOut?'sitting out':'active'}.`);
    io.to(code).emit('chatMessage',{from:'system',text:`${p.name} is now ${p.sitOut?'sitting out':'active'}.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('setAnte', ante=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    room.ante=Math.max(0, Number(ante)||0);
    systemMsg(room, `Ante set to ${room.ante}.`);
    io.to(code).emit('chatMessage',{from:'system',text:`Ante set to ${room.ante}.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('startHand', async ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);

    const participants=[...room.players.entries()].filter(([_,p])=>!p.sitOut).map(([t])=>t);
    if(participants.length<2) return;

    room.deck=newDeck(); room.board=[]; room.stage='selecting'; room.handNumber++;
    room.holes=new Map(); room.equities={he:{}, plo:{}}; room.outs={he:{},plo:{}};

    for(const tok of participants){
      const p=room.players.get(tok);
      const hole=[room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop()];
      room.holes.set(tok,{ hole, pickHoldem:[], pickPLO:[], locked:false });
      p.balance=(p.balance||0)-room.ante;
    }
    // deliver private cards
    for (const [sid, tok] of room.socketIndex.entries()){
      const seat=room.holes.get(tok);
      if(seat) io.to(sid).emit('yourCards',{cards:seat.hole});
    }
    systemMsg(room, `Hand #${room.handNumber} started. Ante ${room.ante}.`);
    io.to(code).emit('chatMessage',{from:'system',text:`Hand #${room.handNumber} started.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('makeSelections', ({holdemTwo, ploFour}, cb)=>{
    const code=socket.data.roomCode; if(!code) return cb?.({ok:false,error:'No room'});
    const room=getRoom(code); const tok=socket.data.token; const seat=room.holes.get(tok);
    if(!seat) return cb?.({ok:false,error:'Not in this hand'});
    const set=new Set(seat.hole);
    if((holdemTwo||[]).length!==2||(ploFour||[]).length!==4) return cb?.({ok:false,error:'Pick 2 HE + 4 PLO'});
    for(const c of [...holdemTwo,...ploFour]) if(!set.has(c)) return cb?.({ok:false,error:'Invalid card'});
    seat.pickHoldem=[...holdemTwo]; seat.pickPLO=[...ploFour]; seat.locked=true;
    io.to(code).emit('roomUpdate', publicState(room));
    checkAllLockedThenRunStreets(room, code);
    cb?.({ok:true});
  });

  socket.on('nextHand',()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); room.stage='lobby'; room.board=[]; room.deck=[]; room.holes=new Map();
    room.equities={he:{}, plo:{}}; room.outs={he:{},plo:{}};
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('terminateTable', async ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    if(room.hostToken !== socket.data.token) return;

    const final=[...room.players.entries()].map(([tok,p])=>({
      id:tok, name:p.name, balance:p.balance||0, userId:p.userId||null
    })).sort((a,b)=>b.balance-a.balance);

    io.to(code).emit('finalResults',{handNumber:room.handNumber, ante:room.ante, players:final});
    // no stat update here; stats updated per-hand already

    setTimeout(()=>{ io.to(code).emit('terminated'); rooms.delete(code); }, 200);
  });

  socket.on('chatMessage', text=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); const tok=socket.data.token; const p=room.players.get(tok); if(!p) return;
    const t=(''+(text||'')).trim(); if(!t) return;
    const msg={from:p.name,text:t.slice(0,500),ts:Date.now()};
    room.chat.push(msg); if(room.chat.length>500) room.chat.shift();
    io.to(code).emit('chatMessage', msg);
  });

  socket.on('disconnect', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); const tok=socket.data.token;
    if(!room||!tok||!room.players.has(tok)) return;
    const p=room.players.get(tok); p.present=false; p.lastSeen=Date.now();
    room.socketIndex.delete(socket.id);

    if(room.stage==='selecting'){
      const seat=room.holes.get(tok);
      if(seat && !seat.locked){
        seat.pickHoldem=seat.hole.slice(0,2);
        seat.pickPLO=seat.hole.slice(0,4);
        seat.locked=true;
      }
      checkAllLockedThenRunStreets(room, code);
    }
    systemMsg(room, `${p.name} left the table.`);
    io.to(code).emit('chatMessage',{from:'system',text:`${p.name} left the table.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });
});

// Phased streets with equities and outs
function checkAllLockedThenRunStreets(room, code){
  if (room.holes.size===0) return;
  const allLocked=[...room.holes.values()].every(s=>s.locked);
  if (!allLocked) return;

  // Who’s in hand (by token) & map their HE and PLO holes
  const participants = [...room.holes.entries()].map(([tok,seat])=>({
    id: tok,
    hole2: seat.pickHoldem,
    hole4: seat.pickPLO
  }));

  // Helper to recompute equities/outs & broadcast
  const recomputeAndEmit = (stageLabel) => {
    const d = cardsLeft(room);
    const heEq = monteCarloEquity(participants.map(p=>({id:p.id, hole2:p.hole2})), room.board, d, 'he', 1500);
    const ploEq = monteCarloEquity(participants.map(p=>({id:p.id, hole4:p.hole4})), room.board, d, 'plo', 1200);
    room.equities = { he: heEq, plo: ploEq };

    // Outs only when a next card remains (after flop & turn)
    if (room.board.length<5 && room.board.length>=3){
      const heOuts = computeOutsNext(participants.map(p=>({id:p.id, hole2:p.hole2})), room.board, d, 'he');
      const ploOuts = computeOutsNext(participants.map(p=>({id:p.id, hole4:p.hole4})), room.board, d, 'plo');
      room.outs = { he: heOuts, plo: ploOuts };
    } else {
      room.outs = { he:{}, plo:{} };
    }

    io.to(code).emit('roomUpdate', publicState(room));
    io.to(code).emit('streetUpdate', { stage: stageLabel, board: room.board, equities: room.equities, outs: room.outs });
  };

  // Deal flop → wait 3s → turn → wait 3s → river → score
  room.stage = 'revealed';

  // Flop
  if (room.board.length === 0) {
    room.board.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    recomputeAndEmit('flop');
  }
  setTimeout(()=> {
    // Turn
    if (room.board.length === 3) {
      room.board.push(room.deck.pop());
      recomputeAndEmit('turn');
    }
    setTimeout(()=> {
      // River
      if (room.board.length === 4) {
        room.board.push(room.deck.pop());
        recomputeAndEmit('river');
      }
      // Score after small delay
      setTimeout(()=> scoreAndSetResults(room, code), 200);
    }, 3000);
  }, 3000);
}

async function scoreAndSetResults(room, code){
  const scoresH=[], scoresP=[];
  for(const [tok, seat] of room.holes.entries()){
    scoresH.push({ tok, score: evalHoldem(seat.pickHoldem, room.board) });
    scoresP.push({ tok, score: evalPLO(seat.pickPLO, room.board) });
  }
  scoresH.sort((a,b)=>cmp5(b.score,a.score));
  scoresP.sort((a,b)=>cmp5(b.score,a.score));

  const topH = scoresH.filter(x=>cmp5(x.score,scoresH[0].score)===0).map(x=>x.tok);
  const topP = scoresP.filter(x=>cmp5(x.score,scoresP[0].score)===0).map(x=>x.tok);

  const pot = room.ante * room.holes.size;
  const heShare = (pot/2) / Math.max(1, topH.length);
  const ploShare = (pot/2) / Math.max(1, topP.length);

  for(const t of topH){ const p=room.players.get(t); p.balance=(p.balance||0)+heShare; }
  for(const t of topP){ const p=room.players.get(t); p.balance=(p.balance||0)+ploShare; }

  const scoops = (topH.length===1 && topP.length===1 && topH[0]===topP[0]) ? [topH[0]] : [];

  const picks={}; for(const [tok, seat] of room.holes.entries()){
    picks[tok] = { name: room.players.get(tok).name, holdem: seat.pickHoldem, plo: seat.pickPLO, hole: seat.hole };
  }

  // ---- Lifetime stats updates ----
  try {
    // Hands played for all *active seats in this hand*
    const activeUserIds = [...room.holes.keys()]
      .map(tok => room.players.get(tok)?.userId)
      .filter(Boolean);
    await addHandsPlayed(activeUserIds);

    // Net chips (heShare/ploShare already applied to balances; convert to deltas):
    // Each active player paid ante. Winners got shares.
    const ante = room.ante;
    for (const tok of room.holes.keys()){
      const p = room.players.get(tok);
      if (!p.userId) continue;
      // Compute delta: they paid ante at start, now net pot arrival
      // Simpler: recompute delta from last step: for each player, +heShare if in topH, +ploShare if in topP, -ante
      let delta = -ante;
      if (topH.includes(tok)) delta += heShare;
      if (topP.includes(tok)) delta += ploShare;
      await addNet(p.userId, delta);
    }
    // Wins
    const heUserIds = topH.map(tok => room.players.get(tok)?.userId).filter(Boolean);
    const ploUserIds = topP.map(tok => room.players.get(tok)?.userId).filter(Boolean);
    await addHeWins(heUserIds);
    await addPloWins(ploUserIds);
    if (scoops.length === 1) {
      const uid = room.players.get(scoops[0])?.userId;
      if (uid) await addScoops(uid);
    }
  } catch (e) { console.warn('stat update error', e); }

  io.to(code).emit('results', {
    board: room.board,
    winners: { holdem: topH, plo: topP },
    scoops,
    picks,
    handNumber: room.handNumber
  });

  room.stage='results';
  // Equities/outs no longer relevant after river
  room.equities={he:{}, plo:{}}; room.outs={he:{}, plo:{}};
  io.to(code).emit('roomUpdate', publicState(room));
}

// --- Start server ---
server.listen(PORT, () => console.log(`Peanuts server on :${PORT}`));

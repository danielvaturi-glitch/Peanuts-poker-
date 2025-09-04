// Peanuts Poker — fixes: ante lock, terminate room, crisp card images (client)

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

server.listen(PORT, () => console.log(`Peanuts running on ${PORT}`));

/* ---------------------------- Game state ---------------------------- */
const MAX_PLAYERS = 6;
const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;

const SUITS = ['c','d','h','s'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_ORDER = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };

const rooms = new Map();

function getRoom(code){
  const now = Date.now();
  if (rooms.has(code)) {
    const r = rooms.get(code);
    if (r.stage === 'terminated' && r.summarySavedAt && (now - r.summarySavedAt > SUMMARY_TTL_MS)) {
      rooms.delete(code);
    } else {
      return r;
    }
  }
  const room = {
    stage: 'lobby',
    players: new Map(),           // token -> {name, balance}
    socketIndex: new Map(),       // socket.id -> token
    ante: 100,
    anteLocked: false,            // <— fix starts here (explicit flag)
    scoopBonus: 0,
    scoopLocked: false,
    handNumber: 0,
    deck: [],
    board: [],
    holes: new Map(),             // token -> {hole(6), pickHoldem(2), pickPLO(4), locked}
    // termination
    summary: null,
    summarySavedAt: null
  };
  rooms.set(code, room);
  return room;
}

function newDeck(){
  const d=[]; for(const r of RANKS) for(const s of SUITS) d.push(r+s);
  for(let i=d.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}

/* ------------------------- Evaluation helpers ---------------------- */
const cv = c => RANK_ORDER[c[0]];
const cs = c => c[1];
function rankCounts(cards){
  const m={}; for(const c of cards) m[cv(c)]=(m[cv(c)]||0)+1;
  return Object.entries(m).map(([v,c])=>({v:+v,c})).sort((a,b)=>(b.c-a.c)||(b.v-a.v));
}
function isFlush(cards){ const s=cs(cards[0]); return cards.every(c=>cs(c)===s); }
function isStraight(cards){
  const vals=[...new Set(cards.map(cv))].sort((a,b)=>a-b);
  if(vals.length<5) return {ok:false};
  for(let i=0;i<=vals.length-5;i++){ const run=vals.slice(i,i+5); if(run[4]-run[0]===4) return {ok:true,high:run[4]}; }
  if(vals.includes(14)&&[2,3,4,5].every(x=>vals.includes(x))) return {ok:true,high:5};
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
const evalHoldem=(h,b)=>bestOfN(h.concat(b)).score;
function evalPLO(h4,b){
  const choose2=a=>{const r=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)r.push([a[i],a[j]]);return r;};
  const choose3=a=>{const r=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)for(let k=j+1;k<a.length;k++)r.push([a[i],a[j],a[k]]);return r;};
  let best=null;
  for(const h of choose2(h4)) for(const x of choose3(b)){ const s=eval5(h.concat(x)); if(!best||cmp5(s,best)>0) best=s; }
  return best;
}

/* ---------------------------- Broadcasting ------------------------- */
function publicState(room){
  const players=[];
  for(const [tok,p] of room.players.entries()){
    const locked = !!room.holes.get(tok)?.locked;
    players.push({ id:tok, name:p.name, balance:+(p.balance||0), locked });
  }
  return {
    stage:room.stage,
    players,
    board:(room.stage==='revealed'||room.stage==='results')? room.board : [],
    ante:room.ante, anteLocked:room.anteLocked,
    scoopBonus:room.scoopBonus, scoopLocked:room.scoopLocked,
    handNumber:room.handNumber
  };
}

/* ----------------------------- Sockets ---------------------------- */
io.on('connection', (socket)=>{
  socket.on('joinRoom', ({roomCode,name,token}, cb)=>{
    const code=(roomCode||'').toUpperCase().trim();
    if(!/^[A-Z0-9]{3,8}$/.test(code)) return cb?.({ok:false,error:'Invalid room code'});
    const room=getRoom(code);

    // If terminated, just join & show summary
    if(room.stage==='terminated'){
      socket.join(code);
      socket.data.roomCode=code;
      return cb?.({ok:true, name:name||'Guest', token:null});
    }

    let useToken = (token && room.players.has(token)) ? token : null;
    if(!useToken){
      if(room.players.size>=MAX_PLAYERS) return cb?.({ok:false,error:'Room full'});
      // assign new
      useToken = Math.random().toString(36).slice(2);
      let finalName = (name||'Player').trim() || 'Player';
      const taken = new Set([...room.players.values()].map(p=>p.name));
      let i=1, cand=finalName; while(taken.has(cand)){ cand = `${finalName} ${i++}`; }
      room.players.set(useToken, { name:cand, balance:0 });
    }

    room.socketIndex.set(socket.id, useToken);
    socket.join(code);
    socket.data.roomCode=code;
    socket.data.token=useToken;

    io.to(code).emit('roomUpdate', publicState(room));
    cb?.({ok:true, name:room.players.get(useToken).name, token:useToken});
  });

  socket.on('setAnte', (v)=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    room.ante = Math.max(0, Number(v)||0);
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('lockAnte', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    room.anteLocked = true;            // <— FIX: lock flag
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('setScoopBonus', (v)=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    room.scoopBonus = Math.max(0, Number(v)||0);
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('lockScoop', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    room.scoopLocked = true;
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('startHand', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    if(room.stage!=='lobby' && room.stage!=='results') return;

    // auto-lock ante if user forgot
    if(!room.anteLocked){ room.anteLocked=true; }

    const participants = [...room.players.keys()];
    if(participants.length<2) return; // need at least 2

    room.handNumber++;
    room.stage='selecting';
    room.deck=newDeck(); room.board=[];
    room.holes=new Map();

    // ante & deal
    for(const tok of participants){
      const p=room.players.get(tok);
      p.balance -= room.ante;
      const hole=[room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop()];
      room.holes.set(tok, { hole, pickHoldem:[], pickPLO:[], locked:false });
    }

    // send personal cards
    for(const [sid,tok] of room.socketIndex.entries()){
      const seat=room.holes.get(tok); if(seat) io.to(sid).emit('yourCards', {cards:seat.hole});
    }

    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('makeSelections', ({holdemTwo, ploFour}, cb)=>{
    const code=socket.data.roomCode; if(!code) return cb?.({ok:false});
    const room=getRoom(code); const tok=socket.data.token; const seat=room.holes.get(tok);
    if(!seat) return cb?.({ok:false,error:'No hand'});
    const set = new Set(seat.hole);
    if((holdemTwo||[]).length!==2 || (ploFour||[]).length!==4) return cb?.({ok:false,error:'Pick 2 & 4'});
    for(const c of [...holdemTwo,...ploFour]) if(!set.has(c)) return cb?.({ok:false,error:'Invalid card'});
    seat.pickHoldem=[...holdemTwo]; seat.pickPLO=[...ploFour]; seat.locked=true;

    const allLocked = [...room.holes.values()].every(s=>s.locked);
    io.to(code).emit('roomUpdate', publicState(room));
    if(allLocked){
      room.stage='revealed';
      io.to(code).emit('roomUpdate', publicState(room));
    }
    cb?.({ok:true});
  });

  socket.on('revealNextStreet', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    if(room.stage!=='revealed') return;
    if(room.board.length>=5) return;
    if(room.board.length===0){ room.board.push(room.deck.pop(),room.deck.pop(),room.deck.pop()); }
    else if(room.board.length===3){ room.board.push(room.deck.pop()); }
    else if(room.board.length===4){ room.board.push(room.deck.pop()); scoreAndFinish(room, code); }
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('changeSettings', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    if(room.stage!=='results') return;
    room.stage='lobby';
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('terminateRoom', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    // Build a simple summary and mark terminated
    room.summary = {
      room: code,
      hands: room.handNumber,
      players: [...room.players.values()].map(p=>({name:p.name, finalBalance:+(p.balance||0)})),
    };
    room.summarySavedAt = Date.now();
    room.stage='terminated';          // <— FIX: stage updated
    io.to(code).emit('sessionSummary', { summary: room.summary, savedAt: room.summarySavedAt });
  });

  socket.on('requestYourCards', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); const tok=socket.data.token; if(!tok) return;
    const seat=room.holes.get(tok); if(seat) io.to(socket.id).emit('yourCards',{cards:seat.hole});
  });

  socket.on('disconnect', ()=>{
    const code=socket.data.roomCode;
    if(!code) return;
    const room=rooms.get(code); if(!room) return;
    room.socketIndex.delete(socket.id);
  });
});

/* -------------------------- Scoring (simple) ----------------------- */
function scoreAndFinish(room, code){
  // Hold’em winners
  const he = [...room.holes.entries()].map(([tok,s])=>({tok,score:evalHoldem(s.pickHoldem, room.board)}))
               .sort((a,b)=>cmp5(b.score,a.score));
  const topHe = he.length ? he.filter(x=>cmp5(x.score,he[0].score)===0).map(x=>x.tok) : [];

  // PLO winners
  const plo = [...room.holes.entries()].map(([tok,s])=>({tok,score:evalPLO(s.pickPLO, room.board)}))
                .sort((a,b)=>cmp5(b.score,a.score));
  const topPlo = plo.length ? plo.filter(x=>cmp5(x.score,plo[0].score)===0).map(x=>x.tok) : [];

  const pot = room.ante * room.holes.size;
  const heShare = (pot/2)/Math.max(1, topHe.length);
  const ploShare = (pot/2)/Math.max(1, topPlo.length);
  for(const t of topHe){ const p=room.players.get(t); p.balance+=heShare; }
  for(const t of topPlo){ const p=room.players.get(t); p.balance+=ploShare; }

  room.stage='results';
  io.to(code).emit('roomUpdate', publicState(room));
}

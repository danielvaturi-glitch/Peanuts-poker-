// server.js — Peanuts Poker (manual street reveal)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use((_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Peanuts server listening on ${PORT}`));

// -------------------- Card helpers --------------------
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
const evalHoldem=(hole,board)=> bestOfN(hole.concat(board)).score;
function evalPLO(hole4,board){
  const choose2=a=>{const r=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)r.push([a[i],a[j]]);return r;};
  const choose3=a=>{const r=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)for(let k=j+1;k<a.length;k++)r.push([a[i],a[j],a[k]]);return r;};
  let best=null;
  for(const h of choose2(hole4)) for(const b of choose3(board)){ const s=eval5(h.concat(b)); if(!best||cmp5(s,best)>0) best=s; }
  return best;
}

// Monte Carlo equities
function monteCarloEquity(players, board, deck, game, iters=800){
  const wins=new Map(players.map(p=>[p.id,0]));
  const ties=new Map(players.map(p=>[p.id,0]));
  for(let t=0;t<iters;t++){
    const d=deck.slice();
    for(let i=d.length-1;i>0;i--){const j=(Math.random()*(i+1))|0; [d[i],d[j]]=[d[j],d[i]];}
    const need=5-board.length, fill=d.slice(0,need), simB=board.concat(fill);
    const scores = game==='he'
      ? players.map(p=>({id:p.id, score:evalHoldem(p.hole2, simB)}))
      : players.map(p=>({id:p.id, score:evalPLO(p.hole4, simB)}));
    scores.sort((a,b)=>cmp5(b.score,a.score));
    const best=scores[0].score;
    const top=scores.filter(s=>cmp5(s.score,best)===0).map(s=>s.id);
    if(top.length===1) wins.set(top[0], wins.get(top[0])+1);
    else top.forEach(id=>ties.set(id, (ties.get(id)||0)+1));
  }
  const res={}; players.forEach(p=>{
    res[p.id]={ win:(wins.get(p.id)/iters)*100, tie:(ties.get(p.id)/iters)*100 };
  });
  return res;
}

// -------------------- Rooms --------------------
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
      equities:{he:{}, plo:{}}
    });
  }
  return rooms.get(code);
}
function genToken(){ return Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); }
function cardsLeft(room){
  const used=new Set(room.board);
  for(const seat of room.holes.values()) seat.hole.forEach(c=>used.add(c));
  const d=[]; for(const r of RANKS) for(const s of SUITS){ const c=r+s; if(!used.has(c)) d.push(c); }
  return d;
}
function publicState(room){
  const players=[];
  for(const [tok,p] of room.players.entries()){
    players.push({
      id:tok, name:p.name, isHost:room.hostToken===tok,
      balance:p.balance||0, locked:room.holes.get(tok)?.locked||false,
      present:!!p.present, sitOut:!!p.sitOut
    });
  }
  return { stage:room.stage, players, board:room.board, ante:room.ante, handNumber:room.handNumber, equities:room.equities };
}
function buildPicks(room){
  const p={};
  for(const [tok,seat] of room.holes.entries()){
    p[tok]={ name:room.players.get(tok).name, holdem:seat.pickHoldem, plo:seat.pickPLO };
  }
  return p;
}
function recomputeAndEmit(room, code, stageLabel){
  const participants=[...room.holes.entries()].map(([tok,seat])=>({ id:tok, hole2:seat.pickHoldem, hole4:seat.pickPLO }));
  const d = cardsLeft(room);
  const heEq = monteCarloEquity(participants.map(p=>({id:p.id,hole2:p.hole2})), room.board, d, 'he');
  const ploEq = monteCarloEquity(participants.map(p=>({id:p.id,hole4:p.hole4})), room.board, d, 'plo');
  room.equities={he:heEq, plo:ploEq};
  io.to(code).emit('roomUpdate', publicState(room));
  io.to(code).emit('streetUpdate', { stage:stageLabel, board:room.board, equities:room.equities, picks: buildPicks(room) });
}

// -------------------- Socket handlers --------------------
io.on('connection', socket => {
  socket.on('joinRoom', ({roomCode,name,token}, cb)=>{
    const code=(roomCode||'').trim().toUpperCase();
    const room=getRoom(code);
    let useToken=(token && room.players.has(token))? token : null;
    if(!useToken){
      if(room.players.size>=MAX_PLAYERS) return cb?.({ok:false,error:'Room full'});
      let finalName=(name||'Player').trim()||'Player';
      useToken=genToken();
      room.players.set(useToken,{ name:finalName, balance:0, present:true, sitOut:false });
      if(!room.hostToken) room.hostToken=useToken;
    }
    room.socketIndex.set(socket.id,useToken);
    socket.join(code);
    socket.data.roomCode=code;
    socket.data.token=useToken;
    cb?.({ok:true, name:room.players.get(useToken).name, token:useToken});
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('startHand', ()=>{
    const code=socket.data.roomCode; const room=getRoom(code);
    room.deck=newDeck(); room.board=[]; room.stage='selecting'; room.handNumber++;
    room.holes=new Map();
    for(const [tok,p] of room.players.entries()){
      if(p.sitOut) continue;
      const hole=[room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop()];
      room.holes.set(tok,{ hole, pickHoldem:[], pickPLO:[], locked:false });
      p.balance=(p.balance||0)-room.ante;
      io.to(socket.id).emit('yourCards',{cards:hole});
    }
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('makeSelections', ({holdemTwo,ploFour}, cb)=>{
    const code=socket.data.roomCode; const room=getRoom(code);
    const tok=socket.data.token; const seat=room.holes.get(tok);
    if(!seat) return;
    seat.pickHoldem=holdemTwo; seat.pickPLO=ploFour; seat.locked=true;
    if([...room.holes.values()].every(s=>s.locked)){
      room.stage='revealed';
      recomputeAndEmit(room, code, 'preflop');
    }
    io.to(code).emit('roomUpdate', publicState(room));
    cb?.({ok:true});
  });

  // *** Manual reveal ***
  socket.on('revealNextStreet', ()=>{
    const code=socket.data.roomCode; const room=getRoom(code);
    if(room.stage!=='revealed') return;
    if(room.board.length===0){
      room.board.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
      recomputeAndEmit(room, code, 'flop');
    } else if(room.board.length===3){
      room.board.push(room.deck.pop());
      recomputeAndEmit(room, code, 'turn');
    } else if(room.board.length===4){
      room.board.push(room.deck.pop());
      recomputeAndEmit(room, code, 'river');
      scoreAndFinish(room, code);
    }
  });

  socket.on('nextHand', ()=>{
    const code=socket.data.roomCode; const room=getRoom(code);
    room.stage='lobby'; room.board=[]; room.holes=new Map();
    room.equities={he:{},plo:{}}; io.to(code).emit('roomUpdate', publicState(room));
  });
});

// -------------------- Finish --------------------
function scoreAndFinish(room, code){
  const scoresH=[], scoresP=[];
  for(const [tok,seat] of room.holes.entries()){
    scoresH.push({tok, score:evalHoldem(seat.pickHoldem, room.board)});
    scoresP.push({tok, score:evalPLO(seat.pickPLO, room.board)});
  }
  scoresH.sort((a,b)=>cmp5(b.score,a.score));
  scoresP.sort((a,b)=>cmp5(b.score,a.score));
  const topH=scoresH.filter(x=>cmp5(x.score,scoresH[0].score)===0).map(x=>x.tok);
  const topP=scoresP.filter(x=>cmp5(x.score,scoresP[0].score)===0).map(x=>x.tok);
  const pot=room.ante*room.holes.size;
  const heShare=(pot/2)/Math.max(1, topH.length);
  const ploShare=(pot/2)/Math.max(1, topP.length);
  for(const t of topH){room.players.get(t).balance+=heShare;}
  for(const t of topP){room.players.get(t).balance+=ploShare;}
  io.to(code).emit('results',{ board:room.board, winners:{holdem:topH,plo:topP}, picks:buildPicks(room) });
  room.stage='results'; io.to(code).emit('roomUpdate', publicState(room));
}

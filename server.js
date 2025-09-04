// Peanuts Poker — full server (Play Hand auto-locks ante fix)

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

const MAX_PLAYERS = 6;
const ABSENCE_TIMEOUT_MS = 10 * 60 * 1000;

// ---------- Cards & Hand Evaluation ----------
const SUITS = ['c','d','h','s'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_ORDER = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
const cv = c => RANK_ORDER[c[0]];
const cs = c => c[1];

function newDeck(){
  const d=[]; for(const r of RANKS) for(const s of SUITS) d.push(r+s);
  for(let i=d.length-1;i>0;i--){const j=(Math.random()*(i+1))|0; [d[i],d[j]]=[d[j],d[i]];}
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
function monteCarloEquity(players, board, deck, game, iters=600){
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
function itersFor(boardLen){ if(boardLen<=0) return 600; if(boardLen===3) return 400; if(boardLen===4) return 300; return 0; }

// ---------- Rooms ----------
const rooms = new Map();

function getRoom(code){
  if(!rooms.has(code)){
    rooms.set(code, {
      players:new Map(),
      socketIndex:new Map(),
      stage:'lobby',
      deck:[], board:[],
      ante:100, anteLocked:false,
      scoopBonus:0, scoopLocked:false,
      timerLocked:true, selectionSeconds:45,
      handNumber:0,
      selectionDeadline:null, selectionTimer:null,
      holes:new Map(),
      chat:[],
      equities:{ he:{}, plo:{} }
    });
  }
  return rooms.get(code);
}

function genToken(){ return Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); }
function systemMsg(room, text){
  const m={from:'system',text,ts:Date.now(),system:true};
  room.chat.push(m); if(room.chat.length>500) room.chat.shift();
}
function publicState(room){
  const players=[];
  for(const [tok,p] of room.players.entries()){
    players.push({
      id:tok, name:p.name, balance:+(p.balance||0),
      locked:!!room.holes.get(tok)?.locked,
      present:!!p.present, sitOut:!!p.sitOut
    });
  }
  const remaining = room.stage==='selecting' && room.selectionDeadline
    ? Math.max(0, room.selectionDeadline - Date.now())
    : 0;
  return {
    stage:room.stage,
    players,
    board:(room.stage==='revealed'||room.stage==='results')? room.board : [],
    ante:room.ante,
    anteLocked:room.anteLocked,
    scoopBonus:room.scoopBonus,
    scoopLocked:room.scoopLocked,
    selectionSeconds:room.selectionSeconds,
    timerLocked:room.timerLocked,
    handNumber:room.handNumber,
    selectionRemainingMs: remaining
  };
}
function cardsLeft(room){
  const used=new Set(room.board);
  for(const seat of room.holes.values()) seat.hole.forEach(c=>used.add(c));
  const d=[]; for(const r of RANKS) for(const s of SUITS){ const c=r+s; if(!used.has(c)) d.push(c); }
  return d;
}
function buildPicks(room){
  const p={};
  for(const [tok,seat] of room.holes.entries()){
    p[tok]={ name:room.players.get(tok).name, holdem:seat.pickHoldem, plo:seat.pickPLO };
  }
  return p;
}
function clearSelectionTimer(room){
  if(room.selectionTimer){ clearInterval(room.selectionTimer); room.selectionTimer=null; }
  room.selectionDeadline=null;
}
function startSelectionTimer(room, code){
  clearSelectionTimer(room);
  room.selectionDeadline = Date.now() + (room.selectionSeconds*1000);
  room.selectionTimer = setInterval(()=>{
    io.to(code).emit('roomUpdate', publicState(room));
    if(Date.now() >= room.selectionDeadline){
      for(const [tok, seat] of room.holes.entries()){
        if(!seat.locked){
          const arr=seat.hole.slice();
          for(let i=arr.length-1;i>0;i--){const j=(Math.random()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]];}
          seat.pickHoldem = arr.slice(0,2);
          seat.pickPLO   = arr.slice(0,4);
          seat.locked = true;
          systemMsg(room, `${room.players.get(tok).name} auto-locked selections.`);
        }
      }
      clearSelectionTimer(room);
      const allLocked=[...room.holes.values()].every(s=>s.locked);
      if(allLocked){
        room.stage='revealed';
        io.to(code).emit('roomUpdate', publicState(room));
        recomputeAndEmit(room, code, 'preflop');
      }
    }
  }, 400);
}
function recomputeAndEmit(room, code, label){
  const boardLen = room.board.length;
  const it = itersFor(boardLen);
  const participants = [...room.holes.entries()].map(([id,seat])=>({ id, hole2:seat.pickHoldem, hole4:seat.pickPLO }));
  if(boardLen<5){
    const d=cardsLeft(room);
    const he = it>0 ? monteCarloEquity(participants.map(p=>({id:p.id,hole2:p.hole2})), room.board, d, 'he', it) : {};
    const plo= it>0 ? monteCarloEquity(participants.map(p=>({id:p.id,hole4:p.hole4})), room.board, d, 'plo', it) : {};
    room.equities={ he, plo };
  } else {
    room.equities={ he:{}, plo:{} };
  }
  io.to(code).emit('roomUpdate', publicState(room));
  io.to(code).emit('streetUpdate', { stage:label, board:room.board, equities:room.equities, picks:buildPicks(room) });
}

// ---------- Absence monitor ----------
setInterval(()=>{
  for(const [code,room] of rooms.entries()){
    for(const [tok,p] of room.players.entries()){
      if(!p.present && p.absentSince && Date.now()-p.absentSince > ABSENCE_TIMEOUT_MS){
        if(!p.sitOut){
          p.sitOut=true;
          systemMsg(room, `${p.name} is now sitting out (timed out).`);
          io.to(code).emit('chatMessage',{from:'system',text:`${p.name} timed out and is now sitting out.`,ts:Date.now(),system:true});
          io.to(code).emit('roomUpdate', publicState(room));
        }
      }
    }
  }
}, 30000);

// ---------- Socket.io ----------
io.on('connection', socket=>{
  socket.on('joinRoom', ({roomCode,name,token}, cb)=>{
    const code=(roomCode||'').toUpperCase().trim();
    if(!/^[A-Z0-9]{3,8}$/.test(code)) return cb?.({ok:false,error:'Invalid room code'});
    const room=getRoom(code);

    let useToken = (token && room.players.has(token)) ? token : null;
    if(!useToken){
      if(room.players.size>=MAX_PLAYERS) return cb?.({ok:false,error:'Room full'});
      let finalName=(name||'Player').trim()||'Player';
      const ex=new Set([...room.players.values()].map(p=>p.name));
      let i=1, cand=finalName; while(ex.has(cand)){ cand=`${finalName} ${i++}`; }
      useToken=genToken();
      room.players.set(useToken,{ name:cand, balance:0, present:true, absentSince:null, sitOut:false,
        stats:{handsPlayed:0,winsHE:0,winsPLO:0,scoops:0} });
      systemMsg(room, `${cand} joined the table.`);
    } else {
      const p=room.players.get(useToken);
      p.present=true; p.absentSince=null;
      systemMsg(room, `${p.name} reconnected.`);
    }

    room.socketIndex.set(socket.id, useToken);
    socket.join(code);
    socket.data.roomCode=code;
    socket.data.token=useToken;

    const seat=room.holes.get(useToken);
    if(room.stage==='selecting' && seat){
      io.to(socket.id).emit('yourCards', { cards: seat.hole });
    }

    io.to(code).emit('roomUpdate', publicState(room));
    io.to(socket.id).emit('chatBacklog', room.chat.slice(-200));
    const you=room.players.get(useToken);
    cb?.({ok:true, name:you.name, token:useToken});
  });

  socket.on('requestYourCards', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); const tok=socket.data.token; if(!tok) return;
    const seat=room.holes.get(tok);
    if(seat && room.stage==='selecting'){
      io.to(socket.id).emit('yourCards', { cards: seat.hole });
    }
  });

  // Lobby settings
  socket.on('setAnte',(v)=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    room.ante=Math.max(0, Number(v)||0);
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('lockAnte',()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); room.anteLocked=true;
    systemMsg(room, `Ante locked at ${room.ante}.`);
    io.to(code).emit('chatMessage',{from:'system',text:`Ante locked at ${room.ante}.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('setScoopBonus',(v)=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); room.scoopBonus=Math.max(0, Number(v)||0);
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('lockScoop',()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); room.scoopLocked=true;
    systemMsg(room, `Scoop bonus locked at ${room.scoopBonus}.`);
    io.to(code).emit('chatMessage',{from:'system',text:`Scoop bonus locked at ${room.scoopBonus}.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('unlockTimer',()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); room.timerLocked=false;
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('setSelectionSeconds',(s)=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    if(room.timerLocked) return;
    const val=Math.max(5, Math.min(180, Number(s)||45));
    room.selectionSeconds=val;
    io.to(code).emit('roomUpdate', publicState(room));
  });
  socket.on('lockTimer',()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); room.timerLocked=true;
    systemMsg(room, `Timer locked at ${room.selectionSeconds}s.`);
    io.to(code).emit('chatMessage',{from:'system',text:`Timer locked at ${room.selectionSeconds}s.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('toggleSitOut', sitOut=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); const tok=socket.data.token; const p=room.players.get(tok); if(!p) return;
    if(room.stage!=='lobby') return;
    p.sitOut=!!sitOut;
    systemMsg(room, `${p.name} is now ${p.sitOut?'sitting out':'active'}.`);
    io.to(code).emit('chatMessage',{from:'system',text:`${p.name} is now ${p.sitOut?'sitting out':'active'}.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });

  socket.on('kickPlayer', (tokenToKick)=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code); const p=room.players.get(tokenToKick); if(!p) return;
    if(p.present) return;
    if(!p.absentSince || Date.now()-p.absentSince < ABSENCE_TIMEOUT_MS) return;
    room.players.delete(tokenToKick);
    systemMsg(room, `Seat freed (kicked timed-out player).`);
    io.to(code).emit('chatMessage',{from:'system',text:`A timed-out seat was removed.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });

  // --- FIXED: Start hand will auto-lock the ante if not locked, then deal ---
  socket.on('startHand', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);

    if(room.stage!=='lobby' && room.stage!=='results') return;

    // Auto-lock ante if not already locked
    if(!room.anteLocked){
      room.anteLocked = true;
      systemMsg(room, `Ante auto-locked at ${room.ante}.`);
      io.to(code).emit('chatMessage',{from:'system',text:`Ante auto-locked at ${room.ante}.`,ts:Date.now(),system:true});
    }

    const participants=[...room.players.entries()].filter(([_,p])=>!p.sitOut).map(([t])=>t);
    if(participants.length<2) return;

    room.deck=newDeck(); room.board=[]; room.stage='selecting'; room.handNumber++;
    room.holes=new Map(); room.equities={he:{},plo:{}};
    clearSelectionTimer(room);

    // Charge ante & deal 6 cards each
    for(const tok of participants){
      const p=room.players.get(tok);
      const hole=[room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop(),room.deck.pop()];
      room.holes.set(tok,{hole,pickHoldem:[],pickPLO:[],locked:false});
      p.balance=(p.balance||0)-room.ante;
    }

    // deliver hole cards to connected sockets
    for(const [sid,tok] of room.socketIndex.entries()){
      const seat=room.holes.get(tok); if(seat) io.to(sid).emit('yourCards',{cards:seat.hole});
    }

    systemMsg(room, `Hand #${room.handNumber} started. Ante ${room.ante}.`);
    io.to(code).emit('chatMessage',{from:'system',text:`Hand #${room.handNumber} started.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
    startSelectionTimer(room, code);
  });

  socket.on('makeSelections', ({holdemTwo,ploFour}, cb)=>{
    const code=socket.data.roomCode; if(!code) return cb?.({ok:false});
    const room=getRoom(code); const tok=socket.data.token; const seat=room.holes.get(tok);
    if(!seat) return cb?.({ok:false,error:'Not in hand'});
    const set=new Set(seat.hole);
    if((holdemTwo||[]).length!==2 || (ploFour||[]).length!==4) return cb?.({ok:false,error:'Pick 2 HE & 4 PLO'});
    for(const c of [...holdemTwo,...ploFour]) if(!set.has(c)) return cb?.({ok:false,error:'Invalid card'});
    seat.pickHoldem=[...holdemTwo]; seat.pickPLO=[...ploFour]; seat.locked=true;

    io.to(code).emit('roomUpdate', publicState(room));
    const allLocked=[...room.holes.values()].every(s=>s.locked);
    if(allLocked){
      clearSelectionTimer(room);
      room.stage='revealed';
      io.to(code).emit('roomUpdate', publicState(room));
      recomputeAndEmit(room, code, 'preflop');
    }
    cb?.({ok:true});
  });

  socket.on('revealNextStreet', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    if(room.stage!=='revealed') return;
    const allLocked=[...room.holes.values()].every(s=>s.locked); if(!allLocked) return;
    if(room.board.length>=5) return;

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

  socket.on('changeSettings', ()=>{
    const code=socket.data.roomCode; if(!code) return;
    const room=getRoom(code);
    if(room.stage!=='results') return;
    room.stage='lobby';
    io.to(code).emit('roomUpdate', publicState(room));
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
    const p=room.players.get(tok);
    p.present=false; p.absentSince=Date.now();
    room.socketIndex.delete(socket.id);
    systemMsg(room, `${p.name} left (disconnected).`);
    io.to(code).emit('chatMessage',{from:'system',text:`${p.name} disconnected.`,ts:Date.now(),system:true});
    io.to(code).emit('roomUpdate', publicState(room));
  });
});

function scoreAndFinish(room, code){
  const scoresH=[], scoresP=[];
  for(const [tok,seat] of room.holes.entries()){
    scoresH.push({tok,score:evalHoldem(seat.pickHoldem, room.board)});
    scoresP.push({tok,score:evalPLO(seat.pickPLO, room.board)});
  }
  scoresH.sort((a,b)=>cmp5(b.score,a.score));
  scoresP.sort((a,b)=>cmp5(b.score,a.score));
  const topH=scoresH.filter(x=>cmp5(x.score,scoresH[0].score)===0).map(x=>x.tok);
  const topP=scoresP.filter(x=>cmp5(x.score,scoresP[0].score)===0).map(x=>x.tok);

  const eqHE={}, eqPLO={};
  for(const [tok] of room.holes.entries()){
    eqHE[tok]={ win: topH.includes(tok)?100:0, tie:0 };
    eqPLO[tok]={ win: topP.includes(tok)?100:0, tie:0 };
  }
  room.equities={ he:eqHE, plo:eqPLO };
  io.to(code).emit('streetUpdate', { stage:'river', board:room.board, equities:room.equities, picks:buildPicks(room) });

  const pot=room.ante * room.holes.size;
  const heShare=(pot/2)/Math.max(1, topH.length);
  const ploShare=(pot/2)/Math.max(1, topP.length);
  for(const t of topH){ const p=room.players.get(t); p.balance=(p.balance||0)+heShare; }
  for(const t of topP){ const p=room.players.get(t); p.balance=(p.balance||0)+ploShare; }

  const activeTokens=[...room.holes.keys()];
  activeTokens.forEach(tok=> room.players.get(tok).stats.handsPlayed++);
  topH.forEach(tok=> room.players.get(tok).stats.winsHE++);
  topP.forEach(tok=> room.players.get(tok).stats.winsPLO++);
  const scoops=(topH.length===1 && topP.length===1 && topH[0]===topP[0]) ? [topH[0]] : [];

  let scoopBonusApplied = 0;
  if (scoops.length && room.scoopLocked && room.scoopBonus>0){
    const winner = scoops[0];
    const others = activeTokens.filter(t=>t!==winner);
    const totalBonus = room.scoopBonus * others.length;
    for(const t of others){ room.players.get(t).balance -= room.scoopBonus; }
    room.players.get(winner).balance += totalBonus;
    scoopBonusApplied = totalBonus;
  }
  if (scoops.length) room.players.get(scoops[0]).stats.scoops++;

  const picks={}; for(const [tok,seat] of room.holes.entries()){
    picks[tok]={ name:room.players.get(tok).name, holdem:seat.pickHoldem, plo:seat.pickPLO, hole:seat.hole };
  }
  const playersSnapshot=[...room.players.entries()].map(([id,p])=>({ id, name:p.name, balance:+(p.balance||0) }));

  io.to(code).emit('results',{
    board:room.board,
    winners:{holdem:topH,plo:topP},
    scoops,
    scoopBonusApplied,
    picks,
    handNumber:room.handNumber,
    players:playersSnapshot
  });

  room.stage='results';
  io.to(code).emit('roomUpdate', publicState(room));
}

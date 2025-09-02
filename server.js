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
  for(let

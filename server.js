const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public'))); // serves public/index.html at "/"

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Peanuts server on ${PORT}`));

/* --- Minimal room wiring so page loads and sockets connect (keep your existing game logic if you already have it) --- */
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('disconnect', () => console.log('socket disconnected', socket.id));
});

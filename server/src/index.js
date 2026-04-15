'use strict';

const express        = require('express');
const { createServer } = require('http');
const { Server }     = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient }  = require('redis');
const { RoomManager }   = require('./roomManager');

const PORT      = parseInt(process.env.PORT || '3000', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const app        = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors:             { origin: '*', methods: ['GET', 'POST'] },
  transports:       ['websocket', 'polling'],
  pingTimeout:      60000,
  pingInterval:     25000,
  maxHttpBufferSize: 1e5,   // 100 KB — prevent oversized payloads
});

app.use(express.json());

const roomManager = new RoomManager(io);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', rooms: roomManager.rooms.size, uptime: process.uptime() });
});

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: roomManager.getPublicRooms() });
});

io.on('connection', socket => {
  roomManager.handleConnection(socket);
  socket.on('disconnect', () => roomManager.handleDisconnect(socket));
});

// Input throttle: server simply reads the latest input each game tick (last-write-wins),
// so flooding player_input events beyond 60/s wastes bandwidth but can't cheat.

async function start() {
  // Attempt Redis adapter for horizontal scaling
  try {
    const pub = createClient({ url: REDIS_URL });
    const sub = pub.duplicate();
    pub.on('error', err => console.warn('Redis pub:', err.message));
    sub.on('error', err => console.warn('Redis sub:', err.message));
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log('Redis adapter ready — horizontal scaling enabled');
  } catch (err) {
    console.warn('Redis unavailable, running single-node:', err.message);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Snow Brawl server listening on :${PORT}`);
  });
}

start().catch(err => { console.error('Fatal:', err); process.exit(1); });

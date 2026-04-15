'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt          = require('bcryptjs');
const { GameRoom }   = require('./game');

const MAX_PLAYERS = 20;
const MAX_ROOMS   = 100;

class RoomManager {
  constructor(io) {
    this.io          = io;
    this.rooms       = new Map();   // roomId → GameRoom
    this.playerRooms = new Map();   // socketId → roomId
  }

  // ─── Public room list (for lobby screen) ─────────────────────────────────

  getPublicRooms() {
    return Array.from(this.rooms.values()).map(r => ({
      id:          r.id,
      name:        r.name,
      playerCount: Object.keys(r.players).length,
      maxPlayers:  MAX_PLAYERS,
      hasPassword: !!r.passwordHash,
      status:      r.status,
    }));
  }

  // ─── Socket event wiring ──────────────────────────────────────────────────

  handleConnection(socket) {
    // ── list_rooms ──
    socket.on('list_rooms', cb => {
      if (typeof cb === 'function') cb({ rooms: this.getPublicRooms() });
    });

    // ── create_room ──
    socket.on('create_room', async (data, cb) => {
      if (typeof cb !== 'function') return;
      try {
        const playerName = String(data?.playerName || '').trim().slice(0, 16);
        const roomName   = String(data?.roomName   || '').trim().slice(0, 32);
        const password   = data?.password ? String(data.password) : null;

        if (!playerName) return cb({ error: 'Player name required' });
        if (!roomName)   return cb({ error: 'Room name required' });
        if (this.playerRooms.has(socket.id)) return cb({ error: 'Already in a room' });
        if (this.rooms.size >= MAX_ROOMS)    return cb({ error: 'Server at capacity' });

        const passwordHash = password ? await bcrypt.hash(password, 8) : null;
        const roomId       = uuidv4().replace(/-/g, '').slice(0, 6).toUpperCase();
        const room         = new GameRoom(this.io, roomId, roomName, passwordHash);
        this.rooms.set(roomId, room);

        this._joinRoom(socket, room, playerName, true);
        cb({ success: true, roomId });
        this._broadcastRoomList();
      } catch (err) {
        console.error('create_room:', err);
        cb({ error: 'Internal error' });
      }
    });

    // ── join_room ──
    socket.on('join_room', async (data, cb) => {
      if (typeof cb !== 'function') return;
      try {
        const playerName = String(data?.playerName || '').trim().slice(0, 16);
        const roomId     = String(data?.roomId     || '').toUpperCase();
        const password   = data?.password ? String(data.password) : null;

        if (!playerName) return cb({ error: 'Player name required' });
        if (!roomId)     return cb({ error: 'Room ID required' });
        if (this.playerRooms.has(socket.id)) return cb({ error: 'Already in a room' });

        const room = this.rooms.get(roomId);
        if (!room)                                             return cb({ error: 'Room not found' });
        if (room.status !== 'lobby')                          return cb({ error: 'Game in progress' });
        if (Object.keys(room.players).length >= MAX_PLAYERS)  return cb({ error: 'Room is full' });

        if (room.passwordHash) {
          if (!password)                                  return cb({ error: 'Password required' });
          if (!await bcrypt.compare(password, room.passwordHash)) return cb({ error: 'Wrong password' });
        }

        this._joinRoom(socket, room, playerName, false);
        cb({ success: true, roomId });
        this._broadcastRoomList();
      } catch (err) {
        console.error('join_room:', err);
        cb({ error: 'Internal error' });
      }
    });

    // ── leave_room ──
    socket.on('leave_room', cb => {
      this._leaveRoom(socket);
      if (typeof cb === 'function') cb({ success: true });
      this._broadcastRoomList();
    });

    // ── start_game ──
    socket.on('start_game', cb => {
      const room = this._playerRoom(socket.id);
      if (!room)                                              return _cb(cb, { error: 'Not in a room' });
      if (room.hostId !== socket.id)                         return _cb(cb, { error: 'Only the host can start' });
      if (room.status !== 'lobby')                           return _cb(cb, { error: 'Game already started' });
      if (Object.keys(room.players).length < 2)              return _cb(cb, { error: 'Need at least 2 players' });

      room.startCountdown();
      _cb(cb, { success: true });
      this._broadcastRoomList();
    });

    // ── change_team ──
    socket.on('change_team', cb => {
      const room = this._playerRoom(socket.id);
      if (!room || room.status !== 'lobby') return _cb(cb, { error: 'Cannot change team now' });
      const p = room.players[socket.id];
      if (!p) return;
      p.team = p.team === 0 ? 1 : 0;
      p.x    = room._spawnX(p.team);
      p.y    = room._spawnY();
      this.io.to(room.id).emit('room_updated', room.getLobbyState());
      _cb(cb, { success: true });
    });

    // ── player_input ──
    socket.on('player_input', input => {
      const room = this._playerRoom(socket.id);
      if (room) room.handleInput(socket.id, input);
    });

    // ── chat_message ──
    socket.on('chat_message', msg => {
      const room = this._playerRoom(socket.id);
      const p    = room && room.players[socket.id];
      if (!p) return;
      const text = String(msg || '').trim().slice(0, 200);
      if (!text) return;
      this.io.to(room.id).emit('chat_message', {
        type:       'player',
        playerId:   socket.id,
        playerName: p.name,
        team:       p.team,
        text,
        ts:         Date.now(),
      });
    });
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  _joinRoom(socket, room, playerName, isHost) {
    // Balance teams
    const counts = { 0: 0, 1: 0 };
    for (const p of Object.values(room.players)) counts[p.team]++;
    const team = counts[0] <= counts[1] ? 0 : 1;

    socket.join(room.id);
    this.playerRooms.set(socket.id, room.id);
    room.addPlayer(socket.id, playerName, team, isHost);

    // Send full room state to joiner
    socket.emit('room_joined', {
      playerId:  socket.id,
      roomState: room.getLobbyState(),
    });

    // Notify others in room (and update their lobby)
    socket.to(room.id).emit('room_updated', room.getLobbyState());

    // System chat: player joined
    this.io.to(room.id).emit('chat_message', {
      type: 'system',
      text: `${playerName} joined the room`,
      ts:   Date.now(),
    });
  }

  _leaveRoom(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (room) {
      const player = room.players[socket.id];
      const name   = player ? player.name : 'Someone';
      room.removePlayer(socket.id);
      socket.leave(roomId);
      if (Object.keys(room.players).length === 0) {
        room.destroy();
        this.rooms.delete(roomId);
      } else {
        this.io.to(roomId).emit('room_updated', room.getLobbyState());
        this.io.to(roomId).emit('chat_message', {
          type: 'system',
          text: `${name} left the room`,
          ts:   Date.now(),
        });
      }
    }
    this.playerRooms.delete(socket.id);
  }

  _playerRoom(socketId) {
    const id = this.playerRooms.get(socketId);
    return id ? this.rooms.get(id) : null;
  }

  _broadcastRoomList() {
    // Push updated list to anyone not in a room (the menu screen)
    this.io.emit('room_list_update', { rooms: this.getPublicRooms() });
  }

  handleDisconnect(socket) {
    this._leaveRoom(socket);
    this._broadcastRoomList();
  }
}

function _cb(fn, payload) {
  if (typeof fn === 'function') fn(payload);
}

module.exports = { RoomManager };

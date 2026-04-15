'use strict';

const { v4: uuidv4 } = require('uuid');
const { circleRect, circleCircle } = require('./physics');

// ─── World constants ──────────────────────────────────────────────────────────
const TILE       = 16;
const MAP_COLS   = 60;
const MAP_ROWS   = 40;
const MAP_W      = MAP_COLS * TILE;   // 960 px
const MAP_H      = MAP_ROWS * TILE;   // 640 px

// Team zones (pixel x boundaries enforced during countdown)
const BLUE_ZONE_MAX_X = 14 * TILE;   // 224 — blue can't go past this rightward
const RED_ZONE_MIN_X  = 46 * TILE;   // 736 — red can't go past this leftward

// Physics
const PLAYER_SPEED  = 120;   // px / s
const PLAYER_RADIUS = 8;
const PLAYER_HP     = 100;
const HP_PER_HIT    = 25;    // 4 hits = eliminated

const BALL_SPEED    = 290;   // px / s
const BALL_RADIUS   = 5;
const BALL_MAX_DIST = 450;   // px before despawn
const BALL_COOLDOWN = 750;   // ms between throws

// Tick rate
const TICK_RATE = 20;
const TICK_MS   = 1000 / TICK_RATE;  // 50 ms

// ─── Snow pile positions (tile coords) ──────────────────────────────────────
// Each pile is 2×2 tiles (32×32 px). Laid out for bilateral symmetry x=30.
const SNOW_PILE_TILES = [
  // Inner zone edges — force players off spawn line
  [15,  5], [45,  5],
  [15, 15], [45, 15],
  [15, 25], [45, 25],
  [15, 35], [45, 35],
  // Quarter-field clusters
  [20,  8], [40,  8],
  [20, 20], [40, 20],
  [20, 32], [40, 32],
  // Center corridor pillars
  [27, 12], [33, 12],
  [27, 28], [33, 28],
  // Central fortress
  [29, 19], [31, 19],
  [29, 21], [31, 21],
  // Flanking cover deep in zones
  [ 8, 12], [52, 12],
  [ 8, 28], [52, 28],
];

const SNOW_PILES = SNOW_PILE_TILES.map(([col, row]) => ({
  id: `pile_${col}_${row}`,
  x:  col * TILE,
  y:  row * TILE,
  w:  TILE * 2,
  h:  TILE * 2,
}));

// ─── GameRoom ─────────────────────────────────────────────────────────────────
class GameRoom {
  constructor(io, id, name, passwordHash) {
    this.io           = io;
    this.id           = id;
    this.name         = name;
    this.passwordHash = passwordHash;
    this.status       = 'lobby';   // lobby | countdown | playing | finished
    this.players      = {};        // socketId → PlayerState
    this.snowballs    = [];        // SnowballState[]
    this.hostId       = null;
    this.countdown    = 10;
    this.winner       = null;      // null | 0 (blue) | 1 (red) | 'draw'
    this._cdTimer     = null;
    this._gameTimer   = null;
    this._lastTick    = 0;
  }

  // ─── Player management ────────────────────────────────────────────────────

  addPlayer(socketId, name, team, isHost) {
    if (isHost) this.hostId = socketId;
    this.players[socketId] = {
      id:          socketId,
      name,
      team,          // 0 = blue, 1 = red
      isHost,
      x:           this._spawnX(team),
      y:           this._spawnY(),
      health:      PLAYER_HP,
      alive:       true,
      score:       0,
      kills:       0,
      input:       { up: false, down: false, left: false, right: false },
      aimAngle:    0,
      lastThrowAt: 0,
    };
  }

  removePlayer(socketId) {
    delete this.players[socketId];
    if (this.hostId === socketId) {
      const ids = Object.keys(this.players);
      if (ids.length > 0) {
        this.hostId                = ids[0];
        this.players[ids[0]].isHost = true;
        this.io.to(this.id).emit('new_host', { id: ids[0] });
      }
    }
  }

  handleInput(socketId, input) {
    const p = this.players[socketId];
    if (!p || !p.alive) return;
    if (this.status !== 'countdown' && this.status !== 'playing') return;

    p.input = {
      up:    !!input.up,
      down:  !!input.down,
      left:  !!input.left,
      right: !!input.right,
    };
    if (typeof input.aimAngle === 'number' && isFinite(input.aimAngle)) {
      p.aimAngle = input.aimAngle;
    }
    if (input.throw && this.status === 'playing') {
      this._spawnBall(socketId);
    }
  }

  // ─── Countdown → game ────────────────────────────────────────────────────

  startCountdown() {
    if (this.status !== 'lobby') return;
    this.status    = 'countdown';
    this.countdown = 10;

    this.io.to(this.id).emit('countdown_start', {
      countdown: this.countdown,
      gameState: this._buildGameState(),
    });

    this._cdTimer = setInterval(() => {
      this.countdown--;
      this.io.to(this.id).emit('countdown_tick', { countdown: this.countdown });
      if (this.countdown <= 0) {
        clearInterval(this._cdTimer);
        this._cdTimer = null;
        this._startPlaying();
      }
    }, 1000);
  }

  _startPlaying() {
    this.status    = 'playing';
    this._lastTick = Date.now();
    for (const p of Object.values(this.players)) {
      p.input       = { up: false, down: false, left: false, right: false };
      p.lastThrowAt = 0;
    }
    this.io.to(this.id).emit('game_started', { gameState: this._buildGameState() });
    this._gameTimer = setInterval(() => this._tick(), TICK_MS);
  }

  // ─── Game loop ────────────────────────────────────────────────────────────

  _tick() {
    const now = Date.now();
    const dt  = Math.min((now - this._lastTick) / 1000, 0.1);
    this._lastTick = now;

    this._movePlayers(dt);
    this._moveBalls(dt);
    this._checkWin();

    if (this.status === 'playing') {
      this.io.to(this.id).emit('game_state', this._buildGameState());
    }
  }

  _movePlayers(dt) {
    for (const p of Object.values(this.players)) {
      if (!p.alive) continue;

      let dx = 0, dy = 0;
      if (p.input.up)    dy -= 1;
      if (p.input.down)  dy += 1;
      if (p.input.left)  dx -= 1;
      if (p.input.right) dx += 1;
      if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

      let nx = p.x + dx * PLAYER_SPEED * dt;
      let ny = p.y + dy * PLAYER_SPEED * dt;

      // Zone restriction during countdown
      if (this.status === 'countdown') {
        if (p.team === 0) nx = Math.min(nx, BLUE_ZONE_MAX_X - PLAYER_RADIUS);
        else              nx = Math.max(nx, RED_ZONE_MIN_X  + PLAYER_RADIUS);
      }

      // World boundary clamp
      nx = Math.max(PLAYER_RADIUS, Math.min(MAP_W - PLAYER_RADIUS, nx));
      ny = Math.max(PLAYER_RADIUS, Math.min(MAP_H - PLAYER_RADIUS, ny));

      // Snow pile collision — try full move then axis-separated slide
      if (!this._hitsAnyPile(nx, ny, PLAYER_RADIUS)) {
        p.x = nx; p.y = ny;
      } else {
        const tx = p.x + dx * PLAYER_SPEED * dt;
        const ty = p.y + dy * PLAYER_SPEED * dt;
        if (!this._hitsAnyPile(
          Math.max(PLAYER_RADIUS, Math.min(MAP_W - PLAYER_RADIUS, tx)),
          p.y, PLAYER_RADIUS)) {
          p.x = Math.max(PLAYER_RADIUS, Math.min(MAP_W - PLAYER_RADIUS, tx));
        }
        if (!this._hitsAnyPile(
          p.x,
          Math.max(PLAYER_RADIUS, Math.min(MAP_H - PLAYER_RADIUS, ty)),
          PLAYER_RADIUS)) {
          p.y = Math.max(PLAYER_RADIUS, Math.min(MAP_H - PLAYER_RADIUS, ty));
        }
      }
    }
  }

  _moveBalls(dt) {
    const dead = [];
    for (const b of this.snowballs) {
      b.x    += b.vx * dt;
      b.y    += b.vy * dt;
      b.dist += Math.hypot(b.vx, b.vy) * dt;

      if (b.dist >= BALL_MAX_DIST)                           { dead.push(b.id); continue; }
      if (b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H){ dead.push(b.id); continue; }
      if (this._hitsAnyPile(b.x, b.y, BALL_RADIUS)) {
        dead.push(b.id);
        this.io.to(this.id).emit('fx_puff', { x: b.x, y: b.y });
        continue;
      }

      for (const p of Object.values(this.players)) {
        if (!p.alive || p.id === b.ownerId || p.team === b.ownerTeam) continue;
        if (circleCircle(b.x, b.y, BALL_RADIUS, p.x, p.y, PLAYER_RADIUS)) {
          dead.push(b.id);
          p.health -= HP_PER_HIT;
          const thrower = this.players[b.ownerId];
          if (thrower) thrower.score += 10;
          this.io.to(this.id).emit('fx_hit', { x: p.x, y: p.y });

          if (p.health <= 0) {
            p.health = 0;
            p.alive  = false;
            if (thrower) { thrower.score += 50; thrower.kills++; }
            this.io.to(this.id).emit('player_eliminated', {
              id:   p.id,
              name: p.name,
              by:   thrower ? thrower.name : '?',
            });
          } else {
            this.io.to(this.id).emit('player_hit', { id: p.id, health: p.health });
          }
          break;
        }
      }
    }

    if (dead.length) {
      const deadSet = new Set(dead);
      this.snowballs = this.snowballs.filter(b => !deadSet.has(b.id));
    }
  }

  _checkWin() {
    if (this.status !== 'playing') return;
    const alive = { 0: 0, 1: 0 };
    for (const p of Object.values(this.players)) {
      if (p.alive) alive[p.team]++;
    }
    if (alive[0] === 0 && alive[1] === 0) this._endGame('draw');
    else if (alive[0] === 0) this._endGame(1);
    else if (alive[1] === 0) this._endGame(0);
  }

  _endGame(winner) {
    this.status = 'finished';
    this.winner = winner;
    clearInterval(this._gameTimer);
    this._gameTimer = null;

    const stats = Object.values(this.players).map(p => ({
      id: p.id, name: p.name, team: p.team,
      kills: p.kills, score: p.score,
    }));
    this.io.to(this.id).emit('game_over', { winner, stats });

    // Auto-reset to lobby after 12 s
    setTimeout(() => this._resetLobby(), 12000);
  }

  _resetLobby() {
    this.status    = 'lobby';
    this.snowballs = [];
    this.winner    = null;
    this.countdown = 10;
    for (const p of Object.values(this.players)) {
      p.health      = PLAYER_HP;
      p.alive       = true;
      p.score       = 0;
      p.kills       = 0;
      p.x           = this._spawnX(p.team);
      p.y           = this._spawnY();
      p.input       = { up: false, down: false, left: false, right: false };
      p.lastThrowAt = 0;
    }
    this.io.to(this.id).emit('lobby_reset', { roomState: this.getLobbyState() });
  }

  // ─── Snowball factory ─────────────────────────────────────────────────────

  _spawnBall(socketId) {
    const p   = this.players[socketId];
    if (!p || !p.alive) return;
    const now = Date.now();
    if (now - p.lastThrowAt < BALL_COOLDOWN) return;
    p.lastThrowAt = now;

    this.snowballs.push({
      id:        uuidv4().substring(0, 8),
      ownerId:   socketId,
      ownerTeam: p.team,
      x:         p.x,
      y:         p.y,
      vx:        Math.cos(p.aimAngle) * BALL_SPEED,
      vy:        Math.sin(p.aimAngle) * BALL_SPEED,
      dist:      0,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _spawnX(team) {
    return team === 0
      ? (2  + Math.random() * 8)  * TILE
      : (50 + Math.random() * 8)  * TILE;
  }

  _spawnY() {
    return (3 + Math.random() * 34) * TILE;
  }

  _hitsAnyPile(cx, cy, cr) {
    for (const pile of SNOW_PILES) {
      if (circleRect(cx, cy, cr, pile.x, pile.y, pile.w, pile.h)) return true;
    }
    return false;
  }

  // ─── State serialisation ──────────────────────────────────────────────────

  getLobbyState() {
    return {
      id:        this.id,
      name:      this.name,
      status:    this.status,
      hostId:    this.hostId,
      countdown: this.countdown,
      snowPiles: SNOW_PILES,
      players:   Object.values(this.players).map(p => ({
        id:     p.id,
        name:   p.name,
        team:   p.team,
        isHost: p.isHost,
        health: p.health,
        alive:  p.alive,
        x:      p.x,
        y:      p.y,
      })),
    };
  }

  _buildGameState() {
    const players = {};
    for (const p of Object.values(this.players)) {
      players[p.id] = {
        id:     p.id,
        name:   p.name,
        team:   p.team,
        x:      p.x,
        y:      p.y,
        health: p.health,
        alive:  p.alive,
        kills:  p.kills,
        score:  p.score,
        aimAngle: p.aimAngle,
      };
    }
    return {
      tick:      Date.now(),
      status:    this.status,
      winner:    this.winner,
      players,
      snowballs: this.snowballs.map(b => ({ id: b.id, x: b.x, y: b.y })),
    };
  }

  destroy() {
    clearInterval(this._cdTimer);
    clearInterval(this._gameTimer);
  }
}

module.exports = { GameRoom, SNOW_PILES, MAP_W, MAP_H, TILE };

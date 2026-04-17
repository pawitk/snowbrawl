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
const BLUE_ZONE_MAX_X = 14 * TILE;   // 224
const RED_ZONE_MIN_X  = 46 * TILE;   // 736

// Physics
const PLAYER_SPEED  = 120;   // px / s
const PLAYER_RADIUS = 8;
const PLAYER_HP     = 100;
const HP_PER_HIT    = 25;    // 4 hits = eliminated

const BALL_SPEED      = 290;   // px / s
const BALL_RADIUS     = 5;
const BALL_STD_DIST   = 400;   // px — standard (tap) throw distance
const BALL_BONUS_DIST = 350;   // extra px for full-power (1 s held) throw

const BUILD_TIME         = 800;   // ms to build a snowball
const DROP_PICKUP_R      = 24;    // px radius to pick up a dropped ball
const PLAYER_SPRINT_SPEED = 220;  // px/s while sprinting (vs 120 normal)
const SPRINT_DURATION    = 3000;  // ms of sprint per activation

// Tick rate
const TICK_RATE = 20;
const TICK_MS   = 1000 / TICK_RATE;  // 50 ms

// ─── Snow pile positions (tile coords) ───────────────────────────────────────
// Each pile is 2×2 tiles (32×32 px). Laid out for bilateral symmetry x=30.
const SNOW_PILE_TILES = [
  // Inner zone edges
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
  // Flanking cover
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
    this.io            = io;
    this.id            = id;
    this.name          = name;
    this.passwordHash  = passwordHash;
    this.status        = 'lobby';
    this.players       = {};
    this.snowballs     = [];
    this.droppedBalls  = [];   // { id, x, y, tileKey }[]
    this.dynamicPiles  = [];   // player-built barriers
    this.depletedTiles = new Set();  // tile keys where snow was harvested
    this.hostId        = null;
    this.countdown     = 10;
    this.winner        = null;
    this._cdTimer      = null;
    this._gameTimer    = null;
    this._lastTick     = 0;
  }

  // ─── Player management ────────────────────────────────────────────────────

  addPlayer(socketId, name, team, isHost) {
    if (isHost) this.hostId = socketId;
    this.players[socketId] = {
      id:           socketId,
      name,
      team,
      isHost,
      x:            this._spawnX(team),
      y:            this._spawnY(),
      health:       PLAYER_HP,
      alive:        true,
      score:        0,
      kills:        0,
      input:        { up: false, down: false, left: false, right: false },
      aimAngle:     0,          // derived from movement direction
      heldBall:     false,      // holding a built snowball
      isBuilding:   false,      // currently building one
      buildStartAt: 0,
      isSprinting:  false,
      sprintEndAt:  0,
    };
  }

  removePlayer(socketId) {
    delete this.players[socketId];
    if (this.hostId === socketId) {
      const ids = Object.keys(this.players);
      if (ids.length > 0) {
        this.hostId                 = ids[0];
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

    if (this.status === 'playing') {
      if (input.build)   this._tryBuild(socketId);
      if (input.pickup)  this._tryPickupOrDrop(socketId);
      if (input.throw)   this._tryThrow(socketId, input.throwPower || 0);
      if (input.sprint)  this._trySprint(socketId);
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
      p.input        = { up: false, down: false, left: false, right: false };
      p.heldBall     = false;
      p.isBuilding   = false;
      p.buildStartAt = 0;
      p.isSprinting  = false;
      p.sprintEndAt  = 0;
    }
    this.io.to(this.id).emit('game_started', { gameState: this._buildGameState() });
    this._gameTimer = setInterval(() => this._tick(), TICK_MS);
  }

  // ─── Game loop ────────────────────────────────────────────────────────────

  _tick() {
    const now = Date.now();
    const dt  = Math.min((now - this._lastTick) / 1000, 0.1);
    this._lastTick = now;

    this._processBuild(now);
    this._updateFacing();
    this._movePlayers(dt);
    this._moveBalls(dt);
    this._checkWin();

    if (this.status === 'playing') {
      this.io.to(this.id).emit('game_state', this._buildGameState());
    }
  }

  // Complete any builds whose timer has elapsed
  _processBuild(now) {
    for (const p of Object.values(this.players)) {
      if (!p.alive || !p.isBuilding) continue;
      if (now - p.buildStartAt >= BUILD_TIME) {
        p.isBuilding   = false;
        p.buildStartAt = 0;
        p.heldBall     = true;
        // Mark this tile's snow as depleted
        this.depletedTiles.add(this._tileKey(p.x, p.y));
      }
    }
  }

  // Update aim angle based on most-recent movement direction
  _updateFacing() {
    for (const p of Object.values(this.players)) {
      if (!p.alive) continue;
      let dx = 0, dy = 0;
      if (p.input.up)    dy -= 1;
      if (p.input.down)  dy += 1;
      if (p.input.left)  dx -= 1;
      if (p.input.right) dx += 1;
      if (dx !== 0 || dy !== 0) {
        p.aimAngle = Math.atan2(dy, dx);
      }
    }
  }

  _movePlayers(dt) {
    const now = Date.now();
    for (const p of Object.values(this.players)) {
      if (!p.alive) continue;

      // End sprint when timer expires
      if (p.isSprinting && now >= p.sprintEndAt) {
        p.isSprinting = false;
      }

      // No movement while building a snowball
      if (p.isBuilding) continue;

      let dx = 0, dy = 0;
      if (p.input.up)    dy -= 1;
      if (p.input.down)  dy += 1;
      if (p.input.left)  dx -= 1;
      if (p.input.right) dx += 1;
      if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

      const speed = p.isSprinting ? PLAYER_SPRINT_SPEED : PLAYER_SPEED;
      let nx = p.x + dx * speed * dt;
      let ny = p.y + dy * speed * dt;

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
        const tx = p.x + dx * speed * dt;
        const ty = p.y + dy * speed * dt;
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

      if (b.dist >= b.maxDist)                              { dead.push(b.id); continue; }
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
            p.health      = 0;
            p.alive       = false;
            p.heldBall    = false;
            p.isBuilding  = false;
            p.isSprinting = false;
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
    setTimeout(() => this._resetLobby(), 12000);
  }

  _resetLobby() {
    this.status        = 'lobby';
    this.snowballs     = [];
    this.droppedBalls  = [];
    this.dynamicPiles  = [];
    this.depletedTiles = new Set();
    this.winner        = null;
    this.countdown     = 10;
    for (const p of Object.values(this.players)) {
      p.health       = PLAYER_HP;
      p.alive        = true;
      p.score        = 0;
      p.kills        = 0;
      p.x            = this._spawnX(p.team);
      p.y            = this._spawnY();
      p.input        = { up: false, down: false, left: false, right: false };
      p.heldBall     = false;
      p.isBuilding   = false;
      p.buildStartAt = 0;
      p.isSprinting  = false;
      p.sprintEndAt  = 0;
    }
    this.io.to(this.id).emit('lobby_reset', { roomState: this.getLobbyState() });
  }

  // ─── Snowball actions ─────────────────────────────────────────────────────

  _tryBuild(socketId) {
    const p = this.players[socketId];
    if (!p || !p.alive || p.heldBall || p.isBuilding) return;
    // Can't build from a depleted tile
    if (this.depletedTiles.has(this._tileKey(p.x, p.y))) return;
    p.isBuilding   = true;
    p.buildStartAt = Date.now();
  }

  _tryPickupOrDrop(socketId) {
    const p = this.players[socketId];
    if (!p || !p.alive) return;

    if (p.heldBall) {
      // Drop the held ball at current position
      p.heldBall = false;
      const id       = uuidv4().substring(0, 8);
      const stackKey = this._stackKey(p.x, p.y);  // coarse 32 px grid
      this.droppedBalls.push({ id, x: p.x, y: p.y, stackKey });

      // If 3 balls have been dropped in the same 32 px region → barrier
      const samePatch = this.droppedBalls.filter(b => b.stackKey === stackKey);
      if (samePatch.length >= 3) {
        const toRemove = new Set(samePatch.slice(0, 3).map(b => b.id));
        this.droppedBalls = this.droppedBalls.filter(b => !toRemove.has(b.id));
        const [col2, row2] = stackKey.split('_').map(Number);
        this.dynamicPiles.push({
          id: `dyn_${col2}_${row2}_${Date.now()}`,
          x:  col2 * TILE * 2,
          y:  row2 * TILE * 2,
          w:  TILE * 2,
          h:  TILE * 2,
        });
      }
    } else {
      // Try to pick up the nearest dropped ball within range
      let nearest  = null;
      let nearDist = Infinity;
      for (const b of this.droppedBalls) {
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d <= DROP_PICKUP_R && d < nearDist) {
          nearest  = b;
          nearDist = d;
        }
      }
      if (nearest) {
        this.droppedBalls = this.droppedBalls.filter(b => b.id !== nearest.id);
        p.heldBall = true;
      }
    }
  }

  _trySprint(socketId) {
    const p = this.players[socketId];
    if (!p || !p.alive || p.isSprinting) return;
    // Require more than one health bar to sprint
    if (p.health <= HP_PER_HIT) return;
    p.health      -= HP_PER_HIT;
    p.isSprinting  = true;
    p.sprintEndAt  = Date.now() + SPRINT_DURATION;
    this.io.to(this.id).emit('player_hit', { id: p.id, health: p.health });
  }

  _tryThrow(socketId, throwPower) {
    const p = this.players[socketId];
    if (!p || !p.alive || !p.heldBall) return;
    p.heldBall = false;
    // throwPower: 0–1000 ms. 0 = standard distance, 1000 = max.
    const maxDist = BALL_STD_DIST + Math.min(throwPower / 1000, 1) * BALL_BONUS_DIST;

    this.snowballs.push({
      id:        uuidv4().substring(0, 8),
      ownerId:   socketId,
      ownerTeam: p.team,
      x:         p.x,
      y:         p.y,
      vx:        Math.cos(p.aimAngle) * BALL_SPEED,
      vy:        Math.sin(p.aimAngle) * BALL_SPEED,
      dist:      0,
      maxDist,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _tileKey(x, y) {
    return `${Math.floor(x / TILE)}_${Math.floor(y / TILE)}`;
  }

  // Coarser 32 px (2×TILE) grid used for barrier stacking — forgiving enough
  // that slight player drift between drops still counts as the same spot.
  _stackKey(x, y) {
    return `${Math.floor(x / (TILE * 2))}_${Math.floor(y / (TILE * 2))}`;
  }

  _spawnX(team) {
    return team === 0
      ? (2  + Math.random() * 8) * TILE
      : (50 + Math.random() * 8) * TILE;
  }

  _spawnY() {
    return (3 + Math.random() * 34) * TILE;
  }

  _hitsAnyPile(cx, cy, cr) {
    for (const pile of SNOW_PILES) {
      if (circleRect(cx, cy, cr, pile.x, pile.y, pile.w, pile.h)) return true;
    }
    for (const pile of this.dynamicPiles) {
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
    const now     = Date.now();
    const players = {};
    for (const p of Object.values(this.players)) {
      players[p.id] = {
        id:            p.id,
        name:          p.name,
        team:          p.team,
        x:             p.x,
        y:             p.y,
        health:        p.health,
        alive:         p.alive,
        kills:         p.kills,
        score:         p.score,
        aimAngle:      p.aimAngle,
        heldBall:      p.heldBall,
        isBuilding:    p.isBuilding,
        buildProgress: p.isBuilding
          ? Math.min((now - p.buildStartAt) / BUILD_TIME, 1)
          : 0,
        isSprinting:   p.isSprinting,
        sprintLeft:    p.isSprinting ? Math.max(0, p.sprintEndAt - now) : 0,
      };
    }
    return {
      tick:          now,
      status:        this.status,
      winner:        this.winner,
      players,
      snowballs:     this.snowballs.map(b => ({ id: b.id, x: b.x, y: b.y })),
      droppedBalls:  this.droppedBalls.map(b => ({ id: b.id, x: b.x, y: b.y })),
      snowPiles:     [...SNOW_PILES, ...this.dynamicPiles],
      depletedTiles: Array.from(this.depletedTiles),
    };
  }

  destroy() {
    clearInterval(this._cdTimer);
    clearInterval(this._gameTimer);
  }
}

module.exports = { GameRoom, SNOW_PILES, MAP_W, MAP_H, TILE };

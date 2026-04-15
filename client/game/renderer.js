'use strict';
// ── Renderer ──────────────────────────────────────────────────────────────────
// Owns the <canvas> and the camera. Called once per rAF frame from game.js.

const Renderer = (() => {
  let canvas, ctx;
  let camX = 0, camY = 0;  // camera top-left in world coords
  let scale = 1;            // world-to-canvas scale factor

  function init() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    const aw = wrapper.clientWidth  || window.innerWidth;
    const ah = wrapper.clientHeight || window.innerHeight;
    // Maintain 3:2 aspect (960:640)
    scale = Math.min(aw / MAP_W, ah / MAP_H);
    const cw = Math.floor(MAP_W * scale);
    const ch = Math.floor(MAP_H * scale);
    canvas.style.width  = cw + 'px';
    canvas.style.height = ch + 'px';
    // Keep internal resolution fixed at world size for pixel-perfect art
    canvas.width  = MAP_W;
    canvas.height = MAP_H;
    ctx.imageSmoothingEnabled = false;
  }

  function worldToCanvas(wx, wy) {
    return { x: (wx - camX) * scale, y: (wy - camY) * scale };
  }

  // Camera follows local player, clamped to map
  function updateCamera(px, py) {
    const hw = MAP_W / 2;
    const hh = MAP_H / 2;
    camX = 0;  // map fits entirely in canvas — no scrolling needed
    camY = 0;
  }

  // ── Main render frame ──────────────────────────────────────────────────────

  function render(state, localPlayerId, dt) {
    if (!ctx) return;

    const { gameState, phase, countdown } = state;
    if (!gameState) return;

    ctx.save();
    // Since map = canvas resolution, no camera transform needed
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    // 1. Ground tiles
    drawGround(ctx, 0, 0, MAP_W, MAP_H);

    // 2. Center line
    drawCenterLine(ctx);

    // 3. Zone overlays during countdown
    drawZoneOverlays(ctx, phase, countdown);

    // 4. Snow piles
    const piles = state.snowPiles || SNOW_PILES;
    for (const pile of piles) {
      drawSnowPile(ctx, pile);
    }

    // 5. Snowballs
    if (gameState.snowballs) {
      for (const b of gameState.snowballs) {
        drawSnowball(ctx, b.x, b.y);
      }
    }

    // 6. Players (sorted by y for painter's depth)
    if (gameState.players) {
      const plist = Object.values(gameState.players)
        .filter(p => p.alive)
        .sort((a, b) => a.y - b.y);

      for (const p of plist) {
        drawPlayer(ctx, p.x, p.y, p.team, p.health, p.aimAngle || 0,
                   p.id === localPlayerId, p.name);
      }

      // Ghost (eliminated) players — faded
      for (const p of Object.values(gameState.players)) {
        if (p.alive) continue;
        ctx.save();
        ctx.globalAlpha = 0.35;
        drawPlayer(ctx, p.x, p.y, p.team, 0, 0, false, p.name);
        ctx.restore();
      }
    }

    // 7. Particles
    updateAndDrawParticles(ctx, dt);

    ctx.restore();
  }

  // ── HUD rendering ──────────────────────────────────────────────────────────

  function updateHUD(gameState, localPlayerId, phase, lastThrowTime) {
    if (!gameState || !localPlayerId) return;
    const me = gameState.players && gameState.players[localPlayerId];

    // Health
    const hudHealth = document.getElementById('hud-health');
    if (hudHealth && me) {
      const pct = me.health / PLAYER_HP;
      const bars = 4;
      let html = '';
      for (let i = 0; i < bars; i++) {
        const filled = pct > i / bars;
        html += `<div class="hp-block ${filled ? 'filled' : 'empty'} team-${me.team}"></div>`;
      }
      hudHealth.innerHTML = html;
    }

    // Team
    const hudTeam = document.getElementById('hud-team');
    if (hudTeam && me) {
      hudTeam.textContent = TEAM_NAME[me.team].toUpperCase();
      hudTeam.className   = `hud-team ${me.team === 0 ? 'blue' : 'red'}`;
    }

    // Alive count
    const hudPlayers = document.getElementById('hud-players');
    if (hudPlayers && gameState.players) {
      const aliveBlue = Object.values(gameState.players).filter(p => p.alive && p.team === 0).length;
      const aliveRed  = Object.values(gameState.players).filter(p => p.alive && p.team === 1).length;
      hudPlayers.innerHTML = `<span class="blue">${aliveBlue} ❄</span> <span class="vs">vs</span> <span class="red">🔥 ${aliveRed}</span>`;
    }

    // Throw cooldown indicator
    const hudCooldown = document.getElementById('hud-cooldown');
    if (hudCooldown) {
      const elapsed = Date.now() - (lastThrowTime || 0);
      const ready   = elapsed >= BALL_COOLDOWN;
      hudCooldown.textContent = ready ? '● THROW READY' : '○ RELOADING…';
      hudCooldown.className   = `hud-cooldown ${ready ? 'ready' : 'reload'}`;
    }

    // Scores
    const hudScores = document.getElementById('hud-scores');
    if (hudScores && gameState.players) {
      const scoreBlue = Object.values(gameState.players)
        .filter(p => p.team === 0).reduce((s,p) => s + (p.score||0), 0);
      const scoreRed  = Object.values(gameState.players)
        .filter(p => p.team === 1).reduce((s,p) => s + (p.score||0), 0);
      hudScores.innerHTML = `<span class="blue">${scoreBlue}</span> <span class="sep">—</span> <span class="red">${scoreRed}</span>`;
    }
  }

  // Returns the canvas-space position of a world point (for aim angle calc)
  function getCanvasPos(wx, wy) {
    return { x: wx, y: wy };  // 1:1 since canvas = world resolution
  }

  return { init, resize, render, updateHUD, getCanvasPos };
})();

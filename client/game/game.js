'use strict';
// ── Client game loop ──────────────────────────────────────────────────────────
// Stores server state, runs rAF loop, sends input, triggers renderer.

const Game = (() => {
  let running       = false;
  let lastFrame     = 0;
  let localPlayerId = null;
  let lastThrowTime = 0;

  // Two-snapshot interpolation buffer
  let prevState    = null;
  let curState     = null;
  let curStateTime = 0;

  // Shared room state (also has snowPiles, phase)
  let roomState = {
    phase:      'lobby',
    countdown:  10,
    snowPiles:  SNOW_PILES,
    gameState:  null,
  };

  // ─── State setters (called by main.js on socket events) ───────────────────

  function setLocalPlayer(id) { localPlayerId = id; }

  function applyGameState(gs) {
    prevState    = curState;
    curState     = gs;
    curStateTime = Date.now();

    roomState.gameState = gs;
    roomState.phase     = gs.status || roomState.phase;
  }

  function setPhase(phase, countdown) {
    roomState.phase    = phase;
    if (countdown !== undefined) roomState.countdown = countdown;
  }

  function setSnowPiles(piles) {
    roomState.snowPiles = piles || SNOW_PILES;
  }

  // ─── Effects (triggered by server events) ────────────────────────────────

  function onHitEffect(x, y) { spawnHit(x, y); }
  function onPuffEffect(x, y) { spawnPuff(x, y); }

  // ─── Game loop ────────────────────────────────────────────────────────────

  function start() {
    if (running) return;
    running   = true;
    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    // Send input
    const me = localPlayerId && roomState.gameState &&
               roomState.gameState.players &&
               roomState.gameState.players[localPlayerId];

    if (SB.socket && me && (roomState.phase === 'playing' || roomState.phase === 'countdown')) {
      const input = Input.getInputState(me.x, me.y);
      if (input.throw) lastThrowTime = Date.now();
      SB.socket.volatile.emit('player_input', input);
    }

    // Render
    Renderer.render(roomState, localPlayerId, dt);
    Renderer.updateHUD(roomState.gameState, localPlayerId, roomState.phase, lastThrowTime);

    requestAnimationFrame(loop);
  }

  return {
    start, stop,
    setLocalPlayer, applyGameState, setPhase, setSnowPiles,
    onHitEffect, onPuffEffect,
    getPhase: () => roomState.phase,
    getRoomState: () => roomState,
  };
})();

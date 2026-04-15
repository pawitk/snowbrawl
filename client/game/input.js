'use strict';
// ── Input manager ─────────────────────────────────────────────────────────────
// Tracks keyboard + mouse state. Computes aimAngle from mouse position relative
// to the local player's canvas position. Exposes a getInputState() snapshot.

const Input = (() => {
  const keys = {};
  let mouseX    = 0;
  let mouseY    = 0;
  let throwing  = false;   // mouse button held
  let throwPulse = false;  // single-frame flag for click

  window.addEventListener('keydown', e => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
      e.preventDefault();
    }
    keys[e.code] = true;
  });

  window.addEventListener('keyup', e => {
    keys[e.code] = false;
  });

  const canvas = () => document.getElementById('game-canvas');

  window.addEventListener('mousemove', e => {
    const c = canvas();
    if (!c) return;
    const rect = c.getBoundingClientRect();
    // Map screen coords to canvas logical coords
    const scaleX = c.width  / rect.width;
    const scaleY = c.height / rect.height;
    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top)  * scaleY;
  });

  window.addEventListener('mousedown', e => {
    if (e.button === 0) { throwing = true; throwPulse = true; }
  });

  window.addEventListener('mouseup', e => {
    if (e.button === 0) throwing = false;
  });

  // Prevent right-click context menu on canvas
  window.addEventListener('contextmenu', e => { if (canvas()) e.preventDefault(); });

  function getInputState(playerCanvasX, playerCanvasY) {
    const angle = Math.atan2(mouseY - playerCanvasY, mouseX - playerCanvasX);
    const tp = throwPulse;
    throwPulse = false;
    return {
      up:       !!(keys['KeyW'] || keys['ArrowUp']),
      down:     !!(keys['KeyS'] || keys['ArrowDown']),
      left:     !!(keys['KeyA'] || keys['ArrowLeft']),
      right:    !!(keys['KeyD'] || keys['ArrowRight']),
      throw:    tp,
      aimAngle: angle,
    };
  }

  function isChatKey(e) {
    return e.code === 'Enter' || e.key === 'Enter';
  }

  function isUp()    { return !!(keys['KeyW'] || keys['ArrowUp']); }
  function isDown()  { return !!(keys['KeyS'] || keys['ArrowDown']); }
  function isLeft()  { return !!(keys['KeyA'] || keys['ArrowLeft']); }
  function isRight() { return !!(keys['KeyD'] || keys['ArrowRight']); }

  return { getInputState, isChatKey, isUp, isDown, isLeft, isRight };
})();

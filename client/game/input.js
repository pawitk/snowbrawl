'use strict';
// ── Input manager ─────────────────────────────────────────────────────────────
// Keyboard-only. WASD/Arrows = move. J = build snowball. H = pickup/drop.
// Space = throw (hold longer for more distance). Shift = sprint. No mouse needed.

const Input = (() => {
  const keys = {};
  let buildPulse   = false;   // single-frame: J pressed
  let pickupPulse  = false;   // single-frame: H pressed
  let sprintPulse  = false;   // single-frame: Shift pressed
  let throwPulse   = false;   // single-frame: Space released
  let throwPower   = 0;       // ms Space was held when released (0–1000)
  let spaceDownAt  = 0;       // timestamp when Space was first pressed

  // Returns true only when a VISIBLE input/textarea has focus.
  // Hidden inputs (lobby chat behind the game screen, etc.) don't count.
  function chatFocused() {
    const el = document.activeElement;
    return !!(el &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
      el.offsetParent !== null);   // offsetParent is null when display:none
  }

  window.addEventListener('keydown', e => {
    if (chatFocused()) return;  // typing in chat — ignore game keys entirely

    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
      e.preventDefault();
    }

    if (!e.repeat) {
      if (e.code === 'KeyJ')                                    buildPulse  = true;
      if (e.code === 'KeyH')                                    pickupPulse = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight')    sprintPulse = true;
      if (e.code === 'Space')                                   spaceDownAt = Date.now();
    }

    keys[e.code] = true;
  });

  window.addEventListener('keyup', e => {
    if (!chatFocused() && e.code === 'Space' && keys['Space']) {
      throwPulse  = true;
      throwPower  = spaceDownAt ? Math.min(Date.now() - spaceDownAt, 1000) : 0;
      spaceDownAt = 0;
    }
    keys[e.code] = false;
  });

  function getInputState() {
    const bp  = buildPulse;
    const pp  = pickupPulse;
    const sp  = sprintPulse;
    const tp  = throwPulse;
    const pow = throwPower;
    buildPulse  = false;
    pickupPulse = false;
    sprintPulse = false;
    throwPulse  = false;
    throwPower  = 0;
    return {
      up:         !!(keys['KeyW'] || keys['ArrowUp']),
      down:       !!(keys['KeyS'] || keys['ArrowDown']),
      left:       !!(keys['KeyA'] || keys['ArrowLeft']),
      right:      !!(keys['KeyD'] || keys['ArrowRight']),
      build:      bp,
      pickup:     pp,
      sprint:     sp,
      throw:      tp,
      throwPower: pow,
    };
  }

  // How charged is the throw right now (0–1), for HUD charge bar
  function getSpaceCharge() {
    if (!keys['Space'] || !spaceDownAt) return 0;
    return Math.min((Date.now() - spaceDownAt) / 1000, 1);
  }

  function isChatKey(e) {
    return e.code === 'Enter' || e.key === 'Enter';
  }

  return { getInputState, getSpaceCharge, isChatKey };
})();

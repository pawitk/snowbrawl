'use strict';
// ── Pixel-art drawing functions ───────────────────────────────────────────────
// All coordinates are in world-space pixels. ctx is already scaled by camera.
// imageSmoothingEnabled = false keeps edges crisp.

function drawPlayer(ctx, x, y, team, health, aimAngle, isLocal, name) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const tc = TEAM_COLOR[team];
  const tl = TEAM_LIGHT[team];
  const td = TEAM_DARK[team];
  const out = '#0a0a14';

  ctx.save();
  ctx.translate(cx, cy);

  // ── Shadow ──
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Boots ──
  ctx.fillStyle = '#223';
  ctx.fillRect(-6, 10, 5, 5);
  ctx.fillRect(1,  10, 5, 5);
  ctx.strokeStyle = out;
  ctx.lineWidth = 1;
  ctx.strokeRect(-6.5, 9.5, 6, 6);
  ctx.strokeRect(0.5,  9.5, 6, 6);

  // ── Legs ──
  ctx.fillStyle = '#334';
  ctx.fillRect(-5,  5, 4, 7);
  ctx.fillRect( 1,  5, 4, 7);

  // ── Body (jacket) ──
  ctx.fillStyle = tc;
  ctx.fillRect(-7, -4, 14, 10);
  ctx.strokeStyle = out;
  ctx.strokeRect(-7.5, -4.5, 15, 11);

  // ── Jacket highlight strip ──
  ctx.fillStyle = tl;
  ctx.fillRect(-6, -4, 12, 2);

  // ── Arms ──
  // Mirror arm positions for a hint of aim direction
  const armAngle = aimAngle || 0;
  const ax = Math.cos(armAngle) * 8;
  const ay = Math.sin(armAngle) * 8;
  ctx.fillStyle = tc;
  ctx.fillRect(-9, -2, 3, 6);  // left arm
  ctx.fillRect( 6, -2, 3, 6);  // right arm
  // Throw-hand indicator
  ctx.fillStyle = tl;
  ctx.beginPath();
  ctx.arc(ax * 0.7, ay * 0.7 - 2, 3, 0, Math.PI * 2);
  ctx.fill();

  // ── Head ──
  ctx.fillStyle = '#ffd5a0';
  ctx.fillRect(-5, -13, 10, 9);
  ctx.strokeStyle = out;
  ctx.strokeRect(-5.5, -13.5, 11, 10);

  // ── Eyes ──
  ctx.fillStyle = out;
  ctx.fillRect(-3, -11, 2, 2);
  ctx.fillRect(1,  -11, 2, 2);

  // ── Hat ──
  ctx.fillStyle = td;
  ctx.fillRect(-5, -18, 10, 6);
  ctx.strokeStyle = out;
  ctx.strokeRect(-5.5, -18.5, 11, 7);
  ctx.fillStyle = tc;
  ctx.fillRect(-7, -13, 14, 2);   // brim

  // ── Scarf ──
  ctx.fillStyle = tl;
  ctx.fillRect(-7, -5, 14, 3);

  // ── Local player glow ring ──
  if (isLocal) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Aim arrow ──
  const arrowLen = 14;
  const ex = Math.cos(aimAngle) * arrowLen;
  const ey = Math.sin(aimAngle) * arrowLen;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(ex, ey - 2);
  ctx.stroke();

  ctx.restore();

  // ── Name tag ──
  ctx.save();
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(cx - 20, cy - 28, 40, 9);
  ctx.fillStyle = TEAM_LIGHT[team];
  ctx.fillText(name.slice(0, 12), cx, cy - 20);
  ctx.restore();

  // ── Health bar ──
  const barW  = 20;
  const barH  = 3;
  const barX  = cx - barW / 2;
  const barY  = cy - 32;
  const pct   = health / PLAYER_HP;
  ctx.save();
  ctx.fillStyle = '#111';
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  ctx.fillStyle = pct > 0.5 ? '#44dd44' : pct > 0.25 ? '#ddcc22' : '#dd3333';
  ctx.fillRect(barX, barY, Math.round(barW * pct), barH);
  ctx.restore();
}

function drawSnowball(ctx, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  ctx.save();
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Ball
  ctx.fillStyle = '#f0f8ff';
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#aaccdd';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Shine
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx - 2, cy - 2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSnowPile(ctx, pile) {
  const { x, y, w, h } = pile;
  const rx = Math.round(x);
  const ry = Math.round(y);

  ctx.save();

  // Base shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(rx + 2, ry + h - 4, w, 5);

  // Main body — layered arcs for a drifted-snow look
  const cx = rx + w / 2;
  const cy = ry + h;

  // Back layer
  ctx.fillStyle = '#c8dff0';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.55, h * 0.7, 0, Math.PI, 0, true);
  ctx.fill();

  // Middle layer
  ctx.fillStyle = '#ddeeff';
  ctx.beginPath();
  ctx.ellipse(cx - 2, cy, w * 0.45, h * 0.58, -0.1, Math.PI, 0, true);
  ctx.fill();

  // Top highlight
  ctx.fillStyle = '#f0f8ff';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy - 1, w * 0.3, h * 0.38, 0.1, Math.PI, 0, true);
  ctx.fill();

  // Sparkle dots
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(cx - 4, cy - h * 0.5 + 2, 2, 2);
  ctx.fillRect(cx + 3, cy - h * 0.35 + 1, 2, 2);
  ctx.fillRect(cx - 1, cy - h * 0.6 + 1, 1, 1);

  ctx.restore();
}

function drawGround(ctx, offsetX, offsetY, viewW, viewH) {
  // Draw tiled snow ground
  const startCol = Math.max(0, Math.floor(offsetX / TILE));
  const startRow = Math.max(0, Math.floor(offsetY / TILE));
  const endCol   = Math.min(MAP_COLS - 1, Math.ceil((offsetX + viewW) / TILE));
  const endRow   = Math.min(MAP_ROWS - 1, Math.ceil((offsetY + viewH) / TILE));

  for (let col = startCol; col <= endCol; col++) {
    for (let row = startRow; row <= endRow; row++) {
      const tx = col * TILE;
      const ty = row * TILE;

      // Checkerboard subtle tint
      const even = (col + row) % 2 === 0;
      ctx.fillStyle = even ? '#d8eaf8' : '#cce2f2';
      ctx.fillRect(tx, ty, TILE, TILE);

      // Occasional snow crystal detail
      if ((col * 7 + row * 13) % 17 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(tx + 4, ty + 4, 2, 2);
        ctx.fillRect(tx + 9, ty + 9, 1, 1);
      }
    }
  }

  // Border wall tiles
  ctx.fillStyle = '#8ab4cc';
  for (let col = 0; col < MAP_COLS; col++) {
    ctx.fillRect(col * TILE, 0,              TILE, TILE);
    ctx.fillRect(col * TILE, (MAP_ROWS-1)*TILE, TILE, TILE);
  }
  for (let row = 0; row < MAP_ROWS; row++) {
    ctx.fillRect(0,              row * TILE, TILE, TILE);
    ctx.fillRect((MAP_COLS-1)*TILE, row * TILE, TILE, TILE);
  }
}

function drawZoneOverlays(ctx, phase, countdown) {
  if (phase !== 'countdown') return;
  const alpha = 0.18 + 0.06 * Math.sin(Date.now() / 200);

  // Blue zone
  ctx.fillStyle = `rgba(68,136,255,${alpha})`;
  ctx.fillRect(0, 0, BLUE_ZONE_MAX_X, MAP_H);

  // Red zone
  ctx.fillStyle = `rgba(255,68,68,${alpha})`;
  ctx.fillRect(RED_ZONE_MIN_X, 0, MAP_W - RED_ZONE_MIN_X, MAP_H);

  // Zone boundary lines
  ctx.strokeStyle = 'rgba(68,136,255,0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(BLUE_ZONE_MAX_X, 0);
  ctx.lineTo(BLUE_ZONE_MAX_X, MAP_H);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,68,68,0.6)';
  ctx.beginPath();
  ctx.moveTo(RED_ZONE_MIN_X, 0);
  ctx.lineTo(RED_ZONE_MIN_X, MAP_H);
  ctx.stroke();

  ctx.setLineDash([]);
}

function drawCenterLine(ctx) {
  ctx.strokeStyle = 'rgba(180,200,220,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(MAP_W / 2, 0);
  ctx.lineTo(MAP_W / 2, MAP_H);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── Particle effects (snow puffs, hit sparks) ─────────────────────────────────
const particles = [];

function spawnPuff(x, y) {
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
    particles.push({
      type:  'puff',
      x, y,
      vx:    Math.cos(angle) * (20 + Math.random() * 30),
      vy:    Math.sin(angle) * (20 + Math.random() * 30),
      life:  0.6 + Math.random() * 0.3,
      maxLife: 0.9,
      r:     3 + Math.random() * 3,
    });
  }
}

function spawnHit(x, y) {
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      type:  'hit',
      x, y,
      vx:    Math.cos(angle) * (40 + Math.random() * 60),
      vy:    Math.sin(angle) * (40 + Math.random() * 60),
      life:  0.4 + Math.random() * 0.2,
      maxLife: 0.6,
      r:     2 + Math.random() * 2,
    });
  }
}

function updateAndDrawParticles(ctx, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x    += p.vx * dt;
    p.y    += p.vy * dt;
    p.vx   *= 0.92;
    p.vy   *= 0.92;
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const alpha = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.type === 'hit' ? '#ffffaa' : '#f0f8ff';
    ctx.beginPath();
    ctx.arc(Math.round(p.x), Math.round(p.y), p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Menu background snow particles ───────────────────────────────────────────
const menuSnow = [];
function initMenuSnow(w, h) {
  menuSnow.length = 0;
  for (let i = 0; i < 120; i++) {
    menuSnow.push({
      x:  Math.random() * w,
      y:  Math.random() * h,
      vy: 20 + Math.random() * 40,
      vx: -5 + Math.random() * 10,
      r:  1 + Math.random() * 2,
    });
  }
}

function updateAndDrawMenuSnow(ctx, w, h, dt) {
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(200,230,255,0.7)';
  for (const s of menuSnow) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.y > h) { s.y = -4; s.x = Math.random() * w; }
    if (s.x > w) s.x = 0;
    if (s.x < 0) s.x = w;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

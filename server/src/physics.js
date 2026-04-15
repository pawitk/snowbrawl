'use strict';

/**
 * Circle vs AABB collision.
 * Returns true when circle (cx,cy,cr) overlaps rectangle (rx,ry,rw,rh).
 */
function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX;
  const dy = cy - nearY;
  return dx * dx + dy * dy < cr * cr;
}

/**
 * Circle vs Circle collision.
 */
function circleCircle(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const minDist = r1 + r2;
  return dx * dx + dy * dy < minDist * minDist;
}

module.exports = { circleRect, circleCircle };

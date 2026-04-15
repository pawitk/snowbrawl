// ── Shared game constants (must stay in sync with server/src/game.js) ────────
'use strict';

const TILE     = 16;
const MAP_COLS = 60;
const MAP_ROWS = 40;
const MAP_W    = MAP_COLS * TILE;   // 960 px
const MAP_H    = MAP_ROWS * TILE;   // 640 px

// Team zone pixel boundaries
const BLUE_ZONE_MAX_X = 14 * TILE;  // 224
const RED_ZONE_MIN_X  = 46 * TILE;  // 736

// Player
const PLAYER_RADIUS = 8;
const PLAYER_HP     = 100;
const HP_PER_HIT    = 25;

// Snowball
const BALL_RADIUS   = 5;
const BALL_COOLDOWN = 750;  // ms

// Team colour palette
const TEAM_COLOR   = ['#4488ff', '#ff4444'];
const TEAM_LIGHT   = ['#88bbff', '#ff8888'];
const TEAM_DARK    = ['#2255cc', '#cc2222'];
const TEAM_NAME    = ['Blue',    'Red'    ];
const TEAM_ZONE_COLOR = ['rgba(68,136,255,0.12)', 'rgba(255,68,68,0.12)'];

// Snow pile layout (must match server)
const SNOW_PILE_TILES = [
  [15,  5], [45,  5],
  [15, 15], [45, 15],
  [15, 25], [45, 25],
  [15, 35], [45, 35],
  [20,  8], [40,  8],
  [20, 20], [40, 20],
  [20, 32], [40, 32],
  [27, 12], [33, 12],
  [27, 28], [33, 28],
  [29, 19], [31, 19],
  [29, 21], [31, 21],
  [ 8, 12], [52, 12],
  [ 8, 28], [52, 28],
];

const SNOW_PILES = SNOW_PILE_TILES.map(([col, row]) => ({
  id: `pile_${col}_${row}`,
  x: col * TILE,
  y: row * TILE,
  w: TILE * 2,
  h: TILE * 2,
}));

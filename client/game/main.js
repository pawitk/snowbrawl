'use strict';
// ── Main — UI state machine + Socket.io wiring ───────────────────────────────

window.SB = { socket: null };

// ─── Screen management ────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function showModal(id) {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ─── Chat helpers ─────────────────────────────────────────────────────────────

const MAX_CHAT_MSGS = 100;
let chatMessages = [];

function appendChat(msg) {
  chatMessages.push(msg);
  if (chatMessages.length > MAX_CHAT_MSGS) chatMessages.shift();
  renderChatLogs();
}

function renderChatLogs() {
  const html = chatMessages.map(m => {
    if (m.type === 'system') {
      return `<div class="chat-msg system">${escHtml(m.text)}</div>`;
    }
    const teamCls = m.team === 0 ? 'blue' : 'red';
    return `<div class="chat-msg player">
      <span class="chat-name ${teamCls}">${escHtml(m.playerName)}</span>
      <span class="chat-text">${escHtml(m.text)}</span>
    </div>`;
  }).join('');

  ['chat-log-lobby', 'chat-log-game'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendChat() {
  const el = document.getElementById('chat-input');
  if (!el) return;
  const text = el.value.trim();
  if (!text || !SB.socket) return;
  SB.socket.emit('chat_message', text);
  el.value = '';
}

// ─── Lobby UI ─────────────────────────────────────────────────────────────────

function renderLobby(roomState) {
  document.getElementById('lobby-room-name').textContent = roomState.name;
  document.getElementById('lobby-room-code').textContent = roomState.id;

  const isHost = roomState.hostId === SB.playerId;
  const startBtn = document.getElementById('btn-start');
  if (startBtn) {
    startBtn.classList.toggle('hidden', !isHost || roomState.status !== 'lobby');
  }

  const blueList = document.getElementById('team-blue-list');
  const redList  = document.getElementById('team-red-list');
  blueList.innerHTML = '';
  redList.innerHTML  = '';

  for (const p of (roomState.players || [])) {
    const div = document.createElement('div');
    div.className = 'player-entry';
    div.innerHTML = `
      <span class="player-dot ${p.team === 0 ? 'blue' : 'red'}">●</span>
      <span class="player-name">${escHtml(p.name)}${p.isHost ? ' ♛' : ''}</span>
      ${p.id === SB.playerId ? '<span class="you-tag">(you)</span>' : ''}
    `;
    if (p.team === 0) blueList.appendChild(div);
    else              redList.appendChild(div);
  }

  const status = document.getElementById('lobby-status');
  if (status) {
    const count = (roomState.players || []).length;
    status.textContent = isHost
      ? (count < 2 ? 'Waiting for another player to join…' : 'Press START to begin!')
      : 'Waiting for the host to start…';
  }
}

function refreshRoomList() {
  if (!SB.socket) return;
  SB.socket.emit('list_rooms', ({ rooms }) => {
    const container = document.getElementById('room-list-container');
    if (!container) return;
    if (!rooms || rooms.length === 0) {
      container.innerHTML = '<div class="no-rooms">No open rooms. Create one!</div>';
      return;
    }
    container.innerHTML = rooms.map(r => `
      <div class="room-entry" data-id="${escHtml(r.id)}">
        <div class="room-entry-name">${escHtml(r.name)}</div>
        <div class="room-entry-meta">
          ${r.playerCount}/${r.maxPlayers} players
          ${r.hasPassword ? ' 🔒' : ''}
          <span class="room-status ${r.status}">${r.status}</span>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.room-entry').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        document.getElementById('join-room-id').value = id;
        showModal('modal-join-pw');
        document.getElementById('join-pw-room-id').textContent = id;
      });
    });
  });
}

// ─── Game over UI ─────────────────────────────────────────────────────────────

function showGameOver(winner, stats) {
  const overlay  = document.getElementById('gameover-overlay');
  const title    = document.getElementById('gameover-title');
  const statsEl  = document.getElementById('gameover-stats');
  if (!overlay) return;

  if (winner === 'draw') {
    title.textContent = 'DRAW!';
    title.className   = 'gameover-title';
  } else {
    title.textContent = `TEAM ${TEAM_NAME[winner].toUpperCase()} WINS!`;
    title.className   = `gameover-title team-${winner === 0 ? 'blue' : 'red'}`;
  }

  if (stats && stats.length && statsEl) {
    const sorted = [...stats].sort((a, b) => b.score - a.score);
    statsEl.innerHTML = sorted.slice(0, 6).map(p =>
      `<span class="${p.team === 0 ? 'blue' : 'red'}">${escHtml(p.name)}: ${p.kills} KOs &nbsp; ${p.score}pts</span>`
    ).join('<br>');
  }

  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 12000);
}

// ─── Socket connection & events ───────────────────────────────────────────────

function connectSocket() {
  SB.socket = io({ transports: ['websocket', 'polling'] });

  const socket = SB.socket;

  // ── Connection lifecycle ──

  socket.on('connect', () => {
    console.log('Connected:', socket.id);
    SB.playerId = socket.id;
  });

  socket.on('disconnect', reason => {
    appendChat({ type: 'system', text: '⚠ Disconnected from server. Reconnecting…' });
  });

  // ── Room list updates (pushed by server) ──

  socket.on('room_list_update', ({ rooms }) => {
    const container = document.getElementById('room-list-container');
    if (container && document.getElementById('modal-rooms') &&
        !document.getElementById('modal-rooms').classList.contains('hidden')) {
      // Re-render live if rooms modal is open
      refreshRoomList();
    }
  });

  // ── Lobby events ──

  socket.on('room_joined', ({ playerId, roomState }) => {
    SB.playerId  = playerId;
    SB.roomState = roomState;
    chatMessages = [];
    Game.setSnowPiles(roomState.snowPiles);
    showScreen('screen-lobby');
    renderLobby(roomState);
  });

  socket.on('room_updated', roomState => {
    SB.roomState = roomState;
    renderLobby(roomState);
  });

  socket.on('new_host', ({ id }) => {
    if (SB.roomState) SB.roomState.hostId = id;
    if (SB.roomState) renderLobby(SB.roomState);
  });

  // ── Countdown ──

  socket.on('countdown_start', ({ countdown, gameState }) => {
    Game.setLocalPlayer(SB.playerId);
    Game.setPhase('countdown', countdown);
    Game.applyGameState(gameState);
    document.getElementById('countdown-overlay').classList.remove('hidden');
    document.getElementById('countdown-num').textContent = countdown;
    document.getElementById('gameover-overlay').classList.add('hidden');
    showScreen('screen-game');
    Renderer.init();
    Game.start();
  });

  socket.on('countdown_tick', ({ countdown }) => {
    Game.setPhase('countdown', countdown);
    const el = document.getElementById('countdown-num');
    if (el) {
      el.textContent = countdown;
      el.classList.remove('pop');
      void el.offsetWidth; // reflow for animation restart
      el.classList.add('pop');
    }
  });

  // ── Game state stream ──

  socket.on('game_started', ({ gameState }) => {
    Game.applyGameState(gameState);
    Game.setPhase('playing', 0);
    document.getElementById('countdown-overlay').classList.add('hidden');
    appendChat({ type: 'system', text: '⚔ Battle start!' });
  });

  socket.on('game_state', gameState => {
    Game.applyGameState(gameState);
  });

  // ── Hit / elimination feedback ──

  socket.on('player_hit', ({ id, health }) => {
    const gs = Game.getRoomState().gameState;
    if (gs && gs.players && gs.players[id]) {
      gs.players[id].health = health;
      const p = gs.players[id];
      Game.onHitEffect(p.x, p.y);
    }
  });

  socket.on('fx_hit', ({ x, y }) => { Game.onHitEffect(x, y); });
  socket.on('fx_puff', ({ x, y }) => { Game.onPuffEffect(x, y); });

  socket.on('player_eliminated', ({ id, name, by }) => {
    appendChat({ type: 'system', text: `💀 ${name} was eliminated by ${by}` });
  });

  // ── Game over ──

  socket.on('game_over', ({ winner, stats }) => {
    Game.setPhase('finished');
    showGameOver(winner, stats);
    const w = winner === 'draw' ? 'DRAW' : `TEAM ${TEAM_NAME[winner].toUpperCase()} WINS`;
    appendChat({ type: 'system', text: `🏆 ${w}` });
  });

  socket.on('lobby_reset', ({ roomState }) => {
    SB.roomState = roomState;
    Game.setPhase('lobby');
    Game.stop();
    document.getElementById('gameover-overlay').classList.add('hidden');
    renderLobby(roomState);
    showScreen('screen-lobby');
    appendChat({ type: 'system', text: '↺ Back to lobby' });
  });

  // ── Chat ──

  socket.on('chat_message', msg => {
    appendChat(msg);
  });
}

// ─── DOM wiring ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  connectSocket();

  // ── Menu screen ──

  document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    if (!name) return showError('menu-error', 'Enter your name first');
    SB.playerName = name;
    showModal('modal-create');
  });

  document.getElementById('btn-create-cancel').addEventListener('click', hideModals);

  document.getElementById('btn-create-confirm').addEventListener('click', () => {
    const roomName = document.getElementById('create-room-name').value.trim();
    const password = document.getElementById('create-room-pw').value;
    if (!roomName) return showError('create-error', 'Enter a room name');
    SB.socket.emit('create_room', {
      playerName: SB.playerName,
      roomName,
      password: password || null,
    }, res => {
      if (res.error) return showError('create-error', res.error);
      SB.roomId = res.roomId;
      hideModals();
    });
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    if (!name) return showError('menu-error', 'Enter your name first');
    SB.playerName = name;
    showModal('modal-rooms');
    refreshRoomList();
  });

  document.getElementById('btn-rooms-cancel').addEventListener('click', hideModals);
  document.getElementById('btn-refresh-rooms').addEventListener('click', refreshRoomList);

  // Join by code form
  document.getElementById('btn-join-code').addEventListener('click', () => {
    const code = document.getElementById('join-room-id').value.trim().toUpperCase();
    if (!code) return showError('rooms-error', 'Enter a room code');
    document.getElementById('join-pw-room-id').textContent = code;
    showModal('modal-join-pw');
  });

  document.getElementById('btn-join-pw-cancel').addEventListener('click', () => showModal('modal-rooms'));

  document.getElementById('btn-join-pw-confirm').addEventListener('click', () => {
    const roomId   = document.getElementById('join-room-id').value.trim().toUpperCase();
    const password = document.getElementById('join-room-pw').value;
    SB.socket.emit('join_room', {
      playerName: SB.playerName,
      roomId,
      password: password || null,
    }, res => {
      if (res.error) return showError('join-pw-error', res.error);
      SB.roomId = res.roomId;
      hideModals();
    });
  });

  // ── Lobby screen ──

  document.getElementById('btn-leave').addEventListener('click', () => {
    SB.socket.emit('leave_room');
    Game.stop();
    showScreen('screen-menu');
    chatMessages = [];
  });

  document.getElementById('btn-change-team').addEventListener('click', () => {
    SB.socket.emit('change_team');
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    SB.socket.emit('start_game', res => {
      if (res && res.error) showError('lobby-error', res.error);
    });
  });

  // ── Chat send (shared input box) ──

  document.getElementById('btn-chat-send').addEventListener('click', sendChat);

  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });

  // ── Game screen: Enter to focus/unfocus chat ──

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const ci = document.getElementById('chat-input');
      if (ci) ci.blur();
    }
    if (e.key === 'Enter') {
      const active = document.activeElement;
      const ci = document.getElementById('chat-input');
      if (!ci) return;
      if (active === ci) {
        sendChat();
        ci.blur();
      } else if (document.getElementById('screen-game').classList.contains('active')) {
        ci.focus();
        e.preventDefault();
      }
    }
  });

  // ── Menu snow animation ──
  const snowCanvas = document.getElementById('snow-canvas');
  if (snowCanvas) {
    const sCtx = snowCanvas.getContext('2d');
    snowCanvas.width  = snowCanvas.offsetWidth  || window.innerWidth;
    snowCanvas.height = snowCanvas.offsetHeight || window.innerHeight;
    initMenuSnow(snowCanvas.width, snowCanvas.height);

    let last = performance.now();
    function snowLoop(now) {
      const dt = (now - last) / 1000;
      last = now;
      updateAndDrawMenuSnow(sCtx, snowCanvas.width, snowCanvas.height, dt);
      if (document.getElementById('screen-menu').classList.contains('active')) {
        requestAnimationFrame(snowLoop);
      }
    }
    requestAnimationFrame(snowLoop);

    // Restart snow loop when menu becomes active
    const observer = new MutationObserver(() => {
      if (document.getElementById('screen-menu').classList.contains('active')) {
        last = performance.now();
        requestAnimationFrame(snowLoop);
      }
    });
    observer.observe(document.getElementById('screen-menu'), { attributes: true });
  }

  // ── Allow Enter to submit forms ──
  ['create-room-name', 'create-room-pw'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-create-confirm').click();
    });
  });
  document.getElementById('input-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });
  document.getElementById('join-room-id')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
});

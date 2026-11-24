const socket = io();

// Persistent Session ID for 30-second mobile reconnection grace period
let sessionId = sessionStorage.getItem('rmcs_session_id');
if (!sessionId) {
  sessionId = 'sess_' + Math.random().toString(36).substring(2, 12);
  sessionStorage.setItem('rmcs_session_id', sessionId);
}

let currentRoomCode = sessionStorage.getItem('rmcs_room_code') || null;
let roomState = null;
let myPrivateRole = null;
let selectedRounds = 5;
let manualScoreboardView = false;

// Role Visual Metadata
const ROLE_META = {
  Raja: { icon: '👑', color: 'text-yellow-600', bg: 'bg-yellow-100' },
  Mantri: { icon: '📜', color: 'text-purple-700', bg: 'bg-purple-100' },
  Sipahi: { icon: '🗡️', color: 'text-blue-700', bg: 'bg-blue-100' },
  Chor: { icon: '🥷', color: 'text-red-700', bg: 'bg-red-100' }
};

// Web Audio API Synthesizer (Zero external MP3 dependencies)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSoundEffect(type) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  if (type === 'toss') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.18);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'pick') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } else if (type === 'trumpet') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(392, now);
    osc.frequency.setValueAtTime(523.25, now + 0.15);
    osc.frequency.setValueAtTime(659.25, now + 0.3);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.65);
    osc.start(now);
    osc.stop(now + 0.65);
  } else if (type === 'win' || type === 'fanfare') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.12);
    osc.frequency.setValueAtTime(783.99, now + 0.24);
    osc.frequency.setValueAtTime(1046.5, now + 0.36);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
    osc.start(now);
    osc.stop(now + 0.7);
  } else if (type === 'caught') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(140, now + 0.45);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
    osc.start(now);
    osc.stop(now + 0.45);
  }
}

// DOM References
const screens = {
  landing: document.getElementById('screen-landing'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  roundEnd: document.getElementById('screen-round-end'),
  gameOver: document.getElementById('screen-game-over')
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function showToast(msg, isError = true) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-full shadow-2xl font-semibold text-sm text-center max-w-[90vw] ${
    isError ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
  }`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3200);
}

// Auto-fill Room Code from URL query (?room=ABCD)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('room')) {
  document.getElementById('input-code').value = urlParams.get('room').toUpperCase();
}

// Attempt session reconnection on load
socket.on('connect', () => {
  if (currentRoomCode && sessionId) {
    socket.emit('reconnect_session', { roomCode: currentRoomCode, sessionId });
  }
});

socket.on('session_expired', () => {
  sessionStorage.removeItem('rmcs_room_code');
  currentRoomCode = null;
  showScreen('landing');
});

socket.on('error_msg', (msg) => showToast(msg, true));
socket.on('play_sound', (type) => playSoundEffect(type));

socket.on('joined_room', ({ roomCode }) => {
  currentRoomCode = roomCode;
  sessionStorage.setItem('rmcs_room_code', roomCode);
});

socket.on('private_role', (role) => {
  myPrivateRole = role;
  renderGameScreen();
});

socket.on('raja_announcement', ({ rajaName }) => {
  const banner = document.getElementById('raja-banner');
  document.getElementById('raja-banner-title').textContent = `${rajaName} is the Raja!`;
  banner.classList.remove('hidden');
  setTimeout(() => {
    banner.classList.add('hidden');
  }, 2600);
});

socket.on('player_reaction', ({ name, emoji }) => {
  const layer = document.getElementById('reaction-layer');
  const el = document.createElement('div');
  el.className = 'floating-emoji flex flex-col items-center';
  el.style.left = `${15 + Math.random() * 65}%`;
  el.innerHTML = `<span>${emoji}</span><span class="text-xs font-bold bg-black/70 text-white px-2 py-0.5 rounded-full">${name}</span>`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2000);
});

socket.on('room_terminated', ({ reason }) => {
  sessionStorage.removeItem('rmcs_room_code');
  currentRoomCode = null;
  roomState = null;
  myPrivateRole = null;
  showToast(reason, true);
  showScreen('landing');
});

socket.on('room_state', (state) => {
  const prevPhase = roomState ? roomState.phase : null;
  roomState = state;

  if (state.phase === 'CHIT_PICK' && prevPhase !== 'CHIT_PICK') {
    myPrivateRole = null;
    manualScoreboardView = false;
    triggerTossAnimation();
  }

  if (state.phase === 'LOBBY') {
    renderLobby();
    showScreen('lobby');
  } else if (['CHIT_PICK', 'RAJA_CALL', 'MANTRI_GUESS'].includes(state.phase)) {
    if (manualScoreboardView) {
      renderScoreboard(true);
      showScreen('roundEnd');
    } else {
      renderGameScreen();
      showScreen('game');
    }
  } else if (state.phase === 'ROUND_END') {
    manualScoreboardView = false;
    renderRoundEnd();
    showScreen('roundEnd');
  } else if (state.phase === 'GAME_OVER') {
    renderGameOver();
    showScreen('gameOver');
  }
});

// Landing Screen Events
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) return showToast('Please enter your nickname first!');
  socket.emit('create_room', { playerName: name, sessionId });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!name) return showToast('Please enter your nickname first!');
  if (code.length !== 4) return showToast('Enter a valid 4-letter room code!');
  socket.emit('join_room', { roomCode: code, playerName: name, sessionId });
});

// Lobby Events
document.getElementById('btn-copy-invite').addEventListener('click', () => {
  const inviteUrl = `${window.location.origin}/?room=${roomState.code}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    const label = document.getElementById('copy-btn-text');
    label.textContent = 'Invite Link Copied!';
    showToast('Invite link copied! Share on WhatsApp.', false);
    setTimeout(() => (label.textContent = 'Copy Invite Link'), 2500);
  });
});

document.querySelectorAll('.round-opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedRounds = Number(btn.dataset.rounds);
    document.querySelectorAll('.round-opt').forEach((b) => {
      b.className = 'round-opt py-2.5 rounded-xl font-extrabold bg-amber-950 text-amber-200 border-2 border-amber-700';
    });
    btn.className = 'round-opt py-2.5 rounded-xl font-extrabold bg-amber-500 text-amber-950 border-2 border-yellow-200';
  });
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('start_game', { totalRounds: selectedRounds });
});

function renderLobby() {
  document.getElementById('lobby-code').textContent = roomState.code;
  document.getElementById('player-count').textContent = roomState.players.length;

  const list = document.getElementById('lobby-players');
  list.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const p = roomState.players[i];
    if (p) {
      list.innerHTML += `
        <div class="flex items-center justify-between bg-amber-900/90 border border-amber-600 px-4 py-3 rounded-2xl shadow">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-amber-500 text-amber-950 font-black flex items-center justify-center">
              ${p.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <span class="font-bold text-white">${p.name}</span>
              ${p.sessionId === sessionId ? '<span class="ml-1.5 text-xs bg-amber-700 px-2 py-0.5 rounded-full text-amber-200">You</span>' : ''}
            </div>
          </div>
          <span class="text-xs font-bold uppercase ${p.isHost ? 'text-yellow-300' : 'text-emerald-400'}">
            ${p.isHost ? '👑 Host' : '● Ready'}
          </span>
        </div>
      `;
    } else {
      list.innerHTML += `
        <div class="flex items-center justify-between bg-amber-950/50 border border-dashed border-amber-700/60 px-4 py-3 rounded-2xl text-amber-500/70">
          <span>Empty Seat ${i + 1}</span>
          <span class="text-xs">Waiting...</span>
        </div>
      `;
    }
  }

  const me = roomState.players.find((p) => p.sessionId === sessionId);
  const hostControls = document.getElementById('host-controls');
  const guestMsg = document.getElementById('guest-waiting-msg');
  const startBtn = document.getElementById('btn-start-game');

  if (me && me.isHost) {
    hostControls.classList.remove('hidden');
    guestMsg.classList.add('hidden');
    if (roomState.players.length === 4) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start Match 🚀';
    } else {
      startBtn.disabled = true;
      startBtn.textContent = `Need ${4 - roomState.players.length} More Player(s)`;
    }
  } else {
    hostControls.classList.add('hidden');
    guestMsg.classList.remove('hidden');
  }
}

// ==========================================
// 2D HTML5 CANVAS TABLETOP & CHIT ANIMATION
// ==========================================
const canvas = document.getElementById('table-canvas');
const ctx = canvas.getContext('2d');
let tossProgress = 1;
let chitRegions = [];

function triggerTossAnimation() {
  tossProgress = 0;
  const step = () => {
    tossProgress = Math.min(1, tossProgress + 0.06);
    drawTableCanvas();
    if (tossProgress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function drawTableCanvas() {
  if (!roomState || !canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const w = rect.width;
  const h = rect.height;

  // Draw Wooden Tabletop Grain & Border
  const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.8);
  grad.addColorStop(0, '#7c3f1d');
  grad.addColorStop(1, '#3e1c0a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle decorative center circle on table
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.32, 0, Math.PI * 2);
  ctx.stroke();

  // Easing for scatter toss
  const ease = 1 - Math.pow(1 - tossProgress, 3);
  chitRegions = [];

  roomState.chits.forEach((chit) => {
    const targetX = chit.x * w;
    const targetY = chit.y * (h - 70) + 25;
    const curX = w / 2 + (targetX - w / 2) * ease;
    const curY = h / 2 + (targetY - h / 2) * ease;
    const curAngle = chit.angle * ease + (1 - ease) * Math.PI * 2;

    const chitW = 76;
    const chitH = 48;

    chitRegions.push({
      index: chit.index,
      x: curX - chitW / 2,
      y: curY - chitH / 2,
      w: chitW,
      h: chitH,
      claimedBy: chit.claimedBy
    });

    ctx.save();
    ctx.translate(curX, curY);
    ctx.rotate(curAngle);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-chitW / 2 + 4, -chitH / 2 + 6, chitW, chitH);

    // Folded Paper Chit Body
    const claimer = roomState.players.find((p) => p.sessionId === chit.claimedBy);
    ctx.fillStyle = claimer ? '#d6d3d1' : '#fef3c7';
    ctx.strokeStyle = claimer ? '#78716c' : '#d97706';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-chitW / 2, -chitH / 2, chitW, chitH, 6);
    ctx.fill();
    ctx.stroke();

    // Paper Fold Crease Lines
    ctx.strokeStyle = 'rgba(180, 83, 9, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-chitW / 2, 0);
    ctx.lineTo(chitW / 2, 0);
    ctx.moveTo(0, -chitH / 2);
    ctx.lineTo(0, chitH / 2);
    ctx.stroke();

    // Label on Chit
    ctx.fillStyle = claimer ? '#44403c' : '#92400e';
    ctx.font = 'bold 12px Poppins, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (claimer) {
      ctx.fillText(claimer.name.slice(0, 9), 0, 0);
    } else {
      ctx.fillText('TAP CHIT', 0, 0);
    }

    ctx.restore();
  });
}

canvas.addEventListener('click', (e) => {
  if (!roomState || roomState.phase !== 'CHIT_PICK') return;
  const me = roomState.players.find((p) => p.sessionId === sessionId);
  if (!me || me.claimedChitIndex !== null) return;

  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  for (const region of chitRegions) {
    if (
      !region.claimedBy &&
      clickX >= region.x &&
      clickX <= region.x + region.w &&
      clickY >= region.y &&
      clickY <= region.y + region.h
    ) {
      socket.emit('pick_chit', { chitIndex: region.index });
      break;
    }
  }
});

window.addEventListener('resize', () => {
  if (roomState && ['CHIT_PICK', 'RAJA_CALL', 'MANTRI_GUESS'].includes(roomState.phase)) {
    drawTableCanvas();
  }
});

function renderGameScreen() {
  if (!roomState) return;
  document.getElementById('game-round-indicator').textContent = `${roomState.currentRound} / ${roomState.totalRounds}`;

  const phaseLabels = {
    CHIT_PICK: '1. Pick a Chit',
    RAJA_CALL: '2. Raja Calls',
    MANTRI_GUESS: '3. Find the Chor'
  };
  document.getElementById('phase-badge').textContent = phaseLabels[roomState.phase] || '';

  // Render Top 4 Players Bar
  const playersBar = document.getElementById('game-players-bar');
  playersBar.innerHTML = roomState.players
    .map((p) => {
      const roleBadge = p.role
        ? `<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-yellow-400 text-amber-950">${ROLE_META[p.role.name].icon} ${p.role.name}</span>`
        : `<span class="text-[10px] text-amber-300/80">${p.claimedChitIndex !== null ? 'Chit Picked' : 'Picking...'}</span>`;

      return `
        <div class="bg-amber-900/80 border ${p.connected ? 'border-amber-700' : 'border-red-500'} rounded-xl p-1.5 text-center flex flex-col items-center justify-between">
          <div class="text-xs font-bold truncate w-full text-white">${p.name}</div>
          ${roleBadge}
          <div class="text-[11px] font-extrabold text-amber-300 mt-0.5">${p.totalScore} pts</div>
        </div>
      `;
    })
    .join('');

  // Private Chit Card Display
  const chitCard = document.getElementById('my-chit-card');
  if (myPrivateRole) {
    chitCard.classList.remove('hidden');
    document.getElementById('my-role-icon').textContent = ROLE_META[myPrivateRole.name].icon;
    document.getElementById('my-role-title').textContent = `${myPrivateRole.name} (${myPrivateRole.hindi})`;
    document.getElementById('my-role-pts').textContent = `${myPrivateRole.points} pts`;
  } else {
    chitCard.classList.add('hidden');
  }

  // Render Bottom Phase Action Panel
  const actionPanel = document.getElementById('action-panel');
  const me = roomState.players.find((p) => p.sessionId === sessionId);

  if (roomState.phase === 'CHIT_PICK') {
    if (me.claimedChitIndex === null) {
      actionPanel.innerHTML = `
        <div class="text-center space-y-1">
          <p class="text-lg font-extrabold text-yellow-300">Tap any folded chit on the table!</p>
          <p class="text-xs text-amber-200/80">Your role will remain hidden from other players.</p>
        </div>
      `;
    } else {
      const remaining = roomState.players.filter((p) => p.claimedChitIndex === null).length;
      actionPanel.innerHTML = `
        <div class="text-center space-y-1">
          <p class="text-base font-bold text-emerald-300">Chit claimed! Keep a straight face 🤫</p>
          <p class="text-xs text-amber-200">Waiting for ${remaining} more player(s) to pick...</p>
        </div>
      `;
    }
  } else if (roomState.phase === 'RAJA_CALL') {
    if (myPrivateRole && myPrivateRole.name === 'Raja') {
      actionPanel.innerHTML = `
        <div class="text-center space-y-2">
          <p class="text-xs uppercase font-bold text-yellow-300">You are the Raja! Command your court:</p>
          <button onclick="socket.emit('raja_call')" class="w-full py-4 rounded-2xl bg-gradient-to-r from-yellow-400 to-amber-500 text-amber-950 font-black text-xl shadow-xl active:scale-95 transition animate-pulse">
            👑 "Mera Mantri Kaun?"
          </button>
        </div>
      `;
    } else {
      actionPanel.innerHTML = `
        <div class="text-center space-y-1">
          <div class="text-2xl">👑</div>
          <p class="text-base font-bold text-amber-200">All chits picked!</p>
          <p class="text-xs text-amber-300/80">Waiting for the Raja to call out <b>"Mera Mantri Kaun?"</b></p>
        </div>
      `;
    }
  } else if (roomState.phase === 'MANTRI_GUESS') {
    if (myPrivateRole && myPrivateRole.name === 'Mantri') {
      const suspects = roomState.players.filter(
        (p) => !p.role || (p.role.name !== 'Raja' && p.role.name !== 'Mantri')
      );
      actionPanel.innerHTML = `
        <div class="space-y-2 text-center">
          <p class="text-sm font-extrabold text-yellow-300">📜 "Chor ka pata lagao!" (Tap the Chor)</p>
          <div class="grid grid-cols-2 gap-2.5">
            ${suspects
              .map(
                (s) => `
              <button onclick="socket.emit('mantri_guess', { suspectSessionId: '${s.sessionId}' })"
                class="py-3.5 px-3 rounded-2xl bg-red-600 hover:bg-red-500 border-2 border-red-300 text-white font-extrabold text-base shadow-lg active:scale-95 transition">
                🥷 ${s.name}
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    } else {
      actionPanel.innerHTML = `
        <div class="text-center space-y-2">
          <p class="text-sm font-bold text-amber-200">Mantri is deciding who the Chor is...</p>
          <p class="text-xs text-amber-400">Tap an emoji to bluff or distract!</p>
          <div class="flex justify-center gap-3 pt-1">
            ${['😂', '👀', '🤫', '😱']
              .map(
                (emoji) => `
              <button onclick="socket.emit('send_reaction', { emoji: '${emoji}' })"
                class="w-12 h-12 rounded-2xl bg-amber-800 border border-amber-600 text-2xl active:scale-90 transition shadow">
                ${emoji}
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }
  }

  requestAnimationFrame(drawTableCanvas);
}

// ==========================================
// ROUND END & NOTEBOOK TALLY SCOREBOARD
// ==========================================
document.getElementById('btn-toggle-scoreboard').addEventListener('click', () => {
  manualScoreboardView = true;
  renderScoreboard(true);
  showScreen('roundEnd');
});

function renderScoreboard(isMidRoundPreview = false) {
  const banner = document.getElementById('round-outcome-banner');
  const nextBtn = document.getElementById('btn-next-round');
  const waitText = document.getElementById('waiting-next-round');

  if (isMidRoundPreview) {
    banner.className = 'p-3 rounded-2xl text-center border border-amber-600 bg-amber-900/90 flex items-center justify-between';
    banner.innerHTML = `
      <span class="font-bold text-amber-200 text-sm">Live Score</span>
      <button id="btn-back-to-game" class="bg-amber-500 text-amber-950 font-extrabold px-4 py-1.5 rounded-xl text-xs">
        Back to Game ↩️
      </button>
    `;
    document.getElementById('btn-back-to-game').addEventListener('click', () => {
      manualScoreboardView = false;
      renderGameScreen();
      showScreen('game');
    });
    nextBtn.classList.add('hidden');
    waitText.classList.add('hidden');
  } else if (roomState.lastRoundResult) {
    const res = roomState.lastRoundResult;
    if (res.isCorrect) {
      banner.className = 'p-4 rounded-3xl text-center border-2 border-emerald-400 bg-emerald-900/90 shadow-lg';
      banner.innerHTML = `
        <div class="text-2xl mb-1">🎯 Mantri Caught the Chor!</div>
        <p class="text-sm text-emerald-100"><b>${res.mantriName}</b> rightly identified <b>${res.actualChorName}</b> (+800 pts)!</p>
      `;
    } else {
      banner.className = 'p-4 rounded-3xl text-center border-2 border-red-400 bg-red-900/90 shadow-lg';
      banner.innerHTML = `
        <div class="text-2xl mb-1">🥷 Chor Escaped & Stole 800 Pts!</div>
        <p class="text-sm text-red-100"><b>${res.mantriName}</b> guessed <b>${res.suspectName}</b>, but <b>${res.actualChorName}</b> was the Chor!</p>
      `;
    }

    const me = roomState.players.find((p) => p.sessionId === sessionId);
    if (me && me.isHost) {
      nextBtn.classList.remove('hidden');
      waitText.classList.add('hidden');
      nextBtn.textContent =
        roomState.currentRound >= roomState.totalRounds ? 'See Final Podium 🏆' : 'Start Next Round ➡️';
    } else {
      nextBtn.classList.add('hidden');
      waitText.classList.remove('hidden');
    }
  }

  document.getElementById('notebook-round-label').textContent = `Round ${roomState.currentRound} of ${roomState.totalRounds}`;

  // Build Notebook Table
  const header = document.getElementById('tally-header');
  const body = document.getElementById('tally-body');
  const footer = document.getElementById('tally-footer');

  header.innerHTML = `<th class="py-1 text-left pl-1">Rnd</th>` +
    roomState.players.map((p) => `<th class="py-1 truncate max-w-[72px]">${p.name}</th>`).join('');

  const completedRounds = roomState.players[0].roundScores.length;
  let rowsHtml = '';
  for (let r = 0; r < completedRounds; r++) {
    rowsHtml += `<tr>
      <td class="text-left pl-1 font-bold text-stone-500">#${r + 1}</td>
      ${roomState.players
        .map((p) => {
          const pts = p.roundScores[r];
          const color = pts === 1000 ? 'text-amber-700 font-bold' : pts === 800 ? 'text-purple-700 font-bold' : pts === 0 ? 'text-red-600' : 'text-stone-800';
          return `<td class="${color}">${pts}</td>`;
        })
        .join('')}
    </tr>`;
  }

  // Show current round role reveal row at bottom of round end
  if (!isMidRoundPreview && roomState.phase === 'ROUND_END') {
    rowsHtml += `<tr class="bg-amber-100/80 text-base">
      <td class="text-left pl-1 text-xs font-sans font-bold text-amber-900">Role</td>
      ${roomState.players
        .map((p) => `<td class="font-sans text-xs font-bold text-stone-800">${p.role ? ROLE_META[p.role.name].icon + p.role.name : '-'}</td>`)
        .join('')}
    </tr>`;
  }

  body.innerHTML = rowsHtml || `<tr><td colspan="5" class="text-stone-400 py-4">No rounds completed yet</td></tr>`;

  footer.innerHTML = `<td class="text-left pl-1">Total</td>` +
    roomState.players.map((p) => `<td>${p.totalScore}</td>`).join('');
}

function renderRoundEnd() {
  renderScoreboard(false);
}

document.getElementById('btn-next-round').addEventListener('click', () => {
  socket.emit('next_round');
});

// ==========================================
// GAME OVER PODIUM & CONFETTI
// ==========================================
function renderGameOver() {
  const sorted = [...roomState.players].sort((a, b) => b.totalScore - a.totalScore);
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];

  document.getElementById('podium-list').innerHTML = sorted
    .map(
      (p, idx) => `
      <div class="flex items-center justify-between px-5 py-4 rounded-2xl border-2 shadow-lg ${
        idx === 0
          ? 'bg-gradient-to-r from-yellow-500 to-amber-500 border-yellow-200 text-amber-950 scale-105'
          : 'bg-amber-900/90 border-amber-700 text-white'
      }">
        <div class="flex items-center gap-3">
          <span class="text-3xl">${medals[idx]}</span>
          <div class="text-left">
            <div class="font-black text-lg">${p.name}</div>
            <div class="text-xs font-bold opacity-80">${idx === 0 ? 'Grand Samrat' : `Rank #${idx + 1}`}</div>
          </div>
        </div>
        <div class="text-2xl font-black">${p.totalScore} <span class="text-xs font-bold">pts</span></div>
      </div>
    `
    )
    .join('');

  const me = roomState.players.find((p) => p.sessionId === sessionId);
  if (me && me.isHost) {
    document.getElementById('btn-play-again').classList.remove('hidden');
    document.getElementById('waiting-play-again').classList.add('hidden');
  } else {
    document.getElementById('btn-play-again').classList.add('hidden');
    document.getElementById('waiting-play-again').classList.remove('hidden');
  }

  startConfetti();
}

document.getElementById('btn-play-again').addEventListener('click', () => {
  socket.emit('play_again');
});

function startConfetti() {
  const cCanvas = document.getElementById('confetti-canvas');
  const cCtx = cCanvas.getContext('2d');
  cCanvas.width = window.innerWidth;
  cCanvas.height = window.innerHeight;

  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * cCanvas.width,
    y: Math.random() * cCanvas.height - cCanvas.height,
    size: 6 + Math.random() * 6,
    color: ['#fbbf24', '#ef4444', '#10b981', '#3b82f6', '#f472b6'][Math.floor(Math.random() * 5)],
    speed: 2 + Math.random() * 4,
    angle: Math.random() * 6.28
  }));

  let frames = 0;
  function animateConfetti() {
    if (!roomState || roomState.phase !== 'GAME_OVER' || frames > 300) {
      cCtx.clearRect(0, 0, cCanvas.width, cCanvas.height);
      return;
    }
    frames++;
    cCtx.clearRect(0, 0, cCanvas.width, cCanvas.height);
    pieces.forEach((p) => {
      p.y += p.speed;
      p.x += Math.sin(p.angle) * 1.5;
      p.angle += 0.05;
      if (p.y > cCanvas.height) p.y = -10;
      cCtx.fillStyle = p.color;
      cCtx.fillRect(p.x, p.y, p.size, p.size * 0.6);
    });
    requestAnimationFrame(animateConfetti);
  }
  animateConfetti();
}
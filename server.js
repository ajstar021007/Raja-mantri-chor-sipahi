const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for active rooms
const rooms = new Map();

const ROLES = [
  { name: 'Raja', points: 1000, hindi: 'राजा' },
  { name: 'Mantri', points: 800, hindi: 'मंत्री' },
  { name: 'Sipahi', points: 500, hindi: 'सिपाही' },
  { name: 'Chor', points: 0, hindi: 'चोर' }
];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Sanitize room state so NO secret roles leak before ROUND_END
function getPublicRoomState(room) {
  const playersPublic = room.players.map((p) => {
    let visibleRole = null;
    if (room.phase === 'ROUND_END' || room.phase === 'GAME_OVER') {
      visibleRole = p.role;
    } else if (room.phase === 'MANTRI_GUESS') {
      // Raja and Mantri are publicly known during Mantri's guess phase
      if (p.role && (p.role.name === 'Raja' || p.role.name === 'Mantri')) {
        visibleRole = p.role;
      }
    }

    return {
      sessionId: p.sessionId,
      name: p.name,
      isHost: p.isHost,
      connected: p.connected,
      claimedChitIndex: p.claimedChitIndex,
      role: visibleRole,
      totalScore: p.totalScore,
      roundScores: p.roundScores
    };
  });

  return {
    code: room.code,
    phase: room.phase,
    totalRounds: room.totalRounds,
    currentRound: room.currentRound,
    players: playersPublic,
    chits: room.chits.map((c, idx) => ({
      index: idx,
      claimedBy: c.claimedBy,
      x: c.x,
      y: c.y,
      angle: c.angle
    })),
    lastRoundResult: room.lastRoundResult
  };
}

function broadcastRoomState(room) {
  io.to(room.code).emit('room_state', getPublicRoomState(room));
  // Send private role individually to each player's specific socket
  room.players.forEach((p) => {
    if (p.socketId && p.claimedChitIndex !== null && p.role) {
      io.to(p.socketId).emit('private_role', p.role);
    }
  });
}

function startNewRound(room) {
  room.currentRound += 1;
  room.phase = 'CHIT_PICK';
  room.lastRoundResult = null;

  const shuffledRoles = shuffleArray(ROLES);
  // Pre-calculate scattered tabletop coordinates (normalized 0.2 to 0.8)
  const positions = [
    { x: 0.32, y: 0.35, angle: -0.25 },
    { x: 0.68, y: 0.33, angle: 0.3 },
    { x: 0.34, y: 0.66, angle: 0.18 },
    { x: 0.67, y: 0.68, angle: -0.22 }
  ];
  const shuffledPositions = shuffleArray(positions);

  room.chits = shuffledRoles.map((role, idx) => ({
    index: idx,
    role: role,
    claimedBy: null,
    x: shuffledPositions[idx].x,
    y: shuffledPositions[idx].y,
    angle: shuffledPositions[idx].angle
  }));

  room.players.forEach((p) => {
    p.claimedChitIndex = null;
    p.role = null;
  });

  broadcastRoomState(room);
  io.to(room.code).emit('play_sound', 'toss');
}

io.on('connection', (socket) => {
  // Handle Reconnection Attempt
  socket.on('reconnect_session', ({ roomCode, sessionId }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      return socket.emit('session_expired');
    }

    const player = room.players.find((p) => p.sessionId === sessionId);
    if (!player) {
      return socket.emit('session_expired');
    }

    // Clear grace period termination timer if active
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }

    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.sessionId = sessionId;

    socket.emit('joined_room', { roomCode: room.code, sessionId });
    broadcastRoomState(room);
  });

  // Create a new 4-player room
  socket.on('create_room', ({ playerName, sessionId }) => {
    const cleanName = (playerName || 'Player 1').trim().slice(0, 14);
    const code = generateRoomCode();

    const room = {
      code,
      phase: 'LOBBY',
      totalRounds: 5,
      currentRound: 0,
      players: [
        {
          sessionId,
          socketId: socket.id,
          name: cleanName,
          isHost: true,
          connected: true,
          disconnectTimer: null,
          claimedChitIndex: null,
          role: null,
          totalScore: 0,
          roundScores: []
        }
      ],
      chits: [],
      lastRoundResult: null
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.sessionId = sessionId;

    socket.emit('joined_room', { roomCode: code, sessionId });
    broadcastRoomState(room);
  });

  // Join existing room
  socket.on('join_room', ({ roomCode, playerName, sessionId }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const cleanName = (playerName || 'Player').trim().slice(0, 14);
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('error_msg', 'Room not found. Check the 4-letter code.');
    }

    // Check if same session rejoining
    const existing = room.players.find((p) => p.sessionId === sessionId);
    if (existing) {
      if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
      existing.socketId = socket.id;
      existing.connected = true;
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.sessionId = sessionId;
      socket.emit('joined_room', { roomCode: code, sessionId });
      return broadcastRoomState(room);
    }

    if (room.phase !== 'LOBBY') {
      return socket.emit('error_msg', 'Game is already in progress.');
    }
    if (room.players.length >= 4) {
      return socket.emit('error_msg', 'Room is full (4/4 players).');
    }

    room.players.push({
      sessionId,
      socketId: socket.id,
      name: cleanName,
      isHost: false,
      connected: true,
      disconnectTimer: null,
      claimedChitIndex: null,
      role: null,
      totalScore: 0,
      roundScores: []
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.sessionId = sessionId;

    socket.emit('joined_room', { roomCode: code, sessionId });
    broadcastRoomState(room);
  });

  // Host starts game
  socket.on('start_game', ({ totalRounds }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.sessionId === socket.data.sessionId);
    if (!player || !player.isHost) return;
    if (room.players.length !== 4) {
      return socket.emit('error_msg', 'Need exactly 4 players to start!');
    }

    const allowedRounds = [5, 10, 15];
    room.totalRounds = allowedRounds.includes(Number(totalRounds)) ? Number(totalRounds) : 5;
    room.currentRound = 0;
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScores = [];
    });

    startNewRound(room);
  });

  // Player taps a folded chit
  socket.on('pick_chit', ({ chitIndex }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'CHIT_PICK') return;

    const player = room.players.find((p) => p.sessionId === socket.data.sessionId);
    if (!player || player.claimedChitIndex !== null) return;

    const chit = room.chits[chitIndex];
    if (!chit || chit.claimedBy !== null) return;

    chit.claimedBy = player.sessionId;
    player.claimedChitIndex = chitIndex;
    player.role = chit.role;

    socket.emit('play_sound', 'pick');

    // Check if all 4 players have picked a chit
    const allPicked = room.players.every((p) => p.claimedChitIndex !== null);
    if (allPicked) {
      room.phase = 'RAJA_CALL';
    }

    broadcastRoomState(room);
  });

  // Raja taps "Mera Mantri Kaun?"
  socket.on('raja_call', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'RAJA_CALL') return;

    const player = room.players.find((p) => p.sessionId === socket.data.sessionId);
    if (!player || !player.role || player.role.name !== 'Raja') return;

    room.phase = 'MANTRI_GUESS';
    io.to(room.code).emit('raja_announcement', { rajaName: player.name });
    io.to(room.code).emit('play_sound', 'trumpet');
    broadcastRoomState(room);
  });

  // Mantri guesses who the Chor is
  socket.on('mantri_guess', ({ suspectSessionId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'MANTRI_GUESS') return;

    const mantri = room.players.find((p) => p.sessionId === socket.data.sessionId);
    if (!mantri || !mantri.role || mantri.role.name !== 'Mantri') return;

    const suspect = room.players.find((p) => p.sessionId === suspectSessionId);
    if (!suspect || suspect.role.name === 'Raja' || suspect.role.name === 'Mantri') return;

    const isCorrect = suspect.role.name === 'Chor';

    // Calculate round scores
    room.players.forEach((p) => {
      let earned = 0;
      if (p.role.name === 'Raja') earned = 1000;
      else if (p.role.name === 'Sipahi') earned = 500;
      else if (p.role.name === 'Mantri') earned = isCorrect ? 800 : 0;
      else if (p.role.name === 'Chor') earned = isCorrect ? 0 : 800;

      p.roundScores.push(earned);
      p.totalScore += earned;
    });

    const chorPlayer = room.players.find((p) => p.role.name === 'Chor');
    room.lastRoundResult = {
      isCorrect,
      mantriName: mantri.name,
      suspectName: suspect.name,
      actualChorName: chorPlayer.name
    };

    room.phase = 'ROUND_END';
    io.to(room.code).emit('play_sound', isCorrect ? 'win' : 'caught');
    broadcastRoomState(room);
  });

  // Quick preset bluff emojis during Mantri's guess
  socket.on('send_reaction', ({ emoji }) => {
    const allowed = ['😂', '👀', '🤫', '😱'];
    if (!allowed.includes(emoji)) return;
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.sessionId === socket.data.sessionId);
    if (!player) return;

    io.to(room.code).emit('player_reaction', {
      sessionId: player.sessionId,
      name: player.name,
      emoji
    });
  });

  // Proceed to next round or Game Over
  socket.on('next_round', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'ROUND_END') return;
    const player = room.players.find((p) => p.sessionId === socket.data.sessionId);
    if (!player || !player.isHost) return;

    if (room.currentRound >= room.totalRounds) {
      room.phase = 'GAME_OVER';
      io.to(room.code).emit('play_sound', 'fanfare');
      broadcastRoomState(room);
    } else {
      startNewRound(room);
    }
  });

  // Play again with same 4 players
  socket.on('play_again', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'GAME_OVER') return;
    const player = room.players.find((p) => p.sessionId === socket.data.sessionId);
    if (!player || !player.isHost) return;

    room.phase = 'LOBBY';
    room.currentRound = 0;
    room.lastRoundResult = null;
    room.players.forEach((p) => {
      p.totalScore = 0;
      p.roundScores = [];
      p.claimedChitIndex = null;
      p.role = null;
    });
    broadcastRoomState(room);
  });

  // 30-second disconnect grace period
  socket.on('disconnect', () => {
    const { roomCode, sessionId } = socket.data;
    if (!roomCode || !sessionId) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find((p) => p.sessionId === sessionId);
    if (!player) return;

    player.connected = false;
    broadcastRoomState(room);

    player.disconnectTimer = setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) return;

      if (currentRoom.phase === 'LOBBY') {
        currentRoom.players = currentRoom.players.filter((p) => p.sessionId !== sessionId);
        if (currentRoom.players.length === 0) {
          rooms.delete(roomCode);
        } else {
          if (!currentRoom.players.some((p) => p.isHost)) {
            currentRoom.players[0].isHost = true;
          }
          broadcastRoomState(currentRoom);
        }
      } else {
        // Active match: terminate room after 30s timeout
        io.to(roomCode).emit('room_terminated', {
          reason: `${player.name} disconnected for over 30 seconds.`
        });
        rooms.delete(roomCode);
      }
    }, 30000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const MOVE_STEP = 20;
const COIN_RADIUS = 15;
const PLAYER_RADIUS = 20;
const MAX_COINS = 5;
const GAME_DURATION = 120000;
const LEADERBOARD_INTERVAL = 10000;

let room = null;

const VALID_DIRECTIONS = new Set(['上', '下', '左', '右']);
const QUEUE_TICK_MS = 80;

function createRoom() {
  return {
    players: new Map(),
    character: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
    coins: [],
    scores: new Map(),
    commandHits: new Map(),
    totalCommands: new Map(),
    commandQueue: [],
    startTime: Date.now(),
    gameOver: false
  };
}

function spawnCoin(room) {
  return {
    id: Date.now() + Math.random(),
    x: Math.random() * (CANVAS_WIDTH - 60) + 30,
    y: Math.random() * (CANVAS_HEIGHT - 60) + 30
  };
}

function initCoins(room) {
  room.coins = [];
  for (let i = 0; i < MAX_COINS; i++) {
    room.coins.push(spawnCoin(room));
  }
}

function checkCollision(character, coin) {
  const dx = character.x - coin.x;
  const dy = character.y - coin.y;
  return Math.sqrt(dx * dx + dy * dy) < (PLAYER_RADIUS + COIN_RADIUS);
}

function processCommand(room, playerName, direction) {
  if (room.gameOver) return;

  switch (direction) {
    case '上': room.character.y = Math.max(PLAYER_RADIUS, room.character.y - MOVE_STEP); break;
    case '下': room.character.y = Math.min(CANVAS_HEIGHT - PLAYER_RADIUS, room.character.y + MOVE_STEP); break;
    case '左': room.character.x = Math.max(PLAYER_RADIUS, room.character.x - MOVE_STEP); break;
    case '右': room.character.x = Math.min(CANVAS_WIDTH - PLAYER_RADIUS, room.character.x + MOVE_STEP); break;
  }

  if (!room.totalCommands.has(playerName)) {
    room.totalCommands.set(playerName, 0);
    room.commandHits.set(playerName, 0);
  }
  room.totalCommands.set(playerName, room.totalCommands.get(playerName) + 1);

  room.coins = room.coins.filter(coin => {
    if (checkCollision(room.character, coin)) {
      const current = room.scores.get(playerName) || 0;
      room.scores.set(playerName, current + 1);
      room.commandHits.set(playerName, room.commandHits.get(playerName) + 1);
      return false;
    }
    return true;
  });

  while (room.coins.length < MAX_COINS) {
    room.coins.push(spawnCoin(room));
  }
}

function processQueue() {
  if (!room || room.gameOver || room.commandQueue.length === 0) return;
  const { playerName, direction } = room.commandQueue.shift();
  processCommand(room, playerName, direction);
  broadcastState();
}

function getLeaderboard(room) {
  const entries = [...room.scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, score]) => ({ name, score }));
  return entries;
}

function getGameStats(room) {
  const leaderboard = [...room.scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, score]) => ({ name, score }));

  const mvp = leaderboard.length > 0 ? leaderboard[0] : null;

  const accuracy = [...room.totalCommands.entries()].map(([name, total]) => {
    const hits = room.commandHits.get(name) || 0;
    return {
      name,
      totalValid: total,
      hits,
      accuracy: total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '0%'
    };
  }).sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy));

  return { mvp, leaderboard, accuracy, duration: Date.now() - room.startTime };
}

function broadcast(data) {
  if (!room) return;
  const msg = JSON.stringify(data);
  room.players.forEach((info, ws) => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

function broadcastState() {
  if (!room || room.gameOver) return;
  broadcast({
    type: 'state',
    character: room.character,
    coins: room.coins,
    timeLeft: Math.max(0, GAME_DURATION - (Date.now() - room.startTime))
  });
}

function endGame() {
  if (!room || room.gameOver) return;
  room.gameOver = true;
  const stats = getGameStats(room);
  broadcast({ type: 'gameOver', stats });
}

let stateInterval = null;
let leaderboardInterval = null;
let queueInterval = null;
let gameTimer = null;

function startRoom() {
  room = createRoom();
  initCoins(room);

  stateInterval = setInterval(broadcastState, 50);

  queueInterval = setInterval(processQueue, QUEUE_TICK_MS);

  const now = Date.now();
  const msToNext10s = LEADERBOARD_INTERVAL - (now % LEADERBOARD_INTERVAL);
  setTimeout(() => {
    if (room && !room.gameOver) {
      broadcast({ type: 'leaderboard', data: getLeaderboard(room) });
    }
    leaderboardInterval = setInterval(() => {
      if (room && !room.gameOver) {
        broadcast({ type: 'leaderboard', data: getLeaderboard(room) });
      }
    }, LEADERBOARD_INTERVAL);
  }, msToNext10s);

  gameTimer = setTimeout(endGame, GAME_DURATION);
}

function destroyRoom() {
  clearInterval(stateInterval);
  clearInterval(leaderboardInterval);
  clearInterval(queueInterval);
  clearTimeout(gameTimer);
  room = null;
}

wss.on('connection', (ws) => {
  if (!room) startRoom();

  let playerName = '观众' + Math.floor(Math.random() * 9999);
  room.players.set(ws, { name: playerName });
  room.scores.set(playerName, room.scores.get(playerName) || 0);

  ws.send(JSON.stringify({
    type: 'welcome',
    name: playerName,
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    gameDuration: GAME_DURATION,
    timeLeft: Math.max(0, GAME_DURATION - (Date.now() - room.startTime))
  }));

  broadcast({ type: 'playerCount', count: room.players.size });
  broadcast({ type: 'leaderboard', data: getLeaderboard(room) });
  broadcastState();

  ws.on('message', (data) => {
    if (!room || room.gameOver) return;
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'barrage') {
        const text = msg.text.trim();

        broadcast({
          type: 'barrage',
          name: playerName,
          text: text
        });

        if (VALID_DIRECTIONS.has(text)) {
          room.commandQueue.push({ playerName, direction: text });
        }
      } else if (msg.type === 'setName') {
        const newName = msg.name.trim().slice(0, 12);
        if (newName && newName !== playerName) {
          const oldScore = room.scores.get(playerName) || 0;
          const oldHits = room.commandHits.get(playerName) || 0;
          const oldTotal = room.totalCommands.get(playerName) || 0;
          room.scores.delete(playerName);
          room.commandHits.delete(playerName);
          room.totalCommands.delete(playerName);
          playerName = newName;
          room.players.set(ws, { name: playerName });
          room.scores.set(playerName, (room.scores.get(playerName) || 0) + oldScore);
          room.commandHits.set(playerName, (room.commandHits.get(playerName) || 0) + oldHits);
          room.totalCommands.set(playerName, (room.totalCommands.get(playerName) || 0) + oldTotal);
          ws.send(JSON.stringify({ type: 'nameChanged', name: playerName }));
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (room) {
      room.players.delete(ws);
      broadcast({ type: 'playerCount', count: room.players.size });
      if (room.players.size === 0) {
        destroyRoom();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`弹幕游戏服务器运行在 http://localhost:${PORT}`);
});

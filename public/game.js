const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const barrageLayer = document.getElementById('barrageLayer');

let ws;
let myName = '';
let gameState = { character: { x: 400, y: 300 }, coins: [], timeLeft: 0 };
let canvasWidth = 800;
let canvasHeight = 600;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => console.log('已连接服务器');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log('连接断开，3秒后重连...');
    setTimeout(connect, 3000);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      myName = msg.name;
      canvasWidth = msg.canvasWidth;
      canvasHeight = msg.canvasHeight;
      document.getElementById('nameInput').value = myName;
      updateTimer(msg.timeLeft);
      break;

    case 'state':
      gameState.character = msg.character;
      gameState.coins = msg.coins;
      gameState.timeLeft = msg.timeLeft;
      updateTimer(msg.timeLeft);
      render();
      break;

    case 'leaderboard':
      renderLeaderboard(msg.data);
      updateMyScore(msg.data);
      break;

    case 'barrage':
      showBarrage(msg.name, msg.text);
      break;

    case 'playerCount':
      document.getElementById('playerCount').textContent = '在线: ' + msg.count;
      break;

    case 'nameChanged':
      myName = msg.name;
      break;

    case 'gameOver':
      showGameOver(msg.stats);
      break;
  }
}

function render() {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  drawGrid();

  gameState.coins.forEach(coin => {
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd200';
    ctx.fill();
    ctx.strokeStyle = '#f7971e';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#000';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', coin.x, coin.y);
  });

  const ch = gameState.character;
  ctx.beginPath();
  ctx.arc(ch.x, ch.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = '#4ecdc4';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', ch.x, ch.y);

  const trailGradient = ctx.createRadialGradient(ch.x, ch.y, 0, ch.x, ch.y, 30);
  trailGradient.addColorStop(0, 'rgba(78,205,196,0.3)');
  trailGradient.addColorStop(1, 'rgba(78,205,196,0)');
  ctx.beginPath();
  ctx.arc(ch.x, ch.y, 30, 0, Math.PI * 2);
  ctx.fillStyle = trailGradient;
  ctx.fill();
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvasWidth; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  for (let y = 0; y < canvasHeight; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }
}

function updateTimer(timeLeft) {
  const seconds = Math.ceil(timeLeft / 1000);
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  document.getElementById('timer').textContent =
    `剩余: ${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function renderLeaderboard(data) {
  const container = document.getElementById('leaderboard');
  if (data.length === 0) {
    container.innerHTML = '<div style="color:#888;font-size:0.85em;">暂无得分</div>';
    return;
  }
  container.innerHTML = data.map((entry, i) => {
    const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    const isMe = entry.name === myName ? ' style="color:#4ecdc4"' : '';
    return `<div class="lb-entry">
      <span><span class="lb-rank">${rankIcon}</span><span${isMe}>${escapeHtml(entry.name)}</span></span>
      <span>${entry.score}</span>
    </div>`;
  }).join('');
}

function updateMyScore(data) {
  const me = data.find(e => e.name === myName);
  document.getElementById('myScore').textContent = '得分: ' + (me ? me.score : 0);
}

function showBarrage(name, text) {
  const el = document.createElement('div');
  el.className = 'barrage-item';
  el.textContent = `${name}: ${text}`;
  el.style.top = Math.random() * (canvasHeight - 30) + 'px';
  el.style.color = getBarrageColor(text);
  barrageLayer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function getBarrageColor(text) {
  const directions = ['上', '下', '左', '右'];
  if (directions.some(d => text.includes(d))) {
    return '#4ecdc4';
  }
  const colors = ['#ff6b6b', '#ffd93d', '#6bcf7f', '#74b9ff', '#fd79a8', '#a29bfe'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function showGameOver(stats) {
  const modal = document.getElementById('gameOverModal');
  const statsEl = document.getElementById('gameStats');

  let html = '';

  if (stats.mvp) {
    html += `<div class="stats-section mvp-highlight">
      <div>全场 MVP</div>
      <div class="mvp-name">${escapeHtml(stats.mvp.name)}</div>
      <div class="mvp-score">得分: ${stats.mvp.score}</div>
    </div>`;
  }

  if (stats.leaderboard.length > 0) {
    html += `<div class="stats-section">
      <h4>最终排行</h4>
      <table class="stats-table">
        <tr><th>排名</th><th>玩家</th><th>得分</th></tr>
        ${stats.leaderboard.slice(0, 10).map((e, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.score}</td></tr>`
        ).join('')}
      </table>
    </div>`;
  }

  if (stats.accuracy.length > 0) {
    html += `<div class="stats-section">
      <h4>指令准确率统计</h4>
      <table class="stats-table">
        <tr><th>玩家</th><th>有效指令</th><th>命中(拾取)</th><th>准确率</th></tr>
        ${stats.accuracy.slice(0, 10).map(e =>
          `<tr><td>${escapeHtml(e.name)}</td><td>${e.totalValid}</td><td>${e.hits}</td><td>${e.accuracy}</td></tr>`
        ).join('')}
      </table>
    </div>`;
  }

  const duration = Math.floor(stats.duration / 1000);
  html += `<div class="stats-section" style="text-align:center;color:#888;">
    游戏时长: ${Math.floor(duration / 60)}分${duration % 60}秒
  </div>`;

  statsEl.innerHTML = html;
  modal.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sendBarrage() {
  const input = document.getElementById('barrageInput');
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'barrage', text }));
  input.value = '';
}

document.getElementById('sendBtn').addEventListener('click', sendBarrage);
document.getElementById('barrageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendBarrage();
});

document.getElementById('setNameBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  if (name && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'setName', name }));
  }
});

document.querySelectorAll('.dir-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'barrage', text: dir }));
    }
  });
});

document.getElementById('closeModal').addEventListener('click', () => {
  document.getElementById('gameOverModal').classList.add('hidden');
});

connect();
render();

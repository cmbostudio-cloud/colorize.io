const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
});

// HTML은 항상 최신으로 (캐시 금지), 나머지 정적 파일은 일반 서빙
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ── PWA 아이콘 동적 생성 (SVG → PNG 없이 SVG 직접 서빙) ──
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#F7F5F0"/>
  <circle cx="256" cy="256" r="180" fill="#5C9EFF"/>
  <circle cx="256" cy="256" r="100" fill="#F7F5F0" opacity="0.25"/>
  <circle cx="196" cy="196" r="44" fill="white" opacity="0.55"/>
</svg>`;

// 아이콘을 SVG로 직접 서빙 (192, 512 둘 다)
app.get('/icon-192.png', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(ICON_SVG);
});
app.get('/icon-512.png', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(ICON_SVG);
});
app.get('/icon.svg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(ICON_SVG);
});

// ── Service Worker (network-first, 항상 최신 파일 우선) ──
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-store'); // SW 자체는 절대 캐시 안 함
  res.send(`
const CACHE_VERSION = 'colorize-v${Date.now()}'; // 서버 재시작마다 새 버전

self.addEventListener('install', e => {
  self.skipWaiting(); // 즉시 활성화
});

self.addEventListener('activate', e => {
  // 이전 버전 캐시 전부 삭제
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // socket.io / API 요청은 캐시 안 함
  if (e.request.url.includes('/socket.io/')) return;

  // Network-first: 항상 서버에서 받고, 실패하면 캐시 사용
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 성공 시 캐시에 저장
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
  `);
});

// ── manifest.json ──
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'colorize.io',
    short_name: 'colorize',
    description: 'Paint tiles · Claim your land',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F5F0',
    theme_color: '#F7F5F0',
    orientation: 'any',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/svg+xml' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/svg+xml' },
    ],
  });
});

// ── 상수 ────────────────────────────────────────────
const GRID_W        = 40;
const GRID_H        = 30;
const TILE_SIZE     = 40;
const MOVE_SPEED    = 3;
const BULLET_SPEED  = 6;
const BULLET_RADIUS = 7;
const PLAYER_RADIUS = 14;
const SHOOT_COOLDOWN  = 1000;      // ms
const BULLET_LIFETIME = 2000;      // ms — 2초 후 소멸
const TICK_RATE       = 1000 / 30; // 30fps 서버 틱

const TEAMS = ['red', 'blue', 'green'];

// ── 게임 상태 ────────────────────────────────────────
/** tiles[y][x] = 'red' | 'blue' | 'green' | null */
let tiles   = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(null));
/** players: { [socketId]: Player } */
let players = {};
/** bullets: { [bulletId]: Bullet } */
let bullets = {};
let bulletIdCounter = 0;

// ── 유틸 ─────────────────────────────────────────────
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function autoAssignTeam() {
  // 팀별 인원 수 균형 맞추기
  const counts = { red: 0, blue: 0, green: 0 };
  Object.values(players).forEach(p => { counts[p.team]++; });
  return TEAMS.reduce((a, b) => counts[a] <= counts[b] ? a : b);
}

function spawnPosition(team) {
  // 팀별 초기 스폰 위치 (각 코너)
  const spawns = {
    red:   { x: TILE_SIZE * 3,          y: TILE_SIZE * 3 },
    blue:  { x: TILE_SIZE * (GRID_W-3), y: TILE_SIZE * 3 },
    green: { x: TILE_SIZE * (GRID_W/2), y: TILE_SIZE * (GRID_H-3) },
  };
  // 살짝 랜덤 오프셋
  const s = spawns[team];
  return {
    x: s.x + (Math.random() - 0.5) * TILE_SIZE * 2,
    y: s.y + (Math.random() - 0.5) * TILE_SIZE * 2,
  };
}

function tileAt(x, y) {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return undefined;
  return tiles[y][x];
}

function paintTile(tx, ty, team, socket) {
  if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) return;
  if (tiles[ty][tx] === team) return; // 이미 같은 팀
  tiles[ty][tx] = team;
  io.emit('tile_paint', { x: tx, y: ty, team });
}

function getScores() {
  const s = { red: 0, blue: 0, green: 0 };
  tiles.forEach(row => row.forEach(t => { if (t) s[t]++; }));
  return s;
}

// ── 총알 충돌 감지 ────────────────────────────────────
function checkBulletCollisions() {
  const toRemove = new Set(); // Set으로 중복 제거

  Object.entries(bullets).forEach(([bid, b]) => {
    if (toRemove.has(bid)) return; // 이미 제거 예정인 총알 스킵

    // 벽 충돌
    if (b.x < 0 || b.x > GRID_W * TILE_SIZE || b.y < 0 || b.y > GRID_H * TILE_SIZE) {
      toRemove.add(bid);
      return;
    }

    // ── 레이캐스팅: 이전 위치 → 현재 위치 경로의 모든 타일을 칠함 ──
    const prevX = b.prevX ?? b.x;
    const prevY = b.prevY ?? b.y;
    const tilesOnPath = getTilesOnSegment(prevX, prevY, b.x, b.y);
    tilesOnPath.forEach(({ tx, ty }) => {
      if (tileAt(tx, ty) !== undefined) paintTile(tx, ty, b.team);
    });

    // 플레이어 충돌 (다른 팀)
    Object.entries(players).forEach(([pid, p]) => {
      if (toRemove.has(bid)) return; // 이미 충돌 처리된 총알
      if (pid === b.owner) return;
      if (p.team === b.team) return;
      const dist = Math.hypot(p.x - b.x, p.y - b.y);
      if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
        const spawn = spawnPosition(p.team);
        p.x = spawn.x; p.y = spawn.y;
        io.to(pid).emit('respawn', { x: p.x, y: p.y });
        io.emit('player_move', { id: pid, x: p.x, y: p.y });
        io.emit('player_eliminated', { killerId: b.owner, killedId: pid });
        toRemove.add(bid);
      }
    });
  });

  toRemove.forEach(bid => {
    if (bullets[bid]) { // 이미 삭제된 경우 방어
      delete bullets[bid];
      io.emit('bullet_remove', { id: bid });
    }
  });
}

// ── 선분 위의 모든 그리드 타일을 반환 (DDA 알고리즘) ──
function getTilesOnSegment(x0, y0, x1, y1) {
  const result = [];
  const seen = new Set();

  // 시작·끝 타일 좌표
  let tx0 = Math.floor(x0 / TILE_SIZE);
  let ty0 = Math.floor(y0 / TILE_SIZE);
  const tx1 = Math.floor(x1 / TILE_SIZE);
  const ty1 = Math.floor(y1 / TILE_SIZE);

  const dtx = Math.abs(tx1 - tx0);
  const dty = Math.abs(ty1 - ty0);
  const sx  = tx0 < tx1 ? 1 : -1;
  const sy  = ty0 < ty1 ? 1 : -1;
  let err = dtx - dty;

  while (true) {
    const key = `${tx0},${ty0}`;
    if (!seen.has(key)) { seen.add(key); result.push({ tx: tx0, ty: ty0 }); }
    if (tx0 === tx1 && ty0 === ty1) break;
    const e2 = 2 * err;
    if (e2 > -dty) { err -= dty; tx0 += sx; }
    if (e2 <  dtx) { err += dtx; ty0 += sy; }
  }

  return result;
}

// ── 서버 틱 (총알 이동) ───────────────────────────────
setInterval(() => {
  if (Object.keys(bullets).length === 0) return;

  const now = Date.now();
  const expired = [];

  // 1단계: 이동 + 수명 초과 수집
  Object.entries(bullets).forEach(([id, b]) => {
    b.prevX = b.x;
    b.prevY = b.y;
    b.x += b.dx;
    b.y += b.dy;
    if (now - (b.spawnTime || now) >= BULLET_LIFETIME) {
      expired.push(id);
    }
  });

  // 수명 초과 총알 먼저 제거 (충돌 체크 전)
  expired.forEach(id => {
    delete bullets[id];
    io.emit('bullet_remove', { id });
  });

  // 2단계: 살아있는 총알만 충돌 체크
  checkBulletCollisions();
}, TICK_RATE);

// ── Socket.io 이벤트 ──────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 연결:', socket.id);

  // ── join ──
  socket.on('join', ({ name, team }) => {
    // 이미 등록된 경우 중복 방지 (재연결 등)
    if (players[socket.id]) {
      delete players[socket.id];
    }

    const assignedTeam = TEAMS.includes(team) ? team : autoAssignTeam();
    const spawn = spawnPosition(assignedTeam);

    players[socket.id] = {
      id:       socket.id,
      name:     (String(name || '익명').trim() || '익명').slice(0, 16),
      team:     assignedTeam,
      x:        spawn.x,
      y:        spawn.y,
      lastShot: 0,
    };

    // 현재 전체 상태 전송
    socket.emit('init', {
      id:      socket.id,
      tiles,
      players: Object.fromEntries(
        Object.entries(players).map(([id, p]) => [id, sanitizePlayer(p)])
      ),
    });

    // 다른 플레이어들에게 입장 알림
    socket.broadcast.emit('player_join', sanitizePlayer(players[socket.id]));

    console.log(`👤 ${players[socket.id].name} (${assignedTeam}) 입장 | 총 ${Object.keys(players).length}명`);
  });

  // ── move ──
  socket.on('move', ({ x, y }) => {
    const p = players[socket.id];
    if (!p) return;

    const maxX = GRID_W * TILE_SIZE - PLAYER_RADIUS;
    const maxY = GRID_H * TILE_SIZE - PLAYER_RADIUS;
    p.x = clamp(x, PLAYER_RADIUS, maxX);
    p.y = clamp(y, PLAYER_RADIUS, maxY);

    // 이동하면 발밑 타일 칠하기
    const tx = Math.floor(p.x / TILE_SIZE);
    const ty = Math.floor(p.y / TILE_SIZE);
    paintTile(tx, ty, p.team);

    // 다른 플레이어들에게 위치 전송
    socket.broadcast.emit('player_move', { id: socket.id, x: p.x, y: p.y });
  });

  // ── paint_tile (클라이언트가 명시적으로 요청) ──
  socket.on('paint_tile', ({ x, y }) => {
    const p = players[socket.id];
    if (!p) return;
    paintTile(Math.floor(x), Math.floor(y), p.team);
  });

  // ── shoot ──
  socket.on('shoot', ({ dx, dy }) => {
    const p = players[socket.id];
    if (!p) return;

    const now = Date.now();
    if (now - p.lastShot < SHOOT_COOLDOWN) return; // 쿨다운
    p.lastShot = now;

    // 방향 정규화 후 속도 적용
    const len = Math.hypot(dx, dy) || 1;
    const ndx = (dx / len) * BULLET_SPEED;
    const ndy = (dy / len) * BULLET_SPEED;

    const id = `b_${bulletIdCounter++}`;
    bullets[id] = {
      id,
      owner:     socket.id,
      team:      p.team,
      x:         p.x,
      y:         p.y,
      dx:        ndx,
      dy:        ndy,
      spawnTime: Date.now(), // 2초 소멸용
    };

    io.emit('bullet_spawn', bullets[id]);
  });

  // ── chat ──
  socket.on('chat', ({ text }) => {
    const p = players[socket.id];
    if (!p) return;
    const clean = String(text || '').trim().slice(0, 80);
    if (!clean) return;
    io.emit('chat', { name: p.name, team: p.team, text: clean });
  });

  // ── ping ──
  socket.on('ping_c', () => {
    socket.emit('pong_c');
  });

  // ── disconnect ──
  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      console.log(`👋 ${p.name} 퇴장`);
      io.emit('player_leave', { id: socket.id });
      delete players[socket.id];
    }

    // 해당 플레이어의 총알 제거
    Object.entries(bullets).forEach(([bid, b]) => {
      if (b.owner === socket.id) {
        delete bullets[bid];
        io.emit('bullet_remove', { id: bid });
      }
    });
  });
});

// ── 헬퍼 ─────────────────────────────────────────────
function sanitizePlayer(p) {
  return { id: p.id, name: p.name, team: p.team, x: p.x, y: p.y };
}

// ── 서버 시작 ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎨 colorize.io 서버 실행 중 → http://localhost:${PORT}`);
});

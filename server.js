const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e4,  // 패킷 최대 10KB
  pingTimeout:  60000,     // 60초 (넉넉하게)
  pingInterval: 25000,     // 25초마다 ping
});

// ── IP 블랙리스트 ─────────────────────────────────────
// 주의: Railway 환경에서 공인 IP가 겹칠 수 있으므로 신중하게 추가
const IP_BLACKLIST = new Set([
  // '175.203.98.249', // 본인 IP와 겹쳐서 비활성화
]);

// ── HTTP DDoS 방어 (rate limit) ──────────────────────
const httpRateLimit = new Map(); // ip → { count, resetAt }
const HTTP_RATE_WINDOW = 60 * 1000; // 1분
const HTTP_RATE_MAX    = 300;        // 1분에 최대 300 요청
const HTTP_RATE_BAN    = 60 * 1000; // 초과 시 1분 차단

app.use((req, res, next) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress;

  // 블랙리스트 차단
  if (IP_BLACKLIST.has(ip)) {
    res.status(403).end();
    return;
  }

  const now = Date.now();
  const entry = httpRateLimit.get(ip);

  if (!entry || now >= entry.resetAt) {
    httpRateLimit.set(ip, { count: 1, resetAt: now + HTTP_RATE_WINDOW });
    return next();
  }

  entry.count++;

  if (entry.count > HTTP_RATE_MAX) {
    console.warn(`🚫 HTTP rate limit 초과: ${ip} (${entry.count}회/분)`);
    res.status(429).send('Too Many Requests');
    return;
  }

  next();
});

// httpRateLimit 맵 메모리 누수 방지 (5분마다 만료 항목 정리)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of httpRateLimit) {
    if (now >= entry.resetAt) httpRateLimit.delete(ip);
  }
}, 5 * 60 * 1000);

// ── 보안 헤더 ────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // Babel 인브라우저·PixiJS WebGL 셰이더 모두 unsafe-eval 필요
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' cdnjs.cloudflare.com",
    // 구글 폰트 CSS
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    // 구글 폰트 파일
    "font-src 'self' fonts.gstatic.com",
    // Socket.IO WebSocket + devtools 소스맵 요청 허용
    "connect-src 'self' wss: ws: https://cdnjs.cloudflare.com",
    "img-src 'self' data:",
    "worker-src 'self'",
  ].join('; '));
  next();
});

// HTML은 항상 최신으로 (캐시 금지), 나머지 정적 파일은 일반 서빙
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'dist')));

// ── PWA 아이콘 동적 생성 (SVG 직접 서빙) ──
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#F7F5F0"/>
  <circle cx="256" cy="256" r="180" fill="#5C9EFF"/>
  <circle cx="256" cy="256" r="100" fill="#F7F5F0" opacity="0.25"/>
  <circle cx="196" cy="196" r="44" fill="white" opacity="0.55"/>
</svg>`;

app.get('/icon-192.png', (req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.send(ICON_SVG); });
app.get('/icon-512.png', (req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.send(ICON_SVG); });
app.get('/icon.svg',     (req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.send(ICON_SVG); });

// ── Service Worker (network-first, same-origin only) ──
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`
const CACHE_VERSION = 'colorize-v${Date.now()}';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  // socket.io, non-GET, 외부 CDN/폰트는 Service Worker가 관여하지 않음
  // → CSP connect-src 위반 방지
  if (e.request.method !== 'GET') return;
  if (url.includes('/socket.io/')) return;
  if (!url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (!res || res.status !== 200 || res.type === 'error') return res;
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request).then(
        cached => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
      ))
  );
});
  `);
});

// ── manifest.json ──
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'colorize.io', short_name: 'colorize',
    description: 'Paint tiles · Claim your land',
    start_url: '/', display: 'standalone',
    background_color: '#F7F5F0', theme_color: '#F7F5F0',
    orientation: 'any',
    icons: [
      { src: '/icon.svg',     sizes: 'any',     type: 'image/svg+xml', purpose: 'any maskable' },
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
const BULLET_SPEED  = 12;
const BULLET_RADIUS = 7;
const PLAYER_RADIUS = 14;
const SHOOT_COOLDOWN    = 1000;
const BULLET_LIFETIME   = 1000;
const TICK_RATE         = 1000 / 30;
const INVINCIBLE_MS     = 5000;  // 리스폰 후 무적 시간
const TILE_LOSS_RATIO   = 0.15;  // 사망 시 타일 손실 비율
const TILE_LOSS_MIN     = 3;     // 최소 손실 타일 수
const TILE_LOSS_MAX     = 50;    // 최대 손실 타일 수

// ── 보안 상수 ────────────────────────────────────────
const MAX_CONNS_PER_IP   = 3;     // IP당 최대 동시 접속
const JOIN_TIMEOUT_MS    = 8000;  // 접속 후 join 없으면 kick
const MOVE_RATE_LIMIT    = 120;   // 초당 최대 move (60fps * 2배 여유)
const SHOOT_RATE_LIMIT   = 2;     // 초당 최대 shoot (쿨다운 1초이므로 여유 1개)
const CHAT_RATE_LIMIT    = 2;     // 초당 최대 채팅
const PAINT_RATE_LIMIT   = 30;    // 초당 최대 paint_tile
const PING_RATE_LIMIT    = 1;     // 초당 최대 ping_c
const RATE_WINDOW_MS     = 1000;  // rate limit 집계 윈도우
const MAX_VIOLATIONS     = 50;    // 위반 누적 시 kick (화이트해커 권고값)
const VIOLATION_DECAY_MS = 10000; // 10초마다 위반 카운트 1 감소
const MAX_PLAYERS        = 100;   // 서버 최대 수용 인원
// 텔레포트 방지: 틱당 최대 이동거리 (MOVE_SPEED * √2 + 여유 10px)
const MAX_MOVE_DIST      = MOVE_SPEED * Math.SQRT2 + 10;
// 예약된 닉네임 키워드 (포함 시 'Player'로 강제)
const RESERVED_NAMES     = ['admin','system','server','official','moderator','mod','gm','운영','관리'];
// 닉네임 허용 문자 외 제거 패턴
const NAME_STRIP_RE      = /[<>"'&\/\\]/g;
const CTRL_STRIP_RE      = /[\x00-\x1F\x7F]/g;

const TEAMS = ['red', 'blue', 'green'];

// ── 보안 상태 ────────────────────────────────────────
// IP별 접속 수 추적
const ipConnections = new Map(); // ip → Set<socketId>

// 소켓별 rate limit 카운터
// { move: {count, resetAt}, shoot: {count, resetAt}, chat: {count, resetAt}, paint: {count, resetAt} }
const rateLimiters  = new Map(); // socketId → counters

// 소켓별 위반 카운트
const violations    = new Map(); // socketId → { count, decayTimer }

// ── 보안 헬퍼 ────────────────────────────────────────

// IP 추출 (프록시 환경 대응)
function getIp(socket) {
  return (
    socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() ||
    socket.handshake.address
  );
}

// rate limit 체크 — true면 허용, false면 초과
function checkRate(socketId, key, limit) {
  if (!rateLimiters.has(socketId)) rateLimiters.set(socketId, {});
  const counters = rateLimiters.get(socketId);
  const now = Date.now();
  if (!counters[key] || now >= counters[key].resetAt) {
    counters[key] = { count: 1, resetAt: now + RATE_WINDOW_MS };
    return true;
  }
  counters[key].count++;
  return counters[key].count <= limit;
}

// 위반 처리 — 로그만 남기고 kick은 명시적 임계값 초과 시만
function addViolation(socket, reason) {
  const id = socket.id;
  if (!violations.has(id)) {
    const decayTimer = setInterval(() => {
      const v = violations.get(id);
      if (!v) return;
      v.count = Math.max(0, v.count - 1);
    }, VIOLATION_DECAY_MS);
    violations.set(id, { count: 0, decayTimer });
  }
  const v = violations.get(id);
  v.count++;
  console.warn(`⚠️  위반 [${getIp(socket)}] ${reason} (누적 ${v.count})`);
  // kick은 명백한 악성 패킷(join 전 이벤트, 비정상 페이로드)에만 적용
  // rate limit 오탐으로 정상 유저가 kick되는 문제 방지
}

// 페이로드 타입 검증 유틸
function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
function isSafeStr(v, max) { return typeof v === 'string' && v.length <= max; }

// 닉네임 정제: HTML 인젝션·제어문자·예약어 처리
function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'Player';
  let name = raw
    .replace(CTRL_STRIP_RE, '')  // 제어문자 제거
    .replace(NAME_STRIP_RE, '')  // HTML 특수문자 제거
    .trim()
    .slice(0, 16);
  if (!name) return 'Player';
  const lower = name.toLowerCase();
  if (RESERVED_NAMES.some(r => lower.includes(r))) return 'Player';
  return name;
}

// ── 타일 영속성 ───────────────────────────────────────
const TILES_FILE    = path.join(__dirname, 'tiles.json');
const SAVE_INTERVAL = 30 * 1000; // 30초마다 저장

function loadTiles() {
  try {
    if (fs.existsSync(TILES_FILE)) {
      const data = JSON.parse(fs.readFileSync(TILES_FILE, 'utf8'));
      // 크기 검증: 맵 크기가 바뀌었으면 무시
      if (Array.isArray(data) && data.length === GRID_H && data[0]?.length === GRID_W) {
        console.log('💾 타일 데이터 불러옴:', TILES_FILE);
        return data;
      }
    }
  } catch (e) {
    console.warn('⚠️ 타일 파일 읽기 실패, 초기화:', e.message);
  }
  return Array.from({ length: GRID_H }, () => Array(GRID_W).fill(null));
}

function saveTiles() {
  try {
    fs.writeFileSync(TILES_FILE, JSON.stringify(tiles), 'utf8');
  } catch (e) {
    console.warn('⚠️ 타일 저장 실패:', e.message);
  }
}

// ── 게임 상태 ────────────────────────────────────────
let tiles   = loadTiles();
let players = {};
let bullets = {};
let bulletIdCounter = 0;

// 30초마다 자동 저장
setInterval(saveTiles, SAVE_INTERVAL);

// 서버 종료 시 즉시 저장 (Ctrl+C, nodemon 재시작 등)
process.on('SIGINT',  () => { saveTiles(); process.exit(0); });
process.on('SIGTERM', () => { saveTiles(); process.exit(0); });

// ── 유틸 ─────────────────────────────────────────────
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function spawnPosition(team) {
  const spawns = {
    red:   { x: TILE_SIZE * 3,            y: TILE_SIZE * 3 },
    blue:  { x: TILE_SIZE * (GRID_W - 3), y: TILE_SIZE * 3 },
    green: { x: TILE_SIZE * (GRID_W / 2), y: TILE_SIZE * (GRID_H - 3) },
  };
  const s = spawns[team];
  return {
    x: clamp(s.x + (Math.random() - 0.5) * TILE_SIZE * 2, PLAYER_RADIUS, GRID_W * TILE_SIZE - PLAYER_RADIUS),
    y: clamp(s.y + (Math.random() - 0.5) * TILE_SIZE * 2, PLAYER_RADIUS, GRID_H * TILE_SIZE - PLAYER_RADIUS),
  };
}

function tileAt(x, y) {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return undefined;
  return tiles[y][x];
}

function paintTile(tx, ty, team, ownerId) {
  if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) return;
  if (tiles[ty][tx] === team) return;
  tiles[ty][tx] = team;
  io.emit('tile_paint', { x: tx, y: ty, team });
}

function getScores() {
  const s = { red: 0, blue: 0, green: 0 };
  tiles.forEach(row => row.forEach(t => { if (t) s[t]++; }));
  return s;
}

// ── 사망 시 타일 손실 ────────────────────────────────────
function loseTiles(team) {
  // 해당 팀 타일 좌표 수집
  const owned = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (tiles[y][x] === team) owned.push({ x, y });
    }
  }
  if (owned.length === 0) return;

  const loss = clamp(Math.round(owned.length * TILE_LOSS_RATIO), TILE_LOSS_MIN, TILE_LOSS_MAX);
  // Fisher-Yates 셔플 후 앞 loss개 제거
  for (let i = owned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [owned[i], owned[j]] = [owned[j], owned[i]];
  }
  owned.slice(0, loss).forEach(({ x, y }) => {
    tiles[y][x] = null;
    io.emit('tile_paint', { x, y, team: null });
  });
}

// ── 총알 충돌 감지 ────────────────────────────────────
function checkBulletCollisions() {
  const toRemove = new Set();

  Object.entries(bullets).forEach(([bid, b]) => {
    if (toRemove.has(bid)) return;

    // 벽 충돌
    if (b.x < 0 || b.x > GRID_W * TILE_SIZE || b.y < 0 || b.y > GRID_H * TILE_SIZE) {
      toRemove.add(bid);
      return;
    }

    // 레이캐스팅: 이전 위치 → 현재 위치 경로의 타일 칠하기
    const prevX = b.prevX ?? b.x;
    const prevY = b.prevY ?? b.y;
    const tilesOnPath = getTilesOnSegment(prevX, prevY, b.x, b.y);
    tilesOnPath.forEach(({ tx, ty }) => {
      if (tileAt(tx, ty) !== undefined) paintTile(tx, ty, b.team, b.owner);
    });

    // 플레이어 충돌 (다른 팀, 무적 제외)
    Object.entries(players).forEach(([pid, p]) => {
      if (toRemove.has(bid)) return;
      if (pid === b.owner) return;
      if (p.team === b.team) return;
      // 무적 상태면 충돌 무시
      if (p.invincibleUntil && Date.now() < p.invincibleUntil) return;
      const dist = Math.hypot(p.x - b.x, p.y - b.y);
      if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
        // 타일 손실 적용
        loseTiles(p.team);
        const spawn = spawnPosition(p.team);
        p.x = spawn.x; p.y = spawn.y;
        // 리스폰 시 무적 부여
        p.invincibleUntil = Date.now() + INVINCIBLE_MS;
        io.to(pid).emit('respawn', { x: p.x, y: p.y, invincibleMs: INVINCIBLE_MS });
        io.emit('player_move', { id: pid, x: p.x, y: p.y });
        io.emit('player_eliminated', { killerId: b.owner, killedId: pid });
        toRemove.add(bid);
      }
    });
  });

  toRemove.forEach(bid => {
    // [FIX-S2] delete 전에 emit (bid는 로컬 변수라 문제없지만 명시적 순서 보장)
    io.emit('bullet_remove', { id: bid });
    delete bullets[bid];
  });
}

// ── 선분 위의 모든 그리드 타일 반환 (Bresenham DDA) ──
// [FIX-S3] 표준 Bresenham 알고리즘으로 수정 — 기존 err 조건이 불명확했음
function getTilesOnSegment(x0, y0, x1, y1) {
  const result = [];
  const seen = new Set();

  let tx = Math.floor(x0 / TILE_SIZE);
  let ty = Math.floor(y0 / TILE_SIZE);
  const tx1 = Math.floor(x1 / TILE_SIZE);
  const ty1 = Math.floor(y1 / TILE_SIZE);

  const addTile = (x, y) => {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
    const key = `${x},${y}`;
    if (!seen.has(key)) { seen.add(key); result.push({ tx: x, ty: y }); }
  };

  addTile(tx, ty);
  if (tx === tx1 && ty === ty1) return result;

  const dx = Math.abs(tx1 - tx);
  const dy = Math.abs(ty1 - ty);
  const sx = tx < tx1 ? 1 : -1;
  const sy = ty < ty1 ? 1 : -1;
  let err = dx - dy;

  while (!(tx === tx1 && ty === ty1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; tx += sx; }
    if (e2 <  dx) { err += dx; ty += sy; }
    addTile(tx, ty);
  }

  return result;
}

// ── 서버 틱 (총알 이동) ───────────────────────────────
setInterval(() => {
  if (Object.keys(bullets).length === 0) return;

  const now = Date.now();
  const expired = [];

  Object.entries(bullets).forEach(([id, b]) => {
    b.prevX = b.x;
    b.prevY = b.y;
    b.x += b.dx;
    b.y += b.dy;
    if (now - b.spawnTime >= BULLET_LIFETIME) {
      expired.push(id);
    }
  });

  // 수명 초과 총알 먼저 제거
  expired.forEach(id => {
    // [FIX-S4] emit을 delete 전에 실행 (명시적 순서)
    io.emit('bullet_remove', { id });
    delete bullets[id];
  });

  // 살아있는 총알만 충돌 체크
  checkBulletCollisions();
}, TICK_RATE);

// ── 개인 순위표 브로드캐스트 (2초마다) ──────────────────
setInterval(() => {
  if (Object.keys(players).length === 0) return;
  const teamTiles = { red: 0, blue: 0, green: 0 };
  tiles.forEach(row => row.forEach(t => { if (t) teamTiles[t]++; }));

  const leaderboard = Object.values(players)
    .map(p => ({
      id:   p.id,
      name: p.name,
      team: p.team,
      tiles: teamTiles[p.team] ?? 0,
    }))
    .sort((a, b) => b.tiles - a.tiles);

  io.emit('leaderboard', { leaderboard, teamTiles });
}, 2000);

// ── Socket.io 이벤트 ──────────────────────────────────
io.on('connection', (socket) => {
  const ip = getIp(socket);

  // 블랙리스트 즉시 차단
  if (IP_BLACKLIST.has(ip)) {
    console.warn(`🚫 블랙리스트 차단: ${ip}`);
    socket.disconnect(true);
    return;
  }

  // ① 서버 최대 인원 초과
  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit('kicked', { reason: 'Server full' });
    socket.disconnect(true);
    return;
  }

  // ② IP당 동시 접속 제한
  if (!ipConnections.has(ip)) ipConnections.set(ip, new Set());
  const ipSet = ipConnections.get(ip);
  if (ipSet.size >= MAX_CONNS_PER_IP) {
    console.warn(`🚫 IP 초과 차단: ${ip} (${ipSet.size}개 접속 중)`);
    socket.emit('kicked', { reason: 'Too many connections from your IP' });
    socket.disconnect(true);
    return;
  }
  ipSet.add(socket.id);
  console.log(`🔌 연결: ${socket.id} (${ip}) | IP 접속 수: ${ipSet.size}`);

  // ③ join 없이 일정 시간 경과 시 자동 kick
  const joinTimer = setTimeout(() => {
    if (!players[socket.id]) {
      console.warn(`⏱  join 미수신 kick: ${socket.id}`);
      socket.emit('kicked', { reason: 'Join timeout' });
      socket.disconnect(true);
    }
  }, JOIN_TIMEOUT_MS);

  // ── join ──
  socket.on('join', (payload) => {
    clearTimeout(joinTimer);

    // 페이로드 타입 검증
    if (!payload || typeof payload !== 'object') { addViolation(socket, 'join: invalid payload'); return; }
    const { name, team } = payload;
    if (!isSafeStr(name ?? '', 32)) { addViolation(socket, 'join: invalid name'); return; }
    if (!isSafeStr(team ?? '', 10)) { addViolation(socket, 'join: invalid team'); return; }

    const assignedTeam = TEAMS.includes(team) ? team : 'blue';
    const isReconnect  = !!players[socket.id];

    // 재연결 시 위치 유지, 신규 접속만 스폰 위치 지정
    let spawnX, spawnY;
    if (isReconnect) {
      spawnX = players[socket.id].x;
      spawnY = players[socket.id].y;
    } else {
      const sp = spawnPosition(assignedTeam);
      spawnX = sp.x; spawnY = sp.y;
    }

    players[socket.id] = {
      id:              socket.id,
      name:            sanitizeName(name),
      team:            assignedTeam,
      x:               spawnX,
      y:               spawnY,
      lastShot:        0,
      invincibleUntil: Date.now() + INVINCIBLE_MS,
    };

    socket.emit('init', {
      id:            socket.id,
      tiles,
      invincibleMs:  INVINCIBLE_MS,
      players: Object.fromEntries(
        Object.entries(players).map(([id, p]) => [id, sanitizePlayer(p)])
      ),
    });

    socket.broadcast.emit('player_join', sanitizePlayer(players[socket.id]));
    console.log(`${isReconnect?'🔄 재연결':'👤 입장'}: ${players[socket.id].name} (${assignedTeam}) | 총 ${Object.keys(players).length}명`);
  });

  // ── move ──
  socket.on('move', (payload) => {
    const p = players[socket.id];
    if (!p) { addViolation(socket, 'move: no player'); return; }

    // rate limit
    if (!checkRate(socket.id, 'move', MOVE_RATE_LIMIT)) {
      addViolation(socket, 'move: rate limit');
      return;
    }

    // 페이로드 검증
    if (!payload || !isFiniteNum(payload.x) || !isFiniteNum(payload.y)) {
      addViolation(socket, 'move: invalid payload');
      return;
    }

    const maxX = GRID_W * TILE_SIZE - PLAYER_RADIUS;
    const maxY = GRID_H * TILE_SIZE - PLAYER_RADIUS;

    // 텔레포트/스피드핵 방지
    const now = Date.now();
    if (p.lastMoveTime) {
      const elapsed = now - p.lastMoveTime;
      // 경과 시간 기반 최대 허용 거리 (넉넉한 여유값 적용)
      const maxAllowed = MOVE_SPEED * Math.SQRT2 * Math.max(1, elapsed / (1000 / 60)) * 2.5 + 40;
      const dist = Math.hypot(payload.x - p.x, payload.y - p.y);
      if (dist > maxAllowed) {
        // 텔레포트 감지 — violation 없이 위치만 보정 (네트워크 지연 오탐 방지)
        console.warn(`⚠️ teleport 감지 [${socket.id}] dist=${dist.toFixed(0)} max=${maxAllowed.toFixed(0)}`);
        socket.emit('force_position', { x: p.x, y: p.y });
        p.lastMoveTime = now;
        return;
      }
    }
    p.lastMoveTime = now;

    p.x = clamp(payload.x, PLAYER_RADIUS, maxX);
    p.y = clamp(payload.y, PLAYER_RADIUS, maxY);

    const tx = Math.floor(p.x / TILE_SIZE);
    const ty = Math.floor(p.y / TILE_SIZE);
    paintTile(tx, ty, p.team, socket.id);

    socket.broadcast.emit('player_move', { id: socket.id, x: p.x, y: p.y, invincibleUntil: p.invincibleUntil ?? 0 });
  });

  // ── paint_tile ──
  socket.on('paint_tile', (payload) => {
    const p = players[socket.id];
    if (!p) return;

    if (!checkRate(socket.id, 'paint', PAINT_RATE_LIMIT)) {
      addViolation(socket, 'paint_tile: rate limit');
      return;
    }

    if (!payload || !isFiniteNum(payload.x) || !isFiniteNum(payload.y)) {
      addViolation(socket, 'paint_tile: invalid payload');
      return;
    }

    const tx = Math.floor(payload.x);
    const ty = Math.floor(payload.y);
    if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) {
      addViolation(socket, 'paint_tile: out of bounds');
      return;
    }

    // 원격 타일 페인팅 방지: 플레이어 현재 위치 기준 인접 1칸만 허용
    const ptx = Math.floor(p.x / TILE_SIZE);
    const pty = Math.floor(p.y / TILE_SIZE);
    if (Math.abs(tx - ptx) > 1 || Math.abs(ty - pty) > 1) {
      addViolation(socket, `paint_tile: remote paint (${tx},${ty}) player@(${ptx},${pty})`);
      return;
    }

    paintTile(tx, ty, p.team, socket.id);
  });

  // ── shoot ──
  socket.on('shoot', (payload) => {
    const p = players[socket.id];
    if (!p) { addViolation(socket, 'shoot: no player'); return; }

    // rate limit (쿨다운과 이중 방어)
    if (!checkRate(socket.id, 'shoot', SHOOT_RATE_LIMIT)) {
      addViolation(socket, 'shoot: rate limit');
      return;
    }

    // 무적 중 발사 불가
    if (p.invincibleUntil && Date.now() < p.invincibleUntil) return;

    // 쿨다운
    const now = Date.now();
    if (now - p.lastShot < SHOOT_COOLDOWN) return;

    // 페이로드 검증
    if (!payload || !isFiniteNum(payload.dx) || !isFiniteNum(payload.dy)) {
      addViolation(socket, 'shoot: invalid payload');
      return;
    }

    const len = Math.hypot(payload.dx, payload.dy);
    if (len === 0) return;

    p.lastShot = now;
    const ndx = (payload.dx / len) * BULLET_SPEED;
    const ndy = (payload.dy / len) * BULLET_SPEED;

    const id = `b_${bulletIdCounter++}`;
    bullets[id] = {
      id,
      owner:     socket.id,
      team:      p.team,
      x:         p.x,
      y:         p.y,
      dx:        ndx,
      dy:        ndy,
      spawnTime: now,
    };

    io.emit('bullet_spawn', bullets[id]);
  });

  // ── chat ──
  socket.on('chat', (payload) => {
    const p = players[socket.id];
    if (!p) return;

    if (!checkRate(socket.id, 'chat', CHAT_RATE_LIMIT)) {
      addViolation(socket, 'chat: rate limit');
      return;
    }

    if (!payload || !isSafeStr(payload.text ?? '', 200)) {
      addViolation(socket, 'chat: invalid payload');
      return;
    }

    const clean = String(payload.text)
      .replace(CTRL_STRIP_RE, '')  // 제어문자 제거
      .trim()
      .slice(0, 80);
    if (!clean) return;
    io.emit('chat', { id: socket.id, name: p.name, team: p.team, text: clean });
  });

  // ── ping ──
  socket.on('ping_c', () => {
    if (!checkRate(socket.id, 'ping', PING_RATE_LIMIT)) return;
    socket.emit('pong_c');
  });

  // ── disconnect ──
  socket.on('disconnect', () => {
    clearTimeout(joinTimer);

    // IP 접속 수 정리
    const ipSet2 = ipConnections.get(ip);
    if (ipSet2) {
      ipSet2.delete(socket.id);
      if (ipSet2.size === 0) ipConnections.delete(ip);
    }

    // rate limit / violation 정리
    rateLimiters.delete(socket.id);
    const v = violations.get(socket.id);
    if (v) { clearInterval(v.decayTimer); violations.delete(socket.id); }

    const p = players[socket.id];
    if (p) {
      console.log(`👋 ${p.name} 퇴장`);
      io.emit('player_leave', { id: socket.id });
      delete players[socket.id];
    }

    // 해당 플레이어의 총알 제거
    Object.entries(bullets).forEach(([bid, b]) => {
      if (b.owner === socket.id) {
        io.emit('bullet_remove', { id: bid });
        delete bullets[bid];
      }
    });
  });
});

// ── 헬퍼 ─────────────────────────────────────────────
function sanitizePlayer(p) {
  return { id: p.id, name: p.name, team: p.team, x: p.x, y: p.y, invincibleUntil: p.invincibleUntil ?? 0 };
}

// ── 서버 시작 ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎨 colorize.io 서버 실행 중 → http://localhost:${PORT}`);
});

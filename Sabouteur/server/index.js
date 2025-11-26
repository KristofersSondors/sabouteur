import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { v4 as uuid } from 'uuid';
import sqlite3pkg from 'sqlite3';
import { pbkdf2Sync, randomBytes } from 'crypto';
import path from 'path';

const sqlite3 = sqlite3pkg.verbose();
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'saboteur.db');

const db = new sqlite3.Database(DB_PATH);
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => {
  const hash = pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
};
const verifyPassword = (password, salt, hash) => {
  const derived = pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return derived === hash;
};

await run(
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
);
await run(
  `CREATE TABLE IF NOT EXISTS lobbies (
    code TEXT PRIMARY KEY,
    host_id TEXT,
    name TEXT,
    status TEXT,
    capacity INTEGER,
    current_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
);
// Best-effort add missing columns if the table already existed
await run(`ALTER TABLE lobbies ADD COLUMN name TEXT`).catch(() => {});
await run(`ALTER TABLE lobbies ADD COLUMN capacity INTEGER`).catch(() => {});
await run(`ALTER TABLE lobbies ADD COLUMN current_count INTEGER`).catch(() => {});

const PORT = process.env.PORT || 4173;

const CARD_LIBRARY = {
  straight: {
    key: 'straight',
    category: 'path',
    connectors: { north: false, east: true, south: false, west: true },
  },
  straightLong: {
    key: 'straightLong',
    category: 'path',
    connectors: { north: true, east: false, south: true, west: false },
  },
  straightBranchNorth: {
    key: 'straightBranchNorth',
    category: 'path',
    connectors: { north: true, east: true, south: false, west: true },
  },
  straightBranchSouth: {
    key: 'straightBranchSouth',
    category: 'path',
    connectors: { north: false, east: true, south: true, west: true },
  },
  turn: {
    key: 'turn',
    category: 'path',
    connectors: { north: true, east: true, south: false, west: false },
  },
  cross: {
    key: 'cross',
    category: 'path',
    connectors: { north: true, east: true, south: true, west: true },
  },
  tee: {
    key: 'tee',
    category: 'path',
    connectors: { north: true, east: true, south: true, west: false },
  },
  deadendEast: {
    key: 'deadendEast',
    category: 'path',
    connectors: { north: false, east: true, south: false, west: false },
  },
  deadendNorth: {
    key: 'deadendNorth',
    category: 'path',
    connectors: { north: true, east: false, south: false, west: false },
  },
  rockfall: {
    key: 'rockfall',
    category: 'rockfall',
  },
  break: {
    key: 'break',
    category: 'break',
  },
  repair: {
    key: 'repair',
    category: 'repair',
  },
};

const DECK_TEMPLATE = [
  { key: 'straight', quantity: 6 },
  { key: 'straightLong', quantity: 6 },
  { key: 'straightBranchNorth', quantity: 3 },
  { key: 'straightBranchSouth', quantity: 3 },
  { key: 'turn', quantity: 8 },
  { key: 'tee', quantity: 6 },
  { key: 'cross', quantity: 4 },
  { key: 'deadendEast', quantity: 4 },
  { key: 'deadendNorth', quantity: 4 },
  { key: 'rockfall', quantity: 5 },
  { key: 'break', quantity: 4 },
  { key: 'repair', quantity: 6 },
];

const BOARD_ROWS = 7;
const BOARD_COLUMNS = 9;
const ROOM_ID = 'default-room';

const roleDistribution = (count) => {
  const saboteurs = count >= 7 ? 3 : count >= 5 ? 2 : count >= 3 ? 1 : 0;
  const roles = Array(count)
    .fill('miner')
    .map((_, idx) => (idx < saboteurs ? 'saboteur' : 'miner'));
  for (let i = roles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
};

const generateDeck = () => {
  const deck = [];
  DECK_TEMPLATE.forEach(({ key, quantity }) => {
    for (let i = 0; i < quantity; i += 1) {
      deck.push({
        instanceId: uuid(),
        cardKey: key,
        rotation: 0,
      });
    }
  });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const rotateConnectors = (connectors, rotation) => {
  if (!connectors) return undefined;
  const steps = ((rotation % 4) + 4) % 4;
  let current = { ...connectors };
  for (let i = 0; i < steps; i += 1) {
    current = {
      north: current.west,
      east: current.north,
      south: current.east,
      west: current.south,
    };
  }
  return current;
};

const tileId = (row, col) => `${row}-${col}`;

const createBoard = () => {
  const goalRows = [1, 3, 5];
  const goldIndex = Math.floor(Math.random() * goalRows.length);
  const tiles = [];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLUMNS; col += 1) {
      const id = tileId(row, col);
      const tile = {
        id,
        row,
        col,
        tileType: 'empty',
        revealed: false,
      };
      tiles.push(tile);
    }
  }
  const startTile = tiles.find((tile) => tile.row === Math.floor(BOARD_ROWS / 2) && tile.col === 0);
  Object.assign(startTile, {
    tileType: 'start',
    connectors: { north: true, east: true, south: true, west: false },
    revealed: true,
  });
  goalRows.forEach((row, index) => {
    const goalTile = tiles.find((tile) => tile.row === row && tile.col === BOARD_COLUMNS - 1);
    Object.assign(goalTile, {
      tileType: 'goal',
      connectors: { north: true, east: false, south: true, west: true },
      revealed: false,
      cardKey: index === goldIndex ? 'gold' : 'coal',
    });
  });
  return {
    rows: BOARD_ROWS,
    columns: BOARD_COLUMNS,
    tiles,
  };
};

const neighbors = [
  { key: 'north', dr: -1, dc: 0, opposite: 'south' },
  { key: 'south', dr: 1, dc: 0, opposite: 'north' },
  { key: 'east', dr: 0, dc: 1, opposite: 'west' },
  { key: 'west', dr: 0, dc: -1, opposite: 'east' },
];

const findTile = (board, id) => board.tiles.find((tile) => tile.id === id);

const exploreBoard = (board) => {
  const startTile = board.tiles.find((tile) => tile.tileType === 'start');
  const visited = new Set();
  const queue = startTile ? [startTile] : [];
  let farthestCol = startTile ? startTile.col : 0;
  while (queue.length) {
    const tile = queue.shift();
    if (!tile || !tile.connectors || visited.has(tile.id)) continue;
    visited.add(tile.id);
    farthestCol = Math.max(farthestCol, tile.col);
    neighbors.forEach(({ key, dr, dc, opposite }) => {
      if (!tile.connectors[key]) return;
      const neighbor = board.tiles.find((t) => t.row === tile.row + dr && t.col === tile.col + dc);
      if (!neighbor || visited.has(neighbor.id) || !neighbor.connectors) return;
      if (neighbor.connectors[opposite]) {
        queue.push(neighbor);
      }
    });
  }
  return {
    farthestCol,
    visited,
  };
};

class GameRoom {
  constructor(id) {
    this.id = id;
    this.io = null;
    this.board = createBoard();
    this.players = new Map();
    this.deck = generateDeck();
    this.discard = [];
    this.roundEnded = false;
    this.roundNumber = 1;
    this.metrics = {
      deckRemaining: this.deck.length,
      progress: 0,
      collapsedTiles: 0,
      suspicionByPlayer: {},
      turnsTaken: 0,
      goldByPlayer: {},
      round: this.roundNumber,
      efficiencyByPlayer: {},
      activePlayerId: null,
      turnEndsAt: null,
    };
    this.turnIndex = 0;
    this.turnTimer = null;
    this.syncBoardTelemetry();
  }

  insertPlayer(socket, name) {
    const playerCount = this.players.size + 1;
    const roles = roleDistribution(playerCount);
    const role = roles[playerCount - 1];
    const player = {
      id: socket.id,
      socketId: socket.id,
      name: name || `Dwarf-${playerCount}`,
      role,
      position: { x: 0, y: 1.6, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      hand: [],
      connected: true,
      toolBroken: false,
      suspicion: role === 'saboteur' ? 0.5 : 0,
      score: 0,
    };
    this.players.set(socket.id, player);
    this.metrics.suspicionByPlayer[player.id] = player.suspicion;
    this.drawCards(player, 5);
    if (!this.metrics.activePlayerId) {
      this.metrics.activePlayerId = socket.id;
      this.turnIndex = 0;
      this.setTurnTimer();
    }
    run('UPDATE lobbies SET current_count = ? WHERE code = ?', [this.players.size, this.id]).catch(() => {});
    return player;
  }

  drawCards(player, count) {
    for (let i = 0; i < count; i += 1) {
      const card = this.deck.pop();
      if (!card) break;
      player.hand.push(card);
    }
    this.metrics.deckRemaining = this.deck.length;
    this.maybeDeclareSaboteurWin();
    this.maybeFinishRound();
  }

  removePlayer(id) {
    this.players.delete(id);
    delete this.metrics.suspicionByPlayer[id];
    if (this.metrics.activePlayerId === id) {
      this.advanceTurn();
    }
    run('UPDATE lobbies SET current_count = ? WHERE code = ?', [this.players.size, this.id]).catch(() => {});
  }

  updatePlayerPose(id, position, rotation) {
    const player = this.players.get(id);
    if (!player) return;
    player.position = position;
    player.rotation = rotation;
  }

  serializePlayers(requestingId) {
    return [...this.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      role: player.id === requestingId ? player.role : 'unknown',
      position: player.position,
      rotation: player.rotation,
      connected: player.connected,
      toolBroken: player.toolBroken,
      suspicion: this.metrics.suspicionByPlayer[player.id] ?? 0,
      score: player.score,
    }));
  }

  activePlayer() {
    return this.metrics.activePlayerId;
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  setTurnTimer() {
    this.clearTurnTimer();
    if (!this.metrics.activePlayerId) return;
    this.metrics.turnEndsAt = Date.now() + 60000;
    this.turnTimer = setTimeout(() => {
      this.advanceTurn();
    }, 60000);
    if (this.io) {
      this.io.to(this.id).emit('metrics', this.metrics);
    }
  }

  advanceTurn() {
    const ids = [...this.players.keys()];
    if (ids.length === 0) {
      this.metrics.activePlayerId = null;
      this.metrics.turnEndsAt = null;
      this.clearTurnTimer();
      return;
    }
    // ensure turnIndex points to current active
    const currentIdx = ids.indexOf(this.metrics.activePlayerId);
    this.turnIndex = currentIdx >= 0 ? currentIdx : 0;
    this.turnIndex = (this.turnIndex + 1) % ids.length;
    this.metrics.activePlayerId = ids[this.turnIndex];
    this.setTurnTimer();
    if (this.io) {
      this.io.to(this.id).emit('metrics', this.metrics);
    }
  }

  placeCard(playerId, payload) {
    if (this.metrics.activePlayerId && this.metrics.activePlayerId !== playerId) {
      return { error: 'Not your turn' };
    }
    const endedBefore = this.roundEnded;
    const player = this.players.get(playerId);
    if (!player) return { error: 'Unknown player' };
    if (player.toolBroken) return { error: 'Tool broken' };
    const card = player.hand.find((c) => c.instanceId === payload.cardInstanceId);
    if (!card) return { error: 'Card not available' };
    const def = CARD_LIBRARY[card.cardKey];
    if (def.category !== 'path') return { error: 'Not a path card' };
    const tile = findTile(this.board, payload.targetTileId);
    if (!tile || tile.tileType === 'start' || tile.tileType === 'goal') return { error: 'Invalid tile' };
    if (tile.tileType === 'path') return { error: 'Tile already filled' };
    const connectors = rotateConnectors(def.connectors, payload.rotation);
    const prevProgress = this.metrics.progress;
    let hasValidAttachment = false;
    let mismatch = false;
    neighbors.forEach(({ key, dr, dc, opposite }) => {
      const neighbor = this.board.tiles.find((t) => t.row === tile.row + dr && t.col === tile.col + dc);
      if (!neighbor || !neighbor.connectors) return;
      if (connectors[key] && neighbor.connectors[opposite]) {
        hasValidAttachment = true;
      } else if (connectors[key] || neighbor.connectors[opposite]) {
        mismatch = true;
      }
    });
    if (!hasValidAttachment || mismatch) {
      return { error: 'Card does not connect cleanly' };
    }
    Object.assign(tile, {
      tileType: 'path',
      connectors,
      cardKey: card.cardKey,
      rotation: payload.rotation,
      revealed: true,
      ownerId: playerId,
    });
    player.hand = player.hand.filter((c) => c.instanceId !== card.instanceId);
    this.discard.push(card);
    this.metrics.turnsTaken += 1;
    this.metrics.suspicionByPlayer[playerId] = Math.max(
      0,
      (this.metrics.suspicionByPlayer[playerId] ?? 0) - 0.05,
    );
    const deltaProgress = this.metrics.progress - prevProgress;
    this.metrics.efficiencyByPlayer[playerId] = (this.metrics.efficiencyByPlayer[playerId] ?? 0) + deltaProgress;
    this.drawCards(player, 1);
    this.syncBoardTelemetry();
    this.advanceTurn();
    this.maybeFinishRound(playerId);
    const justEnded = !endedBefore && this.roundEnded;
    return { success: true, card, roundEnded: justEnded, placerId: justEnded ? playerId : undefined };
  }

  triggerRockfall(playerId, tileId) {
    if (this.metrics.activePlayerId && this.metrics.activePlayerId !== playerId) {
      return { error: 'Not your turn' };
    }
    const player = this.players.get(playerId);
    if (!player) return { error: 'Unknown player' };
    const card = player.hand.find((c) => c.cardKey === 'rockfall');
    if (!card) return { error: 'No rockfall card' };
    const tile = findTile(this.board, tileId);
    if (!tile || tile.tileType !== 'path') return { error: 'Tile is not a tunnel' };
    Object.assign(tile, {
      tileType: 'blocked',
      connectors: undefined,
      cardKey: undefined,
      rotation: undefined,
    });
    player.hand = player.hand.filter((c) => c.instanceId !== card.instanceId);
    this.metrics.collapsedTiles += 1;
    this.metrics.turnsTaken += 1;
    this.metrics.suspicionByPlayer[playerId] = Math.min(
      1,
      (this.metrics.suspicionByPlayer[playerId] ?? 0) + 0.15,
    );
    this.drawCards(player, 1);
    this.syncBoardTelemetry();
    this.advanceTurn();
    return { success: true };
  }

  applyToolEffect(actorId, { targetPlayerId, cardKey }) {
    if (this.metrics.activePlayerId && this.metrics.activePlayerId !== actorId) {
      return { error: 'Not your turn' };
    }
    const actor = this.players.get(actorId);
    const target = this.players.get(targetPlayerId);
    if (!actor || !target) return { error: 'Players missing' };
    const card = actor.hand.find((c) => c.cardKey === cardKey);
    if (!card) return { error: 'Card missing' };
    if (cardKey === 'break') {
      target.toolBroken = true;
      this.metrics.suspicionByPlayer[actorId] = Math.min(
        1,
        (this.metrics.suspicionByPlayer[actorId] ?? 0) + 0.12,
      );
    } else {
      target.toolBroken = false;
      this.metrics.suspicionByPlayer[actorId] = Math.max(
        0,
        (this.metrics.suspicionByPlayer[actorId] ?? 0) - 0.04,
      );
    }
    actor.hand = actor.hand.filter((c) => c.instanceId !== card.instanceId);
    this.drawCards(actor, 1);
    this.metrics.turnsTaken += 1;
    this.advanceTurn();
    return { success: true };
  }

  syncBoardTelemetry() {
    const { farthestCol, visited } = exploreBoard(this.board);
    this.metrics.progress = farthestCol / (BOARD_COLUMNS - 1);
    const goalTiles = this.board.tiles.filter((tile) => tile.tileType === 'goal');
    goalTiles.forEach((goal) => {
      if (visited.has(goal.id)) {
        goal.revealed = true;
        if (goal.cardKey === 'gold') {
          this.board.winningTeam = 'miner';
        }
      }
    });
    this.maybeDeclareSaboteurWin();
    this.metrics.deckRemaining = this.deck.length;
  }

  maybeDeclareSaboteurWin() {
    if (!this.board.winningTeam && this.metrics.deckRemaining === 0) {
      this.board.winningTeam = 'saboteur';
    }
  }

  applyRoundRewards(placerId) {
    const goldByPlayer = { ...this.metrics.goldByPlayer };
    const playersArr = [...this.players.values()];
    const miners = playersArr.filter((p) => p.role === 'miner');
    const sabos = playersArr.filter((p) => p.role === 'saboteur');
    let awards = {};
    let winners = [];
    if (this.board.winningTeam === 'miner') {
      // Simulate nugget cards (value 1-3) equal to player count, distributed starting at placer
      const nuggetCards = Array.from({ length: playersArr.length }, () => 1 + Math.floor(Math.random() * 3));
      let order = miners;
      if (placerId) {
        const startIdx = miners.findIndex((m) => m.id === placerId);
        if (startIdx >= 0) {
          order = [...miners.slice(startIdx), ...miners.slice(0, startIdx)];
        }
      }
      nuggetCards.forEach((value, idx) => {
        const miner = order[idx % order.length];
        miner.score = (miner.score || 0) + value;
        goldByPlayer[miner.id] = (goldByPlayer[miner.id] || 0) + value;
        awards[miner.id] = (awards[miner.id] || 0) + value;
      });
      winners = order.map((p) => p.id);
    } else if (this.board.winningTeam === 'saboteur') {
      let award = 0;
      if (sabos.length === 1) award = 4;
      else if (sabos.length === 2 || sabos.length === 3) award = 3;
      else award = 2;
      sabos.forEach((s) => {
        s.score = (s.score || 0) + award;
        goldByPlayer[s.id] = (goldByPlayer[s.id] || 0) + award;
        awards[s.id] = (awards[s.id] || 0) + award;
      });
      winners = sabos.map((p) => p.id);
    }
    this.metrics.goldByPlayer = goldByPlayer;
    return { awards, winners };
  }

  maybeFinishRound(placerId) {
    if (this.roundEnded) return;
    if (this.board.winningTeam) {
      this.roundEnded = true;
      this.lastWinnerId = placerId;
      const res = this.applyRoundRewards(placerId);
      this.lastAwards = res.awards;
      this.lastWinners = res.winners;
      this.lastWinningTeam = this.board.winningTeam;
    }
  }

  resetRoom() {
    // Recreate board, deck, discard, metrics
    this.board = createBoard();
    this.deck = generateDeck();
    this.discard = [];
    this.roundEnded = false;
    this.roundNumber += 1;
    this.lastAwards = {};
    this.lastWinnerId = undefined;
    this.lastWinningTeam = undefined;
    this.metrics = {
      deckRemaining: this.deck.length,
      progress: 0,
      collapsedTiles: 0,
      suspicionByPlayer: {},
      turnsTaken: 0,
      goldByPlayer: { ...this.metrics.goldByPlayer },
      round: this.roundNumber,
      efficiencyByPlayer: {},
      activePlayerId: null,
      turnEndsAt: null,
    };
    this.clearTurnTimer();
    this.turnIndex = 0;

    // Reassign roles and reset players
    const roles = roleDistribution(this.players.size);
    [...this.players.values()].forEach((player, idx) => {
      const role = roles[idx];
      const prevScore = player.score || 0;
      Object.assign(player, {
        role,
        position: { x: 0, y: 1.6, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        hand: [],
        connected: true,
        toolBroken: false,
        suspicion: role === 'saboteur' ? 0.5 : 0,
        score: prevScore,
      });
      this.metrics.suspicionByPlayer[player.id] = player.suspicion;
      this.drawCards(player, 5);
    });

    // Set active player to first in list if any
    const ids = [...this.players.keys()];
    if (ids.length > 0) {
      this.metrics.activePlayerId = ids[0];
      this.setTurnTimer();
    }

    this.syncBoardTelemetry();
  }
}

const app = express();
app.use(express.json());
// CORS for REST endpoints (client runs on a different port)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const rooms = new Map();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, password } = req.body || {};
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    const existing = await get('SELECT id FROM users WHERE name = ?', [name]);
    if (existing) return res.status(409).json({ error: 'name already taken' });
    const userId = uuid();
    const { salt, hash } = hashPassword(password);
    await run('INSERT INTO users (id, name, password_hash, password_salt, created_at) VALUES (?,?,?,?,?)', [
      userId,
      name,
      hash,
      salt,
      Date.now(),
    ]);
    return res.json({ userId, name });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'failed to register' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { name, password } = req.body || {};
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    const user = await get('SELECT id, password_hash, password_salt FROM users WHERE name = ?', [name]);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    if (!verifyPassword(password, user.password_salt, user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    return res.json({ userId: user.id, name });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'failed to login' });
  }
});

app.get('/api/lobbies', async (_req, res) => {
  try {
    const rows = await all(
      'SELECT code, host_id as hostId, name, status, capacity, current_count as currentCount, created_at as createdAt FROM lobbies',
    );
    res.json(rows);
  } catch (err) {
    console.error('lobbies list error', err);
    res.status(500).json({ error: 'failed to list lobbies' });
  }
});

app.post('/api/lobbies', async (req, res) => {
  try {
    const { name = 'Lobby', hostId = null, capacity = 6 } = req.body || {};
    const code = uuid().slice(0, 6);
    await run('INSERT INTO lobbies (code, host_id, name, status, capacity, current_count, created_at) VALUES (?,?,?,?,?,?,?)', [
      code,
      hostId,
      name,
      'open',
      capacity,
      0,
      Date.now(),
    ]);
    res.json({ code, hostId, name, capacity, currentCount: 0, status: 'open', createdAt: Date.now() });
  } catch (err) {
    console.error('create lobby error', err);
    res.status(500).json({ error: 'failed to create lobby' });
  }
});

io.on('connection', (socket) => {
  console.log(`Client connected ${socket.id}`);

  socket.on('ready', async (name, roomCode = ROOM_ID, userId = null) => {
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, new GameRoom(roomCode));
      rooms.get(roomCode).io = io;
    }
    const room = rooms.get(roomCode);
    const player = room.insertPlayer(socket, name);
    const payload = {
      playerId: player.id,
      role: player.role,
      board: room.board,
      players: room.serializePlayers(player.id),
      hand: player.hand,
      metrics: room.metrics,
      roomCode,
    };
    socket.emit('welcome', payload);
    try {
      await run(
        'INSERT INTO lobbies (code, host_id, name, status, created_at) VALUES (?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET status=excluded.status, host_id=COALESCE(lobbies.host_id, excluded.host_id), name=COALESCE(lobbies.name, excluded.name)',
        [roomCode, userId || socket.id, name || 'Lobby', 'open', Date.now()],
      );
    } catch (err) {
      console.error('lobby upsert failed', err);
    }
    socket.to(roomCode).emit('playerJoined', {
      id: player.id,
      name: player.name,
      role: 'unknown',
      position: player.position,
      rotation: player.rotation,
      connected: true,
      toolBroken: player.toolBroken,
      suspicion: room.metrics.suspicionByPlayer[player.id] ?? 0,
      score: player.score,
    });
    socket.join(roomCode);
  });

  socket.on('playerMove', (position, rotation) => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    room.updatePlayerPose(socket.id, position, rotation);
    socket.to(roomCode).emit('playerMoved', {
      id: socket.id,
      position,
      rotation,
    });
  });

  socket.on('placeCard', (payload) => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const result = room.placeCard(socket.id, payload);
    if (result.success) {
      io.to(roomCode).emit('boardUpdated', room.board);
      socket.emit('handUpdated', room.players.get(socket.id).hand);
      io.to(roomCode).emit('metrics', room.metrics);
      if (result.roundEnded) {
        io.to(roomCode).emit('players', room.serializePlayers());
        io.to(roomCode).emit('roundEnded', {
          team: room.lastWinningTeam ?? room.board.winningTeam,
          awards: room.lastAwards || {},
          placerId: room.lastWinnerId,
          round: room.roundNumber,
          winners: room.lastWinners || [],
        });
        run('UPDATE lobbies SET status = ? WHERE code = ?', ['finished', roomCode]).catch((err) =>
          console.error('lobby finish update failed', err),
        );
      }
    } else {
      socket.emit('newChat', {
        id: uuid(),
        from: 'Server',
        body: result.error,
        createdAt: Date.now(),
      });
    }
  });

  socket.on('rockfall', (payload) => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const result = room.triggerRockfall(socket.id, payload.targetTileId);
    if (result.success) {
      io.to(roomCode).emit('boardUpdated', room.board);
      socket.emit('handUpdated', room.players.get(socket.id).hand);
      io.to(roomCode).emit('metrics', room.metrics);
    }
  });

  socket.on('toolEffect', (payload) => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const result = room.applyToolEffect(socket.id, payload);
    if (result.success) {
      io.to(roomCode).emit('players', room.serializePlayers());
      io.to(roomCode).emit('boardUpdated', room.board);
      socket.emit('handUpdated', room.players.get(socket.id).hand);
      io.to(roomCode).emit('metrics', room.metrics);
    }
  });

  socket.on('sendChat', (text) => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const player = room.players.get(socket.id);
    if (!player) return;
    const message = {
      id: uuid(),
      from: player.name,
      body: text,
      createdAt: Date.now(),
    };
    io.to(roomCode).emit('newChat', message);
  });

  socket.on('requestHand', () => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const player = room.players.get(socket.id);
    if (!player) return;
    socket.emit('handUpdated', player.hand);
  });

  socket.on('rtcOffer', ({ to, description }) => {
    io.to(to).emit('rtcOffer', { from: socket.id, description });
  });
  socket.on('rtcAnswer', ({ to, description }) => {
    io.to(to).emit('rtcAnswer', { from: socket.id, description });
  });
  socket.on('rtcCandidate', ({ to, candidate }) => {
    io.to(to).emit('rtcCandidate', { from: socket.id, candidate });
  });

  socket.on('restart', () => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    room.resetRoom();
    io.to(roomCode).emit('players', room.serializePlayers());
    io.to(roomCode).emit('boardUpdated', room.board);
    io.to(roomCode).emit('metrics', room.metrics);
    room.players.forEach((player) => {
      io.to(player.socketId).emit('handUpdated', player.hand);
    });
    run('UPDATE lobbies SET status = ? WHERE code = ?', ['open', roomCode]).catch((err) =>
      console.error('lobby restart update failed', err),
    );
  });

  socket.on('disconnect', () => {
    const roomCode = [...socket.rooms].find((r) => rooms.has(r));
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const wasHost = room.players.has(socket.id) && room.id === roomCode && room.players.size > 0 && socket.id === [...room.players.keys()][0];
    room.removePlayer(socket.id);
    socket.to(roomCode).emit('playerLeft', socket.id);
    io.to(roomCode).emit('metrics', room.metrics);
    if (room.players.size === 0 || wasHost) {
      rooms.delete(roomCode);
      run('DELETE FROM lobbies WHERE code = ?', [roomCode]).catch((err) =>
        console.error('cleanup lobby failed', err),
      );
    } else {
      run('UPDATE lobbies SET current_count = ? WHERE code = ?', [room.players.size, roomCode]).catch((err) =>
        console.error('cleanup lobby count failed', err),
      );
    }
    console.log(`Client disconnected ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Sabouteur server listening on http://localhost:${PORT}`);
});

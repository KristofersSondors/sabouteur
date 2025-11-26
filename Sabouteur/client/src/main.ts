import './style.css';
import { initGameScene } from './game/scene';
import {
  connectToServer,
  registerPeerHooks,
  emitCardPlacement,
  emitRockfall,
  emitToolEffect,
  emitChat,
  emitRestart,
} from './net/client';
import type { BoardTile } from './net/types';
import type { Role } from './game/cards';
import { useGameStore } from './state/store';
import { createHandPanel } from './ui/handPanel';
import { createHUD } from './ui/hud';
import { createVisualizationPanel } from './ui/visualization';
import { CARD_LIBRARY } from './game/cards';
import { createProximityChat } from './audio/proximityChat';
import type { ProximityChat } from './audio/proximityChat';
import type { PlayerStateSnapshot } from './net/types';

type Profile = { name: string; avatar?: string; email?: string };
type Account = Profile & { password?: string };

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) {
  throw new Error('Missing #app root');
}
// Hide game view until player joins
mount.style.display = 'none';
const uiElements: HTMLElement[] = [];

const scene = initGameScene();
scene.mount(mount);

const hud = createHUD();
hud.element.style.display = 'none';
uiElements.push(hud.element);
document.body.appendChild(hud.element);

const vizPanel = createVisualizationPanel();
vizPanel.element.style.display = 'none';
uiElements.push(vizPanel.element);
document.body.appendChild(vizPanel.element);

// Leaderboard panel
const leaderboard = document.createElement('section');
leaderboard.className = 'leaderboard-panel';
leaderboard.style.display = 'none';
uiElements.push(leaderboard);
document.body.appendChild(leaderboard);

const renderLeaderboard = (players: Record<string, PlayerStateSnapshot>, metrics: any) => {
  const entries = Object.values(players).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
  leaderboard.innerHTML = `
    <h3>Leaderboard</h3>
    <ul>
      ${entries
        .map(
          (p, idx) =>
            `<li><span class="rank">${idx + 1}</span> ${p.name} <span class="score">${(metrics?.goldByPlayer?.[p.id] ?? p.score ?? 0).toFixed(
              0,
            )} gold</span></li>`,
        )
        .join('') || '<li>No players</li>'}
    </ul>
  `;
};

const handPanel = createHandPanel({
  onSelect: (card, rotation) => {
    useGameStore.getState().selectCard(card);
    scene.setPreviewSelection(card, rotation);
  },
  onRotate: (rotation) => {
    const selection = handPanel.getSelection();
    if (selection.card) {
      scene.setPreviewSelection(selection.card, rotation);
    }
  },
});
handPanel.element.style.display = 'none';
uiElements.push(handPanel.element);
document.body.appendChild(handPanel.element);

const victoryBanner = document.createElement('div');
victoryBanner.className = 'victory-banner hidden';
victoryBanner.style.display = 'none';
document.body.appendChild(victoryBanner);

const gearButton = document.createElement('button');
gearButton.className = 'gear-button';
gearButton.type = 'button';
gearButton.innerHTML = '⚙️';
gearButton.style.display = 'none';
uiElements.push(gearButton);
document.body.appendChild(gearButton);

const turnTimer = document.createElement('div');
turnTimer.className = 'turn-timer';
turnTimer.style.display = 'none';
document.body.appendChild(turnTimer);

const modal = document.createElement('div');
modal.className = 'confirm-modal hidden';
modal.innerHTML = `
  <div class="confirm-card">
    <h3>Exit to Main Menu?</h3>
    <p>You will leave the lobby and return to the dashboard.</p>
    <div class="button-row">
      <button class="btn secondary" id="cancel-exit">Cancel</button>
      <button class="btn primary" id="confirm-exit">Confirm</button>
    </div>
  </div>
`;
modal.style.display = 'none';
document.body.appendChild(modal);

gearButton.addEventListener('click', () => {
  modal.classList.remove('hidden');
  modal.style.display = 'grid';
});

modal.querySelector<HTMLButtonElement>('#cancel-exit')?.addEventListener('click', () => {
  modal.classList.add('hidden');
  modal.style.display = 'none';
});

const resetToIntro = () => {
  modal.classList.add('hidden');
  modal.style.display = 'none';
  // Hide game UI
  mount.style.display = 'none';
  uiElements.forEach((el) => {
    // eslint-disable-next-line no-param-reassign
    el.style.display = 'none';
  });
  victoryBanner.style.display = 'none';
  introOverlay.classList.remove('hidden');
  introOverlay.style.display = 'grid';
};

modal.querySelector<HTMLButtonElement>('#confirm-exit')?.addEventListener('click', () => {
  resetToIntro();
});

const restartButton = document.createElement('button');
restartButton.className = 'restart-button';
restartButton.type = 'button';
restartButton.textContent = 'Restart';
restartButton.title = 'Restart the client and reconnect';
restartButton.addEventListener('click', () => {
  emitRestart();
});
restartButton.style.display = 'none';
uiElements.push(restartButton);
document.body.appendChild(restartButton);

hud.attachChatHandler((text) => emitChat(text));

let proximityChat: ProximityChat | undefined;
const pendingAudioPeers = new Set<string>();
registerPeerHooks({
  onJoin: (playerId) => {
    if (proximityChat?.enabled) {
      proximityChat.connectTo(playerId);
    } else {
      pendingAudioPeers.add(playerId);
    }
  },
  onLeave: (playerId) => {
    proximityChat?.disconnectFrom(playerId);
    pendingAudioPeers.delete(playerId);
  },
  onChat: (message) => {
    hud.appendChat(message);
    hud.pushLog(`${message.from}: ${message.body}`);
  },
});

const startProximityChat = async () => {
  proximityChat = await createProximityChat();
  if (proximityChat.enabled) {
    pendingAudioPeers.forEach((id) => proximityChat?.connectTo(id));
    pendingAudioPeers.clear();
  }
};

useGameStore.subscribe((state, previous) => {
  if (state.role !== previous?.role) {
    hud.setRole(state.role);
  }
  if (state.board !== previous?.board) {
    scene.setBoard(state.board);
  }
  if (state.players !== previous?.players) {
    void scene.setPlayers(state.players);
    hud.updatePlayers(state.players, state.playerId);
  vizPanel.update(state.metrics, state.players);
    renderLeaderboard(state.players, state.metrics);
    scene.updateWallBoards(state.metrics, state.players);
  }
  if (state.metrics !== previous?.metrics) {
    hud.setMetrics(state.metrics);
    vizPanel.update(state.metrics, state.players);
    renderLeaderboard(state.players, state.metrics);
    scene.updateWallBoards(state.metrics, state.players);
    scene.setActivePlayer(state.metrics?.activePlayerId);
    const end = state.metrics?.turnEndsAt ?? 0;
    if (end > 0) {
      turnTimer.dataset.end = `${end}`;
    } else {
      delete turnTimer.dataset.end;
      turnTimer.textContent = '';
    }
  }
  if (state.hand !== previous?.hand) {
    handPanel.setHand(state.hand);
  }
  const prevWinner = previous?.board?.winningTeam;
  const currentWinner = state.board?.winningTeam;
  if (prevWinner !== currentWinner) {
    if (currentWinner) {
      const message = winnerMessage(currentWinner);
      victoryBanner.textContent = message;
      victoryBanner.classList.remove('hidden');
      hud.pushLog(message);
    } else {
      victoryBanner.classList.add('hidden');
      victoryBanner.textContent = '';
    }
  }
});

const handleTileClick = (tile: BoardTile) => {
  const { card, rotation } = handPanel.getSelection();
  if (!card) return;
  const cardDefinition = CARD_LIBRARY[card.cardKey];
  if (cardDefinition.category === 'path') {
    emitCardPlacement({
      cardInstanceId: card.instanceId,
      cardKey: card.cardKey,
      rotation,
      targetTileId: tile.id,
    });
    hud.pushLog(`Placed ${cardDefinition.label} at (${tile.row}, ${tile.col})`);
  } else if (cardDefinition.category === 'rockfall') {
    emitRockfall({ targetTileId: tile.id });
    hud.pushLog(`Called rockfall at (${tile.row}, ${tile.col})`);
    handPanel.clearSelection();
  }
};

scene.onTileClick(handleTileClick);

hud.onTargetChange((targetId) => {
  const selection = handPanel.getSelection();
  const card = selection.card;
  if (!targetId || !card) return;
  const def = CARD_LIBRARY[card.cardKey];
  if (def.category === 'break' || def.category === 'repair') {
    const accepted = confirm(`Use ${def.label} on this player?`);
    if (accepted) {
      emitToolEffect({ targetPlayerId: targetId, cardKey: def.key as 'break' | 'repair' });
      hud.pushLog(`${def.label} applied to ${targetId}`);
      handPanel.clearSelection();
    }
  }
});

const scheduleVolumeUpdates = () => {
  proximityChat?.updateVolumes(useGameStore.getState().players);
  requestAnimationFrame(scheduleVolumeUpdates);
};
scheduleVolumeUpdates();

// Turn timer tick
const tickTimer = () => {
  const end = turnTimer.dataset.end ? Number(turnTimer.dataset.end) : 0;
  if (end > 0) {
    const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    turnTimer.textContent = remaining > 0 ? `Turn: ${remaining}s` : 'Turn: 0s';
    turnTimer.style.display = '';
  } else {
    turnTimer.textContent = '';
    turnTimer.style.display = 'none';
  }
  requestAnimationFrame(tickTimer);
};
tickTimer();

// Periodically refresh lobby list while intro is visible
let lobbyPollHandle: number | undefined;
const ensureLobbyPolling = (overlay: HTMLElement) => {
  if (lobbyPollHandle) return;
  const poll = () => {
    if (overlay.classList.contains('hidden')) {
      lobbyPollHandle = undefined;
      return;
    }
    renderLobbyList();
    lobbyPollHandle = window.setTimeout(poll, 3000);
  };
  poll();
};

const roundModal = document.createElement('div');
roundModal.className = 'confirm-modal hidden';
roundModal.innerHTML = `
  <div class="confirm-card">
    <h3 id="round-title">Round Ended</h3>
    <p id="round-body"></p>
    <div id="round-awards"></div>
    <div class="button-row">
      <button class="btn primary" id="round-close">Close</button>
    </div>
  </div>
`;
roundModal.style.display = 'none';
document.body.appendChild(roundModal);
roundModal.querySelector<HTMLButtonElement>('#round-close')?.addEventListener('click', () => {
  roundModal.classList.add('hidden');
  roundModal.style.display = 'none';
});

window.addEventListener('round-ended', (e: any) => {
  const detail = e.detail as { team?: Role; awards: Record<string, number>; placerId?: string; round: number; winners: string[] };
  const title = roundModal.querySelector<HTMLElement>('#round-title');
  const body = roundModal.querySelector<HTMLElement>('#round-body');
  const awardsList = roundModal.querySelector<HTMLElement>('#round-awards');
  if (title) title.textContent = detail.team === 'miner' ? 'Miners found the gold!' : 'Saboteurs win the round';
  if (body) body.textContent = `Round ${detail.round} complete.`;
  if (awardsList) {
    const players = useGameStore.getState().players;
    awardsList.innerHTML = Object.entries(detail.awards)
      .map(([pid, amt]) => `<p>${players[pid]?.name ?? pid}: +${amt} gold</p>`)
      .join('') || '<p>No rewards.</p>';
  }
  roundModal.classList.remove('hidden');
  roundModal.style.display = 'grid';
});

// Host/anyone can start next round after modal
const nextRoundBtn = document.createElement('button');
nextRoundBtn.className = 'btn primary';
nextRoundBtn.textContent = 'Start Next Round';
nextRoundBtn.addEventListener('click', () => {
  emitRestart();
  roundModal.classList.add('hidden');
  roundModal.style.display = 'none';
});
roundModal.querySelector('.button-row')?.appendChild(nextRoundBtn);

// Lobby/dashboard UI
const introOverlay = document.createElement('div');
introOverlay.className = 'intro-overlay';
introOverlay.innerHTML = `
  <div class="intro-card">
    <div class="intro-hero">
      <p class="eyebrow">Welcome to</p>
      <h1>Saboteur Online</h1>
      <p class="lede">Jump into a shared mine, trade suspicion, and race for gold.</p>
    </div>
    <div class="intro-actions">
      <label class="field">
        <span>Display name</span>
        <input type="text" id="player-name" placeholder="Dwarf-317" />
      </label>
      <label class="field">
        <span>Lobby size (4-10)</span>
        <select id="lobby-size">
          ${[4,5,6,7,8,9,10].map((n) => `<option value="${n}">${n} players</option>`).join('')}
        </select>
      </label>
      <div class="button-row">
        <button class="btn primary" id="join-btn">Join Game</button>
        <button class="btn ghost" id="host-btn">Create Lobby</button>
      </div>
      <div class="button-row">
        <button class="btn secondary" id="invite-btn">Copy Invite Link</button>
        <button class="btn primary" id="start-btn">Start Game</button>
      </div>
      <div class="lobby-section">
        <h3>Available Lobbies</h3>
        <div class="lobby-list" id="lobby-list"></div>
      </div>
      <p class="muted" id="invite-hint">Lobbies are local for now; share the link and pick one to join.</p>
      <p class="muted" id="status-hint"></p>
    </div>
  </div>
`;
document.body.appendChild(introOverlay);

type Lobby = { code: string; name: string; hostId?: string; status?: string; createdAt?: number; capacity?: number; currentCount?: number };

const API_BASE = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4173';
const CLIENT_ID_KEY = 'saboteur-client-id';
const clientId = (() => {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const v = `client-${crypto.randomUUID?.() ?? Math.floor(Math.random() * 1e6)}`;
  localStorage.setItem(CLIENT_ID_KEY, v);
  return v;
})();

const fetchLobbies = async (): Promise<Lobby[]> => {
  try {
    const res = await fetch(`${API_BASE}/api/lobbies`);
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as Lobby[];
  } catch (err) {
    console.warn('Failed to fetch lobbies', err);
    return [];
  }
};

const createLobby = async (name: string, capacity: number): Promise<Lobby | null> => {
  try {
    const res = await fetch(`${API_BASE}/api/lobbies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, capacity, hostId: clientId }),
    });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as Lobby;
  } catch (err) {
    console.warn('Failed to create lobby', err);
    return null;
  }
};

const renderLobbyList = () => {
  const list = introOverlay.querySelector<HTMLElement>('#lobby-list');
  if (!list) return;
  list.innerHTML = '<p class="muted">Loading lobbies...</p>';
  void fetchLobbies().then((lobbies) => {
    list.innerHTML = '';
    if (lobbies.length === 0) {
      list.innerHTML = '<p class="muted">No lobbies yet. Create one to get started.</p>';
      return;
    }
    lobbies.forEach((lobby) => {
      const card = document.createElement('div');
      card.className = 'lobby-card';
      card.innerHTML = `
        <div class="lobby-name">${lobby.name ?? lobby.code}</div>
        <div class="lobby-host">Code: ${lobby.code}</div>
        <div class="lobby-meta">Players: ${lobby.currentCount ?? 0} / ${lobby.capacity ?? 6} • Status: ${lobby.status ?? 'open'}</div>
        <button class="btn primary">Join</button>
      `;
      card.querySelector('button')?.addEventListener('click', () => {
        currentLobby = lobby;
        desiredRoom = lobby.code;
        isHost = lobby.hostId === clientId;
        const status = introOverlay.querySelector<HTMLElement>('#status-hint');
        if (status) status.textContent = `Selected lobby ${lobby.code}. Press Start Game to enter.`;
        void startGame();
      });
      list.appendChild(card);
    });
  });
};

// start polling once lobbies can be rendered
ensureLobbyPolling(introOverlay);

const loadProfile = (): Profile | undefined => {
  try {
    const raw = localStorage.getItem('saboteur-profile');
    if (raw) return JSON.parse(raw) as Profile;
    const legacy = localStorage.getItem('saboteur-name');
    if (legacy) return { name: legacy };
  } catch {
    /* ignore */
  }
  return undefined;
};

const saveProfile = (profile: Profile) => {
  localStorage.setItem('saboteur-profile', JSON.stringify(profile));
  localStorage.setItem('saboteur-name', profile.name);
};

const loadAccount = (): Account | undefined => {
  try {
    const raw = localStorage.getItem('saboteur-account');
    if (raw) return JSON.parse(raw) as Account;
  } catch {
    /* ignore */
  }
  return undefined;
};

const saveAccount = (account: Account) => {
  localStorage.setItem('saboteur-account', JSON.stringify(account));
  saveProfile(account);
};

const profileName = () => loadProfile()?.name ?? 'Dwarf-317';

let currentLobby: Lobby | undefined;
let gameStarted = false;
let accountCreated = !!loadAccount();
let desiredRoom = 'default-room';
const clearLegacyLobbies = () => localStorage.removeItem('saboteur-lobbies');
clearLegacyLobbies();
let isHost = false;

const showGameUI = () => {
  mount.style.display = 'block';
  uiElements.forEach((el) => {
    // eslint-disable-next-line no-param-reassign
    el.style.display = '';
  });
  victoryBanner.style.display = '';
};

const bootstrap = async () => {
  try {
    await connectToServer();
    hud.pushLog('Connected to Saboteur server.');
  } catch (error) {
    hud.pushLog('Connection failed – please start the backend server.');
    console.error(error);
  }
};

const startGame = async () => {
  if (gameStarted) return;
  gameStarted = true;
  const nameInput = introOverlay.querySelector<HTMLInputElement>('#player-name');
  const chosenName = nameInput?.value.trim() || profileName();
  if (chosenName) {
    saveProfile({ ...(loadProfile() ?? {}), name: chosenName });
  }
  introOverlay.classList.add('hidden');
  showGameUI();
  turnTimer.style.display = '';
  await startProximityChat();
  await connectToServer(desiredRoom, clientId, chosenName);
  hud.pushLog('Connected to Saboteur server.');
};

introOverlay.querySelector<HTMLButtonElement>('#join-btn')?.addEventListener('click', () => {
  desiredRoom = 'default-room';
  renderLobbyList();
  const status = introOverlay.querySelector<HTMLElement>('#status-hint');
  if (status) status.textContent = 'Pick a lobby below or create one.';
});
introOverlay.querySelector<HTMLButtonElement>('#start-btn')?.addEventListener('click', () => {
  if (currentLobby && currentLobby.hostId && currentLobby.hostId !== clientId) {
    const hint = introOverlay.querySelector<HTMLElement>('#invite-hint');
    if (hint) hint.textContent = 'Waiting for host to start.';
    const status = introOverlay.querySelector<HTMLElement>('#status-hint');
    if (status) status.textContent = 'Only the host can start this lobby.';
    return;
  }
  void startGame();
});
introOverlay.querySelector<HTMLButtonElement>('#host-btn')?.addEventListener('click', () => {
  const nameInput = introOverlay.querySelector<HTMLInputElement>('#player-name');
  const chosenName = nameInput?.value.trim() || profileName();
  if (chosenName) localStorage.setItem('saboteur-name', chosenName);
  const lobbyName = `Lobby by ${chosenName}`;
  const sizeSelect = introOverlay.querySelector<HTMLSelectElement>('#lobby-size');
  const capacity = sizeSelect ? Number(sizeSelect.value) || 4 : 4;
  void createLobby(lobbyName, capacity).then((lobby) => {
    if (lobby) {
      currentLobby = lobby;
      desiredRoom = lobby.code;
      isHost = lobby.hostId === clientId || !lobby.hostId;
      renderLobbyList();
      // host must click Start Game to actually begin
      const hint = introOverlay.querySelector<HTMLElement>('#invite-hint');
      if (hint) hint.textContent = `Lobby ${lobby.code} created (${capacity} players). Press Start Game when ready.`;
      const status = introOverlay.querySelector<HTMLElement>('#status-hint');
      if (status) status.textContent = `Lobby created. Waiting for players... (${lobby.currentCount ?? 0}/${capacity})`;
    } else {
      const status = introOverlay.querySelector<HTMLElement>('#status-hint');
      if (status) status.textContent = 'Failed to create lobby. Make sure the server is running.';
    }
  });
});
introOverlay.querySelector<HTMLButtonElement>('#invite-btn')?.addEventListener('click', async () => {
  const hint = introOverlay.querySelector<HTMLElement>('#invite-hint');
  try {
    await navigator.clipboard.writeText(window.location.href);
    if (hint) hint.textContent = 'Link copied — share it with friends!';
  } catch (err) {
    if (hint) hint.textContent = 'Copy failed; share this URL manually.';
    console.warn('Clipboard copy failed', err);
  }
});

// Auto-fill name from storage
const nameField = document.querySelector<HTMLInputElement>('#player-name');
const storedProfile = loadProfile();
if (nameField && storedProfile?.name) nameField.value = storedProfile.name;

// Account creation overlay (shown if no profile)
if (!accountCreated) {
  const accountOverlay = document.createElement('div');
  accountOverlay.className = 'account-overlay';
  accountOverlay.innerHTML = `
    <div class="intro-card">
      <div class="intro-hero">
        <p class="eyebrow">Create Account</p>
        <h1>Your Saboteur Profile</h1>
        <p class="lede">Choose a display name and an optional avatar URL.</p>
      </div>
      <div class="intro-actions">
        <label class="field">
          <span>Display name</span>
          <input type="text" id="acct-name" placeholder="Dwarf-317" />
        </label>
        <label class="field">
          <span>Avatar URL (optional)</span>
          <input type="text" id="acct-avatar" placeholder="https://..." />
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" id="acct-pass" placeholder="********" />
        </label>
        <label class="field">
          <span>Confirm Password</span>
          <input type="password" id="acct-pass2" placeholder="********" />
        </label>
        <div class="button-row">
          <button class="btn primary" id="acct-save">Create Profile</button>
          <button class="btn ghost" id="acct-login">Already have an account? Login</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(accountOverlay);
  const acctName = accountOverlay.querySelector<HTMLInputElement>('#acct-name');
  const acctAvatar = accountOverlay.querySelector<HTMLInputElement>('#acct-avatar');
  const acctPass = accountOverlay.querySelector<HTMLInputElement>('#acct-pass');
  const acctPass2 = accountOverlay.querySelector<HTMLInputElement>('#acct-pass2');
  const acctLogin = accountOverlay.querySelector<HTMLButtonElement>('#acct-login');
  acctName?.focus();
  accountOverlay.querySelector<HTMLButtonElement>('#acct-save')?.addEventListener('click', () => {
    const nameVal = acctName?.value.trim();
    const avatarVal = acctAvatar?.value.trim();
    const passVal = acctPass?.value ?? '';
    const passVal2 = acctPass2?.value ?? '';
    if (!nameVal) return alert('Please enter a display name');
    if (!passVal) return alert('Please enter a password');
    if (passVal !== passVal2) return alert('Passwords do not match');
    saveAccount({ name: nameVal, avatar: avatarVal || undefined, password: passVal });
    if (nameField) nameField.value = nameVal;
    accountCreated = true;
    accountOverlay.remove();
  });
  acctLogin?.addEventListener('click', () => {
    const existing = loadAccount();
    if (!existing) {
      alert('No account found. Create one first.');
      return;
    }
    const passVal = acctPass?.value ?? '';
    if (existing.password && passVal !== existing.password) {
      alert('Incorrect password');
      return;
    }
    if (nameField) nameField.value = existing.name;
    accountCreated = true;
    accountOverlay.remove();
  });
}

function winnerMessage(team: Role) {
  return team === 'miner' ? 'Miners located the gold vein! Mission success.' : 'Saboteurs collapsed the mine. Retreat!';
}

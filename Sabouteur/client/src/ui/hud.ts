import type { Role } from '../game/cards';
import type { PlayerStateSnapshot, SocketChatMessage, VisualizationMetrics } from '../net/types';
import { useGameStore } from '../state/store';

export interface HudController {
  element: HTMLElement;
  setRole: (role?: Role) => void;
  updatePlayers: (players: Record<string, PlayerStateSnapshot>, selfId?: string) => void;
  setMetrics: (metrics?: VisualizationMetrics) => void;
  pushLog: (entry: string) => void;
  getTargetPlayer: () => string | undefined;
  onTargetChange: (handler: (playerId?: string) => void) => void;
  attachChatHandler: (send: (text: string) => void) => void;
  appendChat: (message: SocketChatMessage) => void;
}

export const createHUD = (): HudController => {
  const container = document.createElement('section');
  container.className = 'hud-overlay';

  const roleBadge = document.createElement('div');
  roleBadge.className = 'role-badge';
  roleBadge.textContent = 'Role: Unknown';
  container.appendChild(roleBadge);

  const playerList = document.createElement('ul');
  playerList.className = 'player-list';
  container.appendChild(playerList);

  const metricsBox = document.createElement('div');
  metricsBox.className = 'metrics-box';
  container.appendChild(metricsBox);

  const log = document.createElement('div');
  log.className = 'event-log';
  const logTitle = document.createElement('h3');
  logTitle.textContent = 'Log';
  log.appendChild(logTitle);
  const logList = document.createElement('ul');
  log.appendChild(logList);
  container.appendChild(log);

  const chatBox = document.createElement('div');
  chatBox.className = 'chat-box';
  chatBox.innerHTML = '<h3>Team Chat</h3>';
  const chatList = document.createElement('ul');
  chatList.className = 'chat-list';
  const chatForm = document.createElement('form');
  chatForm.innerHTML = `
    <input type="text" placeholder="Send a quick ping" />
    <button type="submit">Send</button>
  `;
  chatBox.appendChild(chatList);
  chatBox.appendChild(chatForm);
  container.appendChild(chatBox);

  let targetChangeHandler: (playerId?: string) => void = () => undefined;
  let selectedTargetId: string | undefined;
  let chatSender: (text: string) => void = () => undefined;

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = chatForm.querySelector('input');
    if (!input || !input.value.trim()) return;
    chatSender(input.value.trim());
    input.value = '';
  });

  const setRole = (role?: Role) => {
    roleBadge.dataset.role = role ?? 'unknown';
    roleBadge.textContent = role ? `Role: ${role === 'miner' ? 'Miner' : 'Saboteur'}` : 'Role: Unknown';
  };

  const updatePlayers = (players: Record<string, PlayerStateSnapshot>, selfId?: string) => {
    playerList.innerHTML = '';
    const entries = Object.values(players);
    if (entries.length === 0) {
      playerList.innerHTML = '<li>No teammates connected</li>';
      return;
    }
    entries.forEach((player) => {
      const li = document.createElement('li');
      li.dataset.id = player.id;
      li.className = player.id === selfId ? 'self' : '';
      li.innerHTML = `
        <span>${player.name}</span>
        <small>Score: ${player.score ?? 0}</small>
        <div class="suspicion-bar">
          <div style="width:${Math.min(100, player.suspicion * 100)}%"></div>
        </div>
      `;
      li.addEventListener('click', () => {
        selectedTargetId = player.id === selectedTargetId ? undefined : player.id;
        targetChangeHandler(selectedTargetId);
        updatePlayers(players, selfId);
      });
      if (player.id === selectedTargetId) {
        li.classList.add('selected');
      }
      playerList.appendChild(li);
    });
  };

  const setMetrics = (metrics?: VisualizationMetrics) => {
    if (!metrics) {
      metricsBox.innerHTML = '<p>Connecting to game...</p>';
      return;
    }
    metricsBox.innerHTML = `
      <h3>Mine Telemetry</h3>
      <p>Deck remaining: ${metrics.deckRemaining}</p>
      <p>Tunnel progress: ${(metrics.progress * 100).toFixed(1)}%</p>
      <p>Collapsed tiles: ${metrics.collapsedTiles}</p>
      <p>Turns taken: ${metrics.turnsTaken}</p>
      <p>Round: ${metrics.round}</p>
      <p>Your gold: ${metrics.goldByPlayer?.[useGameStore.getState().playerId ?? ''] ?? 0}</p>
    `;
  };

  const pushLog = (entry: string) => {
    const li = document.createElement('li');
    li.textContent = `[${new Date().toLocaleTimeString()}] ${entry}`;
    logList.prepend(li);
    const maxEntries = 10;
    while (logList.children.length > maxEntries) {
      logList.removeChild(logList.lastElementChild!);
    }
  };

  const appendChat = (message: SocketChatMessage) => {
    const li = document.createElement('li');
    li.textContent = `${message.from}: ${message.body}`;
    chatList.appendChild(li);
    chatList.scrollTop = chatList.scrollHeight;
  };

  return {
    element: container,
    setRole,
    updatePlayers,
    setMetrics,
    pushLog,
    getTargetPlayer: () => selectedTargetId,
    onTargetChange: (handler) => {
      targetChangeHandler = handler;
    },
    attachChatHandler: (send) => {
      chatSender = send;
    },
    appendChat,
  };
};

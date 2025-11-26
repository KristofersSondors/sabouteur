import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  PlayerStateSnapshot,
  CardPlacementPayload,
  RockfallPayload,
  ToolEffectPayload,
  SocketChatMessage,
} from './types';
import type { CardInstance } from '../game/cards';
import { useGameStore } from '../state/store';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4173';

type PeerHooks = {
  onJoin?: (playerId: string) => void;
  onLeave?: (playerId: string) => void;
  onChat?: (message: SocketChatMessage) => void;
};

let peerHooks: PeerHooks = {};

export const registerPeerHooks = (hooks: PeerHooks) => {
  peerHooks = hooks;
};

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket'],
});

const initName = (preferred?: string) => {
  if (preferred) return preferred;
  const stored = localStorage.getItem('saboteur-name');
  if (stored) return stored;
  const generated = `Dwarf-${Math.floor(Math.random() * 999)}`;
  localStorage.setItem('saboteur-name', generated);
  return generated;
};

export const connectToServer = (roomCode?: string, userId?: string, name?: string) =>
  new Promise<void>((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    socket.once('connect', () => {
      useGameStore.getState().setConnection(true);
      socket.emit('ready', initName(name), roomCode, userId ?? null);
      resolve();
    });
    socket.once('connect_error', (err) => {
      reject(err);
    });
    socket.connect();
  });

const upsertPlayers = (players: PlayerStateSnapshot[]) => {
  const store = useGameStore.getState();
  store.updatePlayers(players);
};

socket.on('welcome', (payload) => {
  const { playerId, role, board, players, hand, metrics } = payload;
  useGameStore.getState().hydrate({
    playerId,
    role,
    board,
    players,
    hand,
    metrics,
  });
  players.forEach((player) => {
    if (player.id !== playerId) {
      peerHooks.onJoin?.(player.id);
    }
  });
});

socket.on('players', (players) => upsertPlayers(players));

socket.on('playerJoined', (player) => {
  useGameStore.getState().upsertPlayer(player);
  if (player.id !== useGameStore.getState().playerId) {
    peerHooks.onJoin?.(player.id);
  }
});

socket.on('playerLeft', (playerId) => {
  useGameStore.getState().removePlayer(playerId);
  peerHooks.onLeave?.(playerId);
});

socket.on('playerMoved', (player) => {
  useGameStore.getState().upsertPlayer(player);
});

socket.on('boardUpdated', (board) => useGameStore.getState().setBoard(board));

socket.on('handUpdated', (hand: CardInstance[]) => useGameStore.getState().setHand(hand));

socket.on('metrics', (metrics) => useGameStore.getState().updateMetrics(metrics));

socket.on('newChat', (message) => {
  peerHooks.onChat?.(message);
});

socket.on('roundEnded', (payload) => {
  const store = useGameStore.getState();
  if (store.metrics) {
    store.updateMetrics({ ...store.metrics, round: payload.round });
  }
  if (store.board) {
    store.setBoard({ ...store.board, winningTeam: payload.team });
  }
  window.dispatchEvent(new CustomEvent('round-ended', { detail: payload }));
});

export const emitMovement = (position: PlayerStateSnapshot['position'], rotation: PlayerStateSnapshot['rotation']) => {
  socket.emit('playerMove', position, rotation);
};

export const emitCardPlacement = (payload: CardPlacementPayload) => {
  socket.emit('placeCard', payload);
};

export const emitRockfall = (payload: RockfallPayload) => {
  socket.emit('rockfall', payload);
};

export const emitToolEffect = (payload: ToolEffectPayload) => {
  socket.emit('toolEffect', payload);
};

export const emitChat = (text: string) => socket.emit('sendChat', text);

export const emitRtcOffer = (to: string, description: RTCSessionDescriptionInit) => {
  socket.emit('rtcOffer', { to, description });
};

export const emitRtcAnswer = (to: string, description: RTCSessionDescriptionInit) => {
  socket.emit('rtcAnswer', { to, description });
};

export const emitRtcCandidate = (to: string, candidate: RTCIceCandidateInit) => {
  socket.emit('rtcCandidate', { to, candidate });
};

export const emitRestart = () => {
  socket.emit('restart');
};

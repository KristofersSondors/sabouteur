import { createStore } from 'zustand/vanilla';
import type { CardInstance, Role } from '../game/cards';
import type {
  BoardState,
  PlayerStateSnapshot,
  VisualizationMetrics,
  Vec3,
  QuaternionLike,
} from '../net/types';

export interface LocalPlayerPose {
  position: Vec3;
  rotation: QuaternionLike;
}

interface GameStore {
  connected: boolean;
  playerId?: string;
  name: string;
  role?: Role;
  board?: BoardState;
  players: Record<string, PlayerStateSnapshot>;
  metrics?: VisualizationMetrics;
  hand: CardInstance[];
  selectedCard?: CardInstance;
  pose: LocalPlayerPose;
  setConnection: (connected: boolean) => void;
  hydrate: (payload: {
    playerId: string;
    role: Role;
    board: BoardState;
    players: PlayerStateSnapshot[];
    hand: CardInstance[];
    metrics: VisualizationMetrics;
  }) => void;
  updatePlayers: (players: PlayerStateSnapshot[]) => void;
  upsertPlayer: (player: PlayerStateSnapshot) => void;
  removePlayer: (id: string) => void;
  setBoard: (board: BoardState) => void;
  setHand: (hand: CardInstance[]) => void;
  selectCard: (card?: CardInstance) => void;
  updateMetrics: (metrics: VisualizationMetrics) => void;
  setPose: (position: Vec3, rotation: QuaternionLike) => void;
}

export const useGameStore = createStore<GameStore>((set, _get) => ({
  connected: false,
  name: '',
  players: {},
  hand: [],
  pose: { position: { x: 0, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  setConnection: (connected) => set({ connected }),
  hydrate: ({ playerId, role, board, players, hand, metrics }) =>
    set({
      playerId,
      role,
      board,
      players: Object.fromEntries(players.map((p) => [p.id, p])),
      hand,
      metrics,
    }),
  updatePlayers: (players) => {
    set((state) => {
      const updated = { ...state.players };
      players.forEach((player) => {
        updated[player.id] = player;
      });
      return { players: updated };
    });
  },
  upsertPlayer: (player) =>
    set((state) => ({
      players: { ...state.players, [player.id]: player },
    })),
  removePlayer: (id) =>
    set((state) => {
      const clone = { ...state.players };
      delete clone[id];
      return { players: clone };
    }),
  setBoard: (board) => set({ board }),
  setHand: (hand) => set({ hand, selectedCard: undefined }),
  selectCard: (card) => set({ selectedCard: card }),
  updateMetrics: (metrics) => set({ metrics }),
  setPose: (position, rotation) =>
    set(() => ({
      pose: { position, rotation },
    })),
}));

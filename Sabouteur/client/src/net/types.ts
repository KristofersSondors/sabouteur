import type { CardInstance, PathConnectors, Role } from '../game/cards';

export type TileType = 'empty' | 'start' | 'goal' | 'path' | 'blocked';

export interface BoardTile {
  id: string;
  row: number;
  col: number;
  tileType: TileType;
  connectors?: PathConnectors;
  cardKey?: string;
  rotation?: number;
  revealed?: boolean;
  ownerId?: string;
}

export interface BoardState {
  rows: number;
  columns: number;
  tiles: BoardTile[];
  winningTeam?: Role;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PlayerStateSnapshot {
  id: string;
  name: string;
  role: Role | 'unknown';
  position: Vec3;
  rotation: QuaternionLike;
  connected: boolean;
  toolBroken: boolean;
  suspicion: number;
  score: number;
}

export interface VisualizationMetrics {
  deckRemaining: number;
  progress: number;
  collapsedTiles: number;
  suspicionByPlayer: Record<string, number>;
  turnsTaken: number;
  goldByPlayer: Record<string, number>;
  round: number;
  efficiencyByPlayer: Record<string, number>;
  activePlayerId?: string;
  turnEndsAt?: number;
}

export interface WelcomePayload {
  playerId: string;
  role: Role;
  board: BoardState;
  players: PlayerStateSnapshot[];
  hand: CardInstance[];
  metrics: VisualizationMetrics;
  roomCode: string;
}

export interface SocketChatMessage {
  id: string;
  from: string;
  body: string;
  createdAt: number;
}

export interface CardPlacementPayload {
  cardInstanceId: string;
  cardKey: string;
  rotation: number;
  targetTileId: string;
}

export interface RockfallPayload {
  targetTileId: string;
}

export interface ToolEffectPayload {
  targetPlayerId: string;
  cardKey: 'break' | 'repair';
}

export interface ServerToClientEvents {
  welcome: (payload: WelcomePayload) => void;
  players: (payload: PlayerStateSnapshot[]) => void;
  playerJoined: (player: PlayerStateSnapshot) => void;
  playerLeft: (playerId: string) => void;
  playerMoved: (player: PlayerStateSnapshot) => void;
  boardUpdated: (board: BoardState) => void;
  handUpdated: (hand: CardInstance[]) => void;
  metrics: (payload: VisualizationMetrics) => void;
  roundEnded: (payload: { team?: Role; awards: Record<string, number>; placerId?: string; round: number; winners: string[] }) => void;
  newChat: (message: SocketChatMessage) => void;
  rtcOffer: (payload: { from: string; description: RTCSessionDescriptionInit }) => void;
  rtcAnswer: (payload: { from: string; description: RTCSessionDescriptionInit }) => void;
  rtcCandidate: (payload: { from: string; candidate: RTCIceCandidateInit }) => void;
}

export interface ClientToServerEvents {
  ready: (name: string, roomCode?: string, userId?: string | null) => void;
  playerMove: (position: Vec3, rotation: QuaternionLike) => void;
  placeCard: (payload: CardPlacementPayload) => void;
  rockfall: (payload: RockfallPayload) => void;
  toolEffect: (payload: ToolEffectPayload) => void;
  requestHand: () => void;
  sendChat: (text: string) => void;
  rtcOffer: (payload: { to: string; description: RTCSessionDescriptionInit }) => void;
  rtcAnswer: (payload: { to: string; description: RTCSessionDescriptionInit }) => void;
  rtcCandidate: (payload: { to: string; candidate: RTCIceCandidateInit }) => void;
  restart: () => void;
}

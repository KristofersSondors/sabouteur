import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  Vector3,
} from 'three';
import type { BoardState, BoardTile } from '../net/types';

export const BOARD_ROWS = 7;
export const BOARD_COLUMNS = 9;
// Swap aspect so rectangles run horizontally (shorter board depth)
export const TILE_WIDTH = 1.4;
export const TILE_HEIGHT = 2.4;
const BASE_TILE_SIZE = 1.6; // size the models were originally authored against

const baseGeometry = new PlaneGeometry(TILE_WIDTH, TILE_HEIGHT);
const hitMaterial = new MeshStandardMaterial({
  color: new Color('#11151c'),
  transparent: true,
  opacity: 0.28,
  side: 2,
});

const tileColor = (tile: BoardTile): Color => {
  switch (tile.tileType) {
    case 'start':
      return new Color('#118ab2');
    case 'goal':
      if (!tile.revealed) return new Color('#d8c16a');
      return tile.cardKey === 'gold' ? new Color('#ffd166') : new Color('#0d0d0f');
    case 'path':
      return new Color('#a0a17a');
    case 'blocked':
      return new Color('#c44536');
    default:
      return new Color('#333840');
  }
};

const resolvePathKey = (tile: BoardTile): string | undefined => {
  if (tile.cardKey && PATH_MODEL_FILES[tile.cardKey]) return tile.cardKey;
  const c = tile.connectors;
  if (!c) return undefined;
  const openSides = ['north', 'east', 'south', 'west'].filter((dir) => (c as any)[dir]);
  if (openSides.length === 4) return 'cross';
  if (openSides.length === 3) return 'tee';
  if (openSides.length === 2) {
    const isStraight = (c.north && c.south) || (c.east && c.west);
    return isStraight ? 'straight' : 'turn';
  }
  if (openSides.length === 1) return 'deadend';
  return undefined;
};

const pathTextureCache = new Map<string, CanvasTexture>();
const goalTextureCache = new Map<string, CanvasTexture>();

const connectorsKey = (c: NonNullable<BoardTile['connectors']>) =>
  `${c.north ? 1 : 0}${c.east ? 1 : 0}${c.south ? 1 : 0}${c.west ? 1 : 0}`;

const buildPathTexture = (connectors: NonNullable<BoardTile['connectors']>) => {
  const key = connectorsKey(connectors);
  if (pathTextureCache.has(key)) return pathTextureCache.get(key)!;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Base
  ctx.fillStyle = '#c8ccb8';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = '#2e322c';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';

  const center = size / 2;
  const margin = 20;
  const drawLeg = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center + dx, center + dy);
    ctx.stroke();
  };
  if (connectors.north) drawLeg(0, -center + margin);
  if (connectors.south) drawLeg(0, center - margin);
  if (connectors.east) drawLeg(center - margin, 0);
  if (connectors.west) drawLeg(-center + margin, 0);

  // Center nub
  ctx.beginPath();
  ctx.arc(center, center, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#2e322c';
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  pathTextureCache.set(key, texture);
  return texture;
};

const buildGoalTexture = (state: 'hidden' | 'gold' | 'coal') => {
  if (goalTextureCache.has(state)) return goalTextureCache.get(state)!;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  if (state === 'hidden') {
    ctx.fillStyle = '#d8c16a';
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = state === 'gold' ? '#eac350' : '#1c1c1c';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = state === 'gold' ? '#f8e68c' : '#444';
    ctx.lineWidth = 12;
    ctx.strokeRect(18, 18, size - 36, size - 36);
    ctx.fillStyle = state === 'gold' ? '#ffeb9f' : '#444';
    ctx.beginPath();
    if (state === 'gold') {
      ctx.arc(size / 2, size / 2, 60, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(-0.2);
      ctx.fillRect(-55, -20, 110, 40);
      ctx.restore();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  goalTextureCache.set(state, texture);
  return texture;
};

const buildHitMesh = (tile: BoardTile) => {
  const mesh = new Mesh(baseGeometry, hitMaterial.clone());
  mesh.rotateX(-Math.PI / 2);
  mesh.userData.tile = tile;
  return mesh;
};

const applyTileVisual = (group: Group, tile: BoardTile) => {
  // Clear existing children before re-rendering tile visual
  while (group.children.length) {
    const child = group.children.pop();
    if (child) {
      group.remove(child);
    }
  }
  group.add(buildHitMesh(tile));

  const material = new MeshStandardMaterial({
    color: tileColor(tile),
    side: 2,
    roughness: 0.9,
    metalness: 0.1,
  });

  if (tile.tileType === 'path' && tile.connectors) {
    material.color = new Color('#e6ead7');
    material.map = buildPathTexture(tile.connectors);
    material.needsUpdate = true;
  } else if (tile.tileType === 'goal') {
    const state = tile.revealed ? (tile.cardKey === 'gold' ? 'gold' : 'coal') : 'hidden';
    material.map = buildGoalTexture(state);
    material.color = new Color('#ffffff');
    material.needsUpdate = true;
  }

  const mesh = new Mesh(baseGeometry, material);
  mesh.rotateX(-Math.PI / 2);
  mesh.position.y = 0.01;
  group.add(mesh);
};

const buildTileMesh = (tile: BoardTile) => {
  const group = new Group();
  group.position.copy(tileToPosition(tile.row, tile.col));
  group.userData.tile = tile;
  applyTileVisual(group, tile);
  return group;
};

export const tileToPosition = (row: number, col: number): Vector3 => {
  const offsetX = (BOARD_COLUMNS / 2) * TILE_WIDTH;
  const offsetZ = (BOARD_ROWS / 2) * TILE_HEIGHT;
  return new Vector3(col * TILE_WIDTH - offsetX, 0, row * TILE_HEIGHT - offsetZ);
};

export const createBoardMesh = (state: BoardState) => {
  const group = new Group();
  const meshMap = new Map<string, Group>();
  state.tiles.forEach((tile) => {
    const mesh = buildTileMesh(tile);
    group.add(mesh);
    meshMap.set(tile.id, mesh);
  });
  return { group, meshMap };
};

export const updateBoardMesh = (boardState: BoardState, meshMap: Map<string, Group>) => {
  boardState.tiles.forEach((tile) => {
    const mesh = meshMap.get(tile.id);
    if (!mesh) return;
    mesh.userData.tile = tile;
    mesh.position.copy(tileToPosition(tile.row, tile.col));
    applyTileVisual(mesh, tile);
  });
};

export const boardTileFromIntersection = (object: Mesh): BoardTile | undefined => {
  let current: any = object;
  while (current) {
    if (current.userData?.tile) return current.userData.tile as BoardTile;
    current = current.parent;
  }
  return undefined;
};

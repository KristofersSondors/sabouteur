export type Role = 'miner' | 'saboteur';

export type CardCategory = 'path' | 'rockfall' | 'repair' | 'break';

export interface PathConnectors {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}

export interface CardDefinition {
  key: string;
  label: string;
  description: string;
  category: CardCategory;
  connectors?: PathConnectors;
  sabotageWeight?: number;
}

export interface CardInstance {
  instanceId: string;
  cardKey: string;
  rotation: number;
}

export const CARD_LIBRARY: Record<string, CardDefinition> = {
  straight: {
    key: 'straight',
    label: 'Tunnel EW',
    description: 'Extends the tunnel east–west.',
    category: 'path',
    connectors: { north: false, east: true, south: false, west: true },
  },
  straightLong: {
    key: 'straightLong',
    label: 'Tunnel NS',
    description: 'Extends the tunnel north–south.',
    category: 'path',
    connectors: { north: true, east: false, south: true, west: false },
  },
  straightBranchNorth: {
    key: 'straightBranchNorth',
    label: 'Side Spur N',
    description: 'Straight with a branch north.',
    category: 'path',
    connectors: { north: true, east: true, south: false, west: true },
  },
  straightBranchSouth: {
    key: 'straightBranchSouth',
    label: 'Side Spur S',
    description: 'Straight with a branch south.',
    category: 'path',
    connectors: { north: false, east: true, south: true, west: true },
  },
  turn: {
    key: 'turn',
    label: 'Bend',
    description: 'Turns the tunnel 90 degrees.',
    category: 'path',
    connectors: { north: true, east: true, south: false, west: false },
  },
  tee: {
    key: 'tee',
    label: 'T-Junction',
    description: 'Opens to three directions.',
    category: 'path',
    connectors: { north: true, east: true, south: true, west: false },
  },
  cross: {
    key: 'cross',
    label: 'Crossroad',
    description: 'Connects every direction.',
    category: 'path',
    connectors: { north: true, east: true, south: true, west: true },
  },
  deadendEast: {
    key: 'deadendEast',
    label: 'Dead End E',
    description: 'Dead end pointing east.',
    category: 'path',
    connectors: { north: false, east: true, south: false, west: false },
    sabotageWeight: 0.6,
  },
  deadendNorth: {
    key: 'deadendNorth',
    label: 'Dead End N',
    description: 'Dead end pointing north.',
    category: 'path',
    connectors: { north: true, east: false, south: false, west: false },
    sabotageWeight: 0.6,
  },
  rockfall: {
    key: 'rockfall',
    label: 'Rockfall',
    description: 'Remove a tunnel tile from the board.',
    category: 'rockfall',
    sabotageWeight: 0.35,
  },
  break: {
    key: 'break',
    label: 'Break Tool',
    description: 'Temporarily disables another dwarf.',
    category: 'break',
    sabotageWeight: 0.8,
  },
  repair: {
    key: 'repair',
    label: 'Repair',
    description: 'Fixes a broken tool.',
    category: 'repair',
  },
};

// Total path cards = 44 across varied shapes
const DECK_TEMPLATE: Array<{ key: keyof typeof CARD_LIBRARY; quantity: number }> = [
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

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const generateDeck = (): CardInstance[] => {
  const deck: CardInstance[] = [];
  DECK_TEMPLATE.forEach((entry) => {
    for (let i = 0; i < entry.quantity; i += 1) {
      deck.push({
        instanceId: uuid(),
        cardKey: entry.key,
        rotation: 0,
      });
    }
  });
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

export const rotateConnectors = (connectors: PathConnectors | undefined, rotation: number): PathConnectors | undefined => {
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

export const roleDistribution = (playerCount: number): Role[] => {
  const saboteurCount = playerCount >= 7 ? 3 : playerCount >= 5 ? 2 : 1;
  const arr: Role[] = Array(playerCount)
    .fill('miner')
    .map((_, idx) => (idx < saboteurCount ? 'saboteur' : 'miner'));
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

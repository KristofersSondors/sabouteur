import type { CardInstance } from '../game/cards';
import { CARD_LIBRARY } from '../game/cards';

const cardIconCache = new Map<string, string>();

const svgHeader = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" stroke="none" fill="none">`;

const makePathIcon = (key: string) => {
  const def = CARD_LIBRARY[key];
  const connectors = def?.connectors;
  const size = 120;
  const half = size / 2;
  const stroke = 16;
  const lines: string[] = [];
  if (connectors?.north) lines.push(`<rect x="${half - stroke / 2}" y="8" width="${stroke}" height="${half - 8}" rx="6" />`);
  if (connectors?.south) lines.push(`<rect x="${half - stroke / 2}" y="${half}" width="${stroke}" height="${half - 8}" rx="6" />`);
  if (connectors?.west) lines.push(`<rect x="8" y="${half - stroke / 2}" width="${half - 8}" height="${stroke}" rx="6" />`);
  if (connectors?.east) lines.push(`<rect x="${half}" y="${half - stroke / 2}" width="${half - 8}" height="${stroke}" rx="6" />`);
  const svg = `${svgHeader(size)}
    <rect x="4" y="4" width="${size - 8}" height="${size - 8}" rx="16" fill="#0b141d" stroke="#283442" stroke-width="4" />
    <rect x="${half - 26}" y="${half - 26}" width="52" height="52" rx="12" fill="#d7e3f4" stroke="#0b141d" stroke-width="4" />
    <g fill="#8aa8c7" stroke="#0b141d" stroke-width="4">${lines.join('')}</g>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const makeUtilityIcon = (key: string) => {
  const size = 120;
  let glyph = '⚙️';
  if (key === 'rockfall') glyph = '💥';
  if (key === 'break') glyph = '⛔';
  if (key === 'repair') glyph = '🛠️';
  const svg = `${svgHeader(size)}
    <rect x="4" y="4" width="${size - 8}" height="${size - 8}" rx="16" fill="#0b141d" stroke="#283442" stroke-width="4" />
    <text x="50%" y="55%" text-anchor="middle" font-size="54" fill="#f2f5fa">${glyph}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const iconForCard = (cardKey: string) => {
  if (cardIconCache.has(cardKey)) return cardIconCache.get(cardKey)!;
  const def = CARD_LIBRARY[cardKey];
  if (!def) return '';
  const icon =
    def.category === 'path' && def.connectors ? makePathIcon(cardKey) : makeUtilityIcon(cardKey);
  cardIconCache.set(cardKey, icon);
  return icon;
};

export interface HandPanelController {
  element: HTMLElement;
  setHand: (hand: CardInstance[]) => void;
  getSelection: () => { card?: CardInstance; rotation: number };
  rotate: (direction: 1 | -1) => void;
  clearSelection: () => void;
}

type HandPanelOptions = {
  onSelect?: (card: CardInstance | undefined, rotation: number) => void;
  onRotate?: (rotation: number) => void;
};

export const createHandPanel = (options?: HandPanelOptions): HandPanelController => {
  const container = document.createElement('section');
  container.className = 'hand-panel';

  const header = document.createElement('header');
  header.innerHTML = '<h2>Hand</h2>';
  container.appendChild(header);

  const list = document.createElement('div');
  list.className = 'hand-cards';
  container.appendChild(list);

  const rotationInfo = document.createElement('div');
  rotationInfo.className = 'hand-rotation';
  rotationInfo.textContent = 'Rotation: 0°';

  const rotationControls = document.createElement('div');
  rotationControls.className = 'hand-rotation-controls';
  const rotateLeft = document.createElement('button');
  rotateLeft.type = 'button';
  rotateLeft.textContent = '⟲';
  const rotateRight = document.createElement('button');
  rotateRight.type = 'button';
  rotateRight.textContent = '⟳';
  rotationControls.appendChild(rotateLeft);
  rotationControls.appendChild(rotationInfo);
  rotationControls.appendChild(rotateRight);
  container.appendChild(rotationControls);

  let hand: CardInstance[] = [];
  let selectedId: string | undefined;
  let rotation = 0;

  const updateRotationLabel = () => {
    rotationInfo.textContent = `Rotation: ${rotation * 90}°`;
  };

  const notifyRotate = () => {
    updateRotationLabel();
    options?.onRotate?.(rotation);
  };

  const notifySelect = () => {
    options?.onSelect?.(hand.find((c) => c.instanceId === selectedId), rotation);
  };

  const selectCard = (card: CardInstance | undefined) => {
    if (!card) {
      selectedId = undefined;
      options?.onSelect?.(undefined, rotation);
      render();
      return;
    }
    if (selectedId === card.instanceId) {
      selectedId = undefined;
      options?.onSelect?.(undefined, rotation);
    } else {
      selectedId = card.instanceId;
      const baseRotation = card.rotation ?? 0;
      const normalized = ((baseRotation % 4) + 4) % 4;
      rotation = normalized === 2 ? 2 : 0; // clamp to 0 or 180
      notifySelect();
    }
    updateRotationLabel();
    render();
  };

  const selectByIndex = (index: number) => {
    const card = hand[index];
    if (!card) return;
    selectCard(card);
  };

  const render = () => {
    list.innerHTML = '';
    hand.forEach((card, idx) => {
      const def = CARD_LIBRARY[card.cardKey];
      const cardButton = document.createElement('button');
      cardButton.type = 'button';
      cardButton.className = `card ${card.instanceId === selectedId ? 'selected' : ''}`;
      cardButton.innerHTML = `
        <div class="card-thumb"><img src="${iconForCard(card.cardKey)}" alt="${def.label}" /></div>
        <div class="card-copy">
          <strong>${def.label} <span class="card-hotkey">${idx + 1}</span></strong>
          <small>${def.description}</small>
        </div>
      `;
      cardButton.addEventListener('click', () => selectCard(card));
      list.appendChild(cardButton);
    });
    if (hand.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hand-empty';
      empty.textContent = 'Draw pile is empty — wait for your next turn.';
      list.appendChild(empty);
    }
  };

  rotateLeft.addEventListener('click', () => {
    rotation = rotation === 0 ? 2 : 0; // toggle 0 <-> 180
    notifyRotate();
    notifySelect();
  });
  rotateRight.addEventListener('click', () => {
    rotation = rotation === 0 ? 2 : 0; // toggle 0 <-> 180
    notifyRotate();
    notifySelect();
  });

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!hand.length) return;
    if (event.key >= '1' && event.key <= '5') {
      const idx = parseInt(event.key, 10) - 1;
      selectByIndex(idx);
    }
    if (event.key.toLowerCase() === 'r') {
      rotation = rotation === 0 ? 2 : 0;
      notifyRotate();
      notifySelect();
    }
  });

  return {
    element: container,
    setHand: (nextHand) => {
      hand = nextHand;
      if (selectedId && !hand.find((card) => card.instanceId === selectedId)) {
        selectedId = undefined;
        options?.onSelect?.(undefined, rotation);
      }
      render();
    },
    getSelection: () => ({
      card: hand.find((card) => card.instanceId === selectedId),
      rotation,
    }),
    rotate: (direction) => {
      rotation = (rotation + (direction === 1 ? 1 : 3)) % 4;
      notifyRotate();
      notifySelect();
    },
    clearSelection: () => {
      selectedId = undefined;
      render();
      options?.onSelect?.(undefined, rotation);
    },
  };
};

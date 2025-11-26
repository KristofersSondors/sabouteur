import type { PlayerStateSnapshot, VisualizationMetrics } from '../net/types';

export interface VisualizationPanel {
  element: HTMLElement;
  update: (metrics?: VisualizationMetrics, players?: Record<string, PlayerStateSnapshot>) => void;
}

export const createVisualizationPanel = (): VisualizationPanel => {
  const container = document.createElement('section');
  container.className = 'visualization-panel';
  const title = document.createElement('h3');
  title.textContent = 'Saboteur Insights';
  container.appendChild(title);

  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 240;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const update = (metrics?: VisualizationMetrics, players?: Record<string, PlayerStateSnapshot>) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!metrics) {
      ctx.fillStyle = '#ccc';
      ctx.fillText('Awaiting telemetry...', 20, 90);
      return;
    }

    const centerX = 110;
    const centerY = 100;
    const radius = 70;
    ctx.strokeStyle = '#2d3142';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();

    const progressAngle = Math.PI * 0.75 + metrics.progress * Math.PI * 1.5;
    ctx.strokeStyle = '#06d6a0';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI * 0.75, progressAngle);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '20px "Space Mono", monospace';
    ctx.fillText(`${Math.round(metrics.progress * 100)}%`, centerX - 25, centerY + 8);
    ctx.fillStyle = '#9a8c98';
    ctx.font = '13px "Space Mono", monospace';
    ctx.fillText('Tunnel completeness', centerX - 60, centerY + 40);

    // Suspicion bars
    if (players && metrics.efficiencyByPlayer) {
      const startX = 240;
      const baseY = 30;
      const barHeight = 18;
      const ids = Object.keys(players);
      ids.forEach((id, index) => {
        const player = players[id];
        const eff = metrics.efficiencyByPlayer[id] ?? 0;
        const sus = player.suspicion ?? 0;
        ctx.fillStyle = '#ccc';
        ctx.font = '12px sans-serif';
        ctx.fillText(player.name, startX, baseY + index * (barHeight + 14) - 4);
        // efficiency bar
        ctx.fillStyle = eff >= 0 ? '#06d6a0' : '#ef476f';
        const width = Math.min(120, Math.max(-120, eff * 120));
        if (width >= 0) ctx.fillRect(startX, baseY + index * (barHeight + 14), width, barHeight);
        else ctx.fillRect(startX + width, baseY + index * (barHeight + 14), -width, barHeight);
        // suspicion overlay
        ctx.strokeStyle = sus > 0.6 ? '#ef476f' : '#ffd166';
        ctx.strokeRect(startX - 1, baseY + index * (barHeight + 14) - 1, 122, barHeight + 2);
      });
    }

    ctx.fillStyle = '#adb5bd';
    ctx.fillText(`Collapsed tiles: ${metrics.collapsedTiles}`, 20, 210);
    ctx.fillText(`Deck remaining: ${metrics.deckRemaining}`, 200, 210);
    ctx.fillText(`Round: ${metrics.round}`, 340, 210);
  };

  return { element: container, update };
};

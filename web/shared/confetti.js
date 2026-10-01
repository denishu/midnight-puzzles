/* =============================================================================
 * Shared confetti — dependency-free, CSP-safe (no external libs/CDN).
 *
 * spawnConfetti() injects a burst of small colored pieces that fall, drift, and
 * rotate, then removes itself. Used by all three games on a win. Call it once
 * when the victory overlay is shown.
 * ========================================================================== */

const COLORS = ['#a855f7', '#f59e0b', '#4ade80', '#60a5fa', '#f472b6', '#fde68a'];

let styleInjected = false;
function ensureStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .mp-confetti-layer {
      position: fixed; inset: 0; pointer-events: none; overflow: hidden;
      z-index: 2500;
    }
    .mp-confetti-piece {
      position: absolute; top: -12px; width: 9px; height: 14px;
      opacity: 0; will-change: transform, opacity;
    }
    @keyframes mp-confetti-fall {
      0%   { transform: translateY(-20px) rotateZ(0deg); opacity: 1; }
      100% { transform: translateY(102vh) rotateZ(var(--spin)); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Fire a confetti burst.
 * @param {number} count number of pieces (default 90)
 * @param {number} durationMs how long before the layer is removed (default 2800)
 */
export function spawnConfetti(count = 90, durationMs = 2800) {
  ensureStyle();

  const layer = document.createElement('div');
  layer.className = 'mp-confetti-layer';

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'mp-confetti-piece';

    const left = Math.random() * 100;
    const delay = Math.random() * 0.5;
    const dur = 2 + Math.random() * 1.5;
    const drift = (Math.random() - 0.5) * 120;
    const spin = (Math.random() * 6 - 3) * 360;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const round = Math.random() < 0.3;

    piece.style.left = left + 'vw';
    piece.style.background = color;
    piece.style.borderRadius = round ? '50%' : '2px';
    piece.style.setProperty('--spin', spin + 'deg');
    piece.style.animation = `mp-confetti-fall ${dur}s cubic-bezier(.25,.6,.5,1) ${delay}s forwards`;
    // Horizontal drift via a wrapping transform on an inner offset.
    piece.style.marginLeft = drift + 'px';

    layer.appendChild(piece);
  }

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), durationMs);
}

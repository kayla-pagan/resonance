/** Space kept between the panel and anything it must not cover. */
const GAP = 12;
/** Minimum distance from the viewport edge. */
const EDGE = 10;

/** Studio regions a temporary panel must never cover. */
const OBSTACLES = [
  '.studio-preview',
  '.studio-cam-notice',
  '.studio-status-row',
  '.studio-hint',
  '.tact',
  '.tp',
  '.studio-note',
];

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Position a fixed-size panel (e.g. the compact "Your loop" popover) in the first nearby spot
 * that is fully on screen and covers none of the studio's controls or the camera preview.
 * Measures the live layout, so it adapts to any viewport. Candidates, in order:
 *   1. the original top-right spot (only when no camera preview is shown)
 *   2. immediately left of the camera preview
 *   3. left of both the preview and the tactile module
 *   4. top-left, under the mode hint
 * If nothing is fully clear, the candidate with the least overlap wins.
 */
export function placeClear(el: HTMLElement) {
  const root = el.closest('.app') ?? document.body;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const rectOf = (sel: string) => {
    const r = root.querySelector(sel)?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
  };
  const obstacles: Rect[] = OBSTACLES.flatMap((sel) =>
    [...root.querySelectorAll(sel)]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0),
  );
  const preview = rectOf('.studio-preview');
  const tact = rectOf('.tact');
  const status = rectOf('.studio-status-row');
  const hint = rectOf('.studio-hint');

  const top = preview ? preview.top : status ? status.bottom + GAP : 56;
  const rightEdge = preview ? preview.left - GAP : W - 22;
  const cands: [number, number][] = [];
  if (!preview) {
    cands.push([W - 22 - w, 56]);
  }
  cands.push([rightEdge - w, top]);
  if (tact) {
    cands.push([Math.min(rightEdge, tact.left - GAP) - w, top]);
  }
  cands.push([30, (hint ? hint.bottom : 96) + GAP]);

  let best = cands[0];
  let bestCost = Infinity;
  for (const [x, y] of cands) {
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    const offscreen = x < EDGE || y < EDGE || box.right > W - EDGE || box.bottom > H - EDGE;
    const pad = (r: Rect) => ({
      left: r.left - GAP / 2,
      top: r.top - GAP / 2,
      right: r.right + GAP / 2,
      bottom: r.bottom + GAP / 2,
    });
    const cost =
      obstacles.reduce((sum, r) => sum + overlap(box, pad(r)), 0) + (offscreen ? 1e7 : 0);
    if (cost === 0) {
      best = [x, y];
      break;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = [x, y];
    }
  }
  el.style.left = Math.round(best[0]) + 'px';
  el.style.top = Math.round(best[1]) + 'px';
  el.style.right = 'auto';
}

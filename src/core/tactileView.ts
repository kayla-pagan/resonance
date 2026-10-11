import type { Channel } from './engine';

/** Channel colours (v7 LCOL): cream = Drums, cyan = Bass. */
const LCOL: Record<Channel, string> = { expression: '127,224,236', rhythm: '236,230,216' };
/** Amber = timing: a motor pulsing the metronome is drawn in this colour instead. */
const AMBER = '242,189,114';

export interface WristOptions {
  /** Current motor levels, 0..1, from the simulated transport. */
  levels: Record<Channel, number>;
  /** Motors currently pulsing the metronome (drawn amber). */
  metro?: Record<Channel, boolean>;
  /** Whether each channel is allowed by the current Feel mode. */
  allowed: Record<Channel, boolean>;
  /** Feel mode "off": both motors dimmed. */
  off: boolean;
  reduced: boolean;
  /** Larger rendering (focus mode). */
  big: boolean;
  /** Hide the motor activity (Tactile Memory guessing). */
  hidden: boolean;
}

/**
 * Simulated wristband: two motors on the front of the band, Drums (channel `rhythm`) on the left
 * and Bass (channel `expression`) on the right; both carry the beat while recording.
 * Ported from v7 drawWrist; drawn every frame by the controller.
 */
export function drawWrist(cv: HTMLCanvasElement | null, o: WristOptions) {
  if (!cv) {
    return;
  }
  const w = cv.clientWidth;
  const hgt = cv.clientHeight;
  if (!w || !hgt) {
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(w * dpr);
  const ph = Math.round(hgt * dpr);
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  const g = cv.getContext('2d');
  if (!g) {
    return;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hgt);

  const now = performance.now();
  const cx = w / 2;
  const cy = hgt * 0.4;
  const rx = w * 0.4;
  const ry = hgt * 0.22;
  const bw = hgt * 0.1;
  const T = Math.PI / 180;
  const k = w / 200;
  const arc = (dy: number, a0: number, a1: number) => {
    g.beginPath();
    g.ellipse(cx, cy + dy, rx, ry, 0, a0 * T, a1 * T, false);
  };

  // Band outline.
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(236,230,216,.08)';
  g.lineWidth = 1;
  arc(0, 180, 360);
  g.stroke();
  g.strokeStyle = 'rgba(236,230,216,.18)';
  arc(0, 0, 180);
  g.stroke();
  arc(bw, 0, 180);
  g.stroke();
  g.beginPath();
  g.moveTo(cx - rx, cy);
  g.lineTo(cx - rx, cy + bw);
  g.moveTo(cx + rx, cy);
  g.lineTo(cx + rx, cy + bw);
  g.stroke();

  // Motors.
  const motors: [Channel, number][] = [
    ['rhythm', 128],
    ['expression', 52],
  ];
  for (const [ch, a] of motors) {
    const allowed = !o.off && o.allowed[ch];
    const v = o.hidden ? 0 : o.levels[ch];
    const col = o.metro?.[ch] ? AMBER : LCOL[ch];
    const px = cx + Math.cos(a * T) * rx;
    const py = cy + Math.sin(a * T) * ry + bw / 2;
    const r0 = 7 * k;
    g.strokeStyle = 'rgba(236,230,216,' + (allowed ? 0.32 : 0.12) + ')';
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(px, py, r0, r0 * 0.62, 0, 0, Math.PI * 2);
    g.stroke();
    if (v > 0.01) {
      g.fillStyle = 'rgba(' + col + ',' + Math.min(1, 0.3 + v * 0.7) + ')';
      g.beginPath();
      g.ellipse(px, py, r0 * (0.55 + 0.45 * v), r0 * 0.62 * (0.55 + 0.45 * v), 0, 0, Math.PI * 2);
      g.fill();
      // Vibration grains around the motor.
      const nd = o.big ? 40 : 22;
      const sz = o.big ? 1.7 : 1.3;
      g.fillStyle = 'rgba(' + col + ',' + 0.7 * v + ')';
      for (let i = 0; i < nd; i++) {
        const ang = (i / nd) * Math.PI * 2;
        const j = o.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(i * 12.9898 + a + now * 0.007);
        const rr = r0 + 3 * k + j * v * 16 * k;
        g.fillRect(
          px + Math.cos(ang) * rr - sz / 2,
          py + Math.sin(ang) * rr * 0.62 - sz / 2,
          sz,
          sz,
        );
      }
    }
  }

  if (o.hidden) {
    g.fillStyle = 'rgba(236,230,216,.55)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 400 ' + Math.round(hgt * 0.32) + 'px "Instrument Serif", serif';
    g.fillText('?', cx, cy - ry * 0.2);
  }
}

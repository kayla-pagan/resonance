import type { NoteMark, Sim } from './sim';

/** How long each instrument's mark lives, in seconds (v8). */
const MARK_LIFE: Record<string, number> = {
  down: 0.9,
  kick: 0.7,
  snare: 0.4,
  hat: 0.28,
  bass: 1,
  keys: 0.8,
  lead: 0.6,
  flick: 0.5,
};

const C = { cream: '236,230,216', bass: '169,155,255', keys: '127,224,236', lead: '242,189,114' };
const RIBBON_COL: Record<string, string> = { bass: C.bass, keys: C.keys, lead: C.lead };
const RIBBON_W: Record<string, number> = { bass: 3, keys: 2, lead: 1.4 };
const TAU = 6.2832;

/**
 * v8 visual music notation, drawn on the existing particle canvas.
 * Rhythm = waves, pitch = height, duration = ribbons, dynamics = size/spread,
 * instrument = shape. Ported from v8 instMark / drawNotation.
 */
export class Notation {
  private sim: Sim;

  constructor(sim: Sim) {
    this.sim = sim;
  }

  /** One instrument-shaped mark; replaces the previous mark of the same kind. */
  instMark(k: string, x: number, y: number, vel: number, acc: boolean) {
    const s = this.sim;
    if (s.focus) {
      return;
    }
    const v = Math.min(1.25, (0.55 + 0.45 * (vel || 0.7)) * (acc ? 1.2 : 1));
    const m: NoteMark = { k, x, y, t0: s.t, v, life: MARK_LIFE[k] || 0.8 };
    if (k === 'snare') {
      m.a = Math.random() * 6.28;
    }
    if (k === 'hat') {
      m.pts = Array.from({ length: 3 + Math.round(v * 2) }, () => [
        Math.random() * 6.28,
        0.4 + Math.random() * 0.8,
      ]);
    }
    if (k === 'lead') {
      m.dx = Math.random() < 0.5 ? -1 : 1;
    }
    for (let i = s.marks.length - 1; i >= 0; i--) {
      if (s.marks[i].k === k) {
        s.marks.splice(i, 1);
      }
    }
    s.marks.push(m);
    if (s.marks.length > 8) {
      s.marks.shift();
    }
    // Melodic notes pull the sand briefly toward their pitch height.
    if (k === 'bass' || k === 'keys' || k === 'lead') {
      s.gathers.push({ y, t0: s.t, k: v });
      if (s.gathers.length > 4) {
        s.gathers.shift();
      }
    }
  }

  /** Marks, held-note ribbons and the live held-note trail (v8 drawNotation). */
  draw(ctx: CanvasRenderingContext2D, t: number) {
    const s = this.sim;
    const W = s.W;
    const H = s.H;
    const F = (s.focus ? 0.5 : 1) * 0.55;
    const M = s.marks;
    const st = (c: string, a: number, w: number) => {
      ctx.strokeStyle = 'rgba(' + c + ',' + (a * F).toFixed(3) + ')';
      ctx.lineWidth = w;
    };
    const fl = (c: string, a: number) => {
      ctx.fillStyle = 'rgba(' + c + ',' + (a * F).toFixed(3) + ')';
    };

    // Instrument marks.
    for (let i = M.length - 1; i >= 0; i--) {
      const m = M[i];
      const a = (t - m.t0) / m.life;
      if (a >= 1 || a < 0) {
        M.splice(i, 1);
        continue;
      }
      const e = 1 - a;
      const ez = 1 - e * e * e;
      const v = m.v;
      ctx.beginPath();
      if (m.k === 'down') {
        st(C.cream, 0.18 * e, 1);
        ctx.ellipse(m.x, m.y, 30 + ez * W * 0.38, 20 + ez * H * 0.26, 0, 0, TAU);
        ctx.stroke();
      } else if (m.k === 'tick') {
        st(C.cream, 0.5 * e, 1);
        ctx.moveTo(m.x, m.y - 4 - ez * 8);
        ctx.lineTo(m.x, m.y + 4 + ez * 8);
        ctx.stroke();
      } else if (m.k === 'kick') {
        // Kick: a wide low ellipse spreading out.
        const r = 12 + ez * 170 * v;
        st(C.cream, 0.5 * e, 0.5 + 1.5 * v * e);
        ctx.ellipse(m.x, m.y, r * 1.7, r * 0.5, 0, 0, TAU);
        ctx.stroke();
      } else if (m.k === 'snare') {
        // Snare: six short spokes bursting outward.
        const r0 = 6 + ez * 32 * v;
        const L = 3 + 7 * e * v;
        st(C.cream, 0.6 * e, 1);
        for (let j = 0; j < 6; j++) {
          const an = (m.a ?? 0) + (j * TAU) / 6;
          const cx = Math.cos(an);
          const sy = Math.sin(an);
          ctx.moveTo(m.x + cx * r0, m.y + sy * r0);
          ctx.lineTo(m.x + cx * (r0 + L), m.y + sy * (r0 + L));
        }
        ctx.stroke();
      } else if (m.k === 'hat') {
        // Hat: a few scattered grains.
        fl(C.cream, 0.85 * e);
        for (const p of m.pts ?? []) {
          const r = 3 + ez * 18 * p[1];
          ctx.fillRect(m.x + Math.cos(p[0]) * r - 0.9, m.y + Math.sin(p[0]) * r - 0.9, 1.8, 1.8);
        }
      } else if (m.k === 'bass') {
        // Bass: a long low wave.
        const hw = 40 + ez * W * 0.18 * v;
        const amp = (3 + 5 * v) * e;
        st(C.bass, 0.55 * e, 0.6 + 1 * v);
        for (let u = -hw; u <= hw; u += 6) {
          const yy = m.y + Math.sin(u * 0.028 - (t - m.t0) * 7) * amp * (1 - Math.abs(u) / hw);
          if (u === -hw) {
            ctx.moveTo(m.x + u, yy);
          } else {
            ctx.lineTo(m.x + u, yy);
          }
        }
        ctx.stroke();
      } else if (m.k === 'keys') {
        // Keys: a chord of three triangles opening up.
        const sp = 1 + ez * 0.8;
        const sz = (4 + 3 * v) * (1 + ez * 0.2);
        st(C.keys, 0.7 * e, 1);
        [
          [-11, 5],
          [0, -7],
          [11, 5],
        ].forEach((o) => {
          const cx = m.x + o[0] * sp;
          const cy = m.y + o[1] * sp;
          ctx.moveTo(cx, cy - sz);
          ctx.lineTo(cx + sz * 0.87, cy + sz * 0.5);
          ctx.lineTo(cx - sz * 0.87, cy + sz * 0.5);
          ctx.closePath();
        });
        ctx.stroke();
      } else if (m.k === 'lead') {
        // Lead: a diamond darting sideways with a thin tail.
        const hx = m.x + (m.dx ?? 1) * ez * 70 * v;
        const sz = 3 + 3 * v;
        st(C.lead, 0.4 * e, 1);
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(hx, m.y);
        ctx.stroke();
        ctx.beginPath();
        fl(C.lead, 0.85 * e);
        ctx.moveTo(hx, m.y - sz);
        ctx.lineTo(hx + sz, m.y);
        ctx.lineTo(hx, m.y + sz);
        ctx.lineTo(hx - sz, m.y);
        ctx.closePath();
        ctx.fill();
      } else if (m.k === 'flick') {
        // Flick: a vertical stroke falling through the field.
        st(C.lead, 0.55 * e, 2);
        ctx.moveTo(m.x, H * 0.18);
        ctx.lineTo(m.x, H * 0.18 + ez * H * 0.64);
        ctx.stroke();
      }
    }

    // Held notes: ribbons that grow for the note's duration, then dissolve.
    const RB = s.ribbons;
    for (let i = RB.length - 1; i >= 0; i--) {
      const rb = RB[i];
      const out = t > rb.end ? (t - rb.end) / 0.7 : 0;
      if (out >= 1) {
        RB.splice(i, 1);
        continue;
      }
      const len = Math.max(4, rb.sp * (Math.min(t, rb.end) - rb.t0));
      const amp = 1 + 1.5 * rb.v;
      st(
        RIBBON_COL[rb.inst] || C.keys,
        0.7 * (1 - out),
        (RIBBON_W[rb.inst] || 2) * (0.5 + 0.4 * rb.v) * (1 - out * 0.5),
      );
      if (out > 0) {
        ctx.setLineDash([2 + out * 4, 2 + out * 14]);
      }
      ctx.beginPath();
      for (let u = 0; u <= len; u += 5) {
        const yy =
          rb.y + Math.sin(u * 0.045 - t * 3 + rb.ph) * amp + out * Math.sin(u * 0.31 + rb.ph) * 5;
        if (u === 0) {
          ctx.moveTo(rb.x0 + u, yy);
        } else {
          ctx.lineTo(rb.x0 + u, yy);
        }
      }
      ctx.stroke();
      if (out > 0) {
        ctx.setLineDash([]);
      }
    }

    // Live held note: a trail behind the hand while the note sustains.
    const tr = s.trail;
    if (tr.length > 1) {
      const out = s.trailOff ? (t - s.trailOff) / 0.6 : 0;
      if (out >= 1) {
        s.trail = [];
        s.trailOff = 0;
      } else {
        const now = s.trailOff || t;
        st(RIBBON_COL[s.trailInst ?? ''] || C.keys, 0.7 * (1 - out), 1.5 * (1 - out * 0.5));
        if (out > 0) {
          ctx.setLineDash([2 + out * 4, 2 + out * 14]);
        }
        ctx.beginPath();
        tr.forEach((p, j) => {
          const x = p[0] - (now - p[2]) * 90;
          if (j) {
            ctx.lineTo(x, p[1]);
          } else {
            ctx.moveTo(x, p[1]);
          }
        });
        ctx.stroke();
        if (out > 0) {
          ctx.setLineDash([]);
        }
      }
    }
  }
}

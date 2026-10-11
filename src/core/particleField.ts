import type { TonalBase } from './engine';
import type { Sim } from './sim';

export type Density = 'Light' | 'Balanced' | 'Dense';

/**
 * Canvas sand field. The simulation and drawing below are the v7 prototype's
 * initParticles / duneY / resize / frame-render code, unchanged apart from types.
 * It reads everything from the shared Sim; the controller writes ripples, holds,
 * floats, hand and intensity inputs into that Sim.
 */
export class ParticleField {
  sim: Sim;
  ctx: CanvasRenderingContext2D | null = null;
  fills: string[] = [];
  /** Optional layer drawn after ripples and before the hand glow (v8 visual notation). */
  overlay: ((ctx: CanvasRenderingContext2D, t: number) => void) | null = null;

  constructor(sim: Sim) {
    this.sim = sim;
    const cols = [
      [236, 230, 216],
      [127, 224, 236],
      [169, 155, 255],
      [242, 189, 114],
    ];
    const al = [0.07, 0.14, 0.25, 0.4, 0.58, 0.82];
    cols.forEach((c) =>
      al.forEach((a) => this.fills.push('rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')')),
    );
  }

  applyTone(p: TonalBase) {
    const s = this.sim;
    s.pp = p.particles;
    let a = 0;
    const tot = p.particles.hues.reduce((x, y) => x + y, 0);
    s.hueW = p.particles.hues.map((x) => (a += x / tot));
  }

  pickHue() {
    const w = this.sim.hueW;
    const r = Math.random();
    for (let i = 0; i < 4; i++) {
      if (r < w[i]) {
        return i;
      }
    }
    return 0;
  }

  /** Sizes the backing store to the canvas box. Returns false if the canvas is gone. */
  resize(c: HTMLCanvasElement | null) {
    const s = this.sim;
    if (!c) {
      return false;
    }
    const r = c.getBoundingClientRect();
    const oW = s.W;
    const oH = s.H;
    s.W = Math.max(1, r.width);
    s.H = Math.max(1, r.height);
    s.ox = r.left;
    s.oy = r.top;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(s.W * dpr);
    c.height = Math.round(s.H * dpr);
    this.ctx = c.getContext('2d');
    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (s.n && oW > 1) {
      for (let i = 0; i < s.n; i++) {
        s.px[i] *= s.W / oW;
        s.py[i] *= s.H / oH;
      }
    }
    return true;
  }

  duneY(x: number, t: number) {
    const H = this.sim.H;
    return (
      H * 0.64 +
      Math.sin(x * 0.0035 + t * 0.03) * H * 0.06 +
      Math.sin(x * 0.0081 - t * 0.05) * H * 0.025
    );
  }

  initParticles(density: Density | undefined) {
    const s = this.sim;
    const base = { Light: 3500, Balanced: 6500, Dense: 11000 }[density || 'Balanced'] || 6500;
    const area = Math.min(1.6, Math.max(0.5, (s.W * s.H) / (1440 * 900)));
    const n = Math.round(base * area * (s.reduced ? 0.5 : 1));
    s.n = n;
    s.px = new Float32Array(n);
    s.py = new Float32Array(n);
    s.vx = new Float32Array(n);
    s.vy = new Float32Array(n);
    s.pz = new Float32Array(n);
    s.off = new Float32Array(n);
    s.hue = new Uint8Array(n);
    s.key = new Uint8Array(n);
    s.order = new Int32Array(n);
    s.counts = new Int32Array(72);
    s.starts = new Int32Array(72);
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * s.W;
      s.px[i] = x;
      s.pz[i] = Math.pow(Math.random(), 0.8);
      s.off[i] = g() * 55;
      s.py[i] = Math.random() < 0.62 ? this.duneY(x, s.t) + s.off[i] : Math.random() * s.H;
      s.hue[i] = this.pickHue();
    }
  }

  /** One frame: intensity easing, particle physics, ripples, hand glow and floating labels. */
  render(dtk: number, trails: number | undefined) {
    const s = this.sim;
    const h = s.hand;
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const t = s.t;
    const W = s.W;
    const H = s.H;

    // Overall intensity eases toward a target set by play state, energy, pinch and boosts.
    const running = !!s.clock;
    const target = s.focus
      ? Math.min(1, 0.05 + s.boost * 0.6)
      : Math.min(
          1,
          0.08 +
            (running && s.screen === 'studio' ? 0.22 : 0) +
            s.energy * 0.32 +
            (h.pinch || s.hands[1].pinch ? 0.28 : 0) +
            s.boost,
        );
    s.intensity += (target * (s.silent ? 0.65 : 1) - s.intensity) * Math.min(1, 0.03 * dtk);
    s.haptic *= Math.pow(0.93, dtk);
    s.noteFlash *= Math.pow(0.95, dtk);
    s.boost *= Math.pow(0.97, dtk);

    // Trails: fade the previous frame instead of clearing it.
    const trl = trails ?? 0.6;
    ctx.globalCompositeOperation = 'destination-out';
    const fa = s.reduced ? 0.5 : Math.max(0.06, 0.42 - trl * 0.5);
    ctx.fillStyle = 'rgba(0,0,0,' + fa + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    const { px, py, vx, vy, pz, off, hue, key, counts, starts, order } = s;
    const n = s.n;
    const pp = s.pp || { speed: 1, turb: 1 };

    // Shimmer a few hues and respawn a few grains on the dune each frame.
    if (!s.reduced) {
      const kk = Math.max(1, (n * 0.003) | 0);
      for (let j = 0; j < kk; j++) {
        hue[(Math.random() * n) | 0] = this.pickHue();
      }
    }
    {
      const rs = Math.max(1, (n * 0.002 * dtk) | 0);
      for (let j = 0; j < rs; j++) {
        const i = (Math.random() * n) | 0;
        const x = Math.random() * W;
        px[i] = x;
        py[i] = this.duneY(x, t) + off[i];
        vx[i] = 0;
        vy[i] = 0;
      }
    }

    // Per-frame constants for the flow field, hand, dune, ripples and avoid zones.
    const I = s.intensity;
    const rmF = s.reduced ? 0.45 : 1;
    const breath = 0.5 + 0.5 * Math.sin(t * 0.55);
    const base = (0.22 + 0.18 * breath + I * 1.9) * rmF * pp.speed;
    const hvx = Math.max(-6, Math.min(6, h.vx));
    const hvy = Math.max(-6, Math.min(6, h.vy));
    const hx = h.x;
    const hy = h.y;
    const R = s.reduced ? 170 : 230;
    const R2 = R * R;
    const ha = s.focus ? 0 : h.amt * s.handScale;
    const lift = (0.25 + (1 - hy / H) * 1.1) * ha;
    const swirlK = (0.9 + Math.min(h.speed, 18) * 0.06) * ha * rmF;
    const pinchK = h.pinch ? 1 : 0;
    const turb = (0.35 + I * 1.2) * pp.turb;
    const duneK = 0.0004 * (1 - I * 0.6);
    const t1 = t * 0.07;
    const t2 = t * 0.05;
    const t3 = t * 0.03;
    const t4 = t * 0.35;
    const dT1 = t * 0.03;
    const dT2 = t * 0.05;
    const dBase = H * 0.64;
    const dA1 = H * 0.06;
    const dA2 = H * 0.025;
    const rips = s.ripples;
    const nr = rips.length;
    const av = s.avoid;
    const na = av.length;
    const M = 34;
    const inert = Math.min(1, 0.045 * dtk);
    const hb = s.screen === 'studio' && !s.hideWrist ? s.haptic * 0.5 : 0;
    const hy0 = H * 0.7;
    counts.fill(0);

    // Held notes pull sand toward them.
    const hl = s.holds.filter((o) => o.end > t);
    s.holds = hl;
    const hs = hl.map((o) => [o.x, o.y]);
    for (const hd of s.hands) {
      if (hd.live && hd.live.holdSent && hd.amt * s.handScale > 0.01 && !s.focus) {
        hs.push([hd.x, hd.y]);
      }
    }
    const nh = hs.length;
    const HR = 160;
    const HR2 = HR * HR;

    // v8 notation: the downbeat "breath" (sand eases outward, then settles) and short-lived
    // gathers toward melodic pitch heights. Both are inactive when notation is off.
    const bA = t - s.breathT;
    const bF = 1 - bA / 0.8;
    const brK = bA >= 0 && bA < 0.8 ? s.breathK * bF * bF * 0.001 * rmF : 0;
    const bcx = W * 0.5;
    const bcy = H * 0.55;
    s.gathers = s.gathers.filter((g) => t - g.t0 < 0.6);
    const gs = s.gathers.map((g) => [g.y, g.k * (1 - (t - g.t0) / 0.6) * 0.0018 * rmF]);
    const ng = gs.length;

    // Simulate each grain, then bucket it by (hue, brightness, size) for batched drawing.
    for (let i = 0; i < n; i++) {
      let x = px[i];
      let y = py[i];
      const z = pz[i];
      const a =
        Math.sin(x * 0.0023 + t1) * 1.7 +
        Math.cos(y * 0.0031 - t2) * 1.7 +
        Math.sin((x - y) * 0.0011 + t3) * 2.2 +
        Math.sin(x * 0.0093 + y * 0.0071 + t4) * turb;
      const sp = base * (0.4 + z * 0.9);
      let tx = Math.cos(a) * sp * 1.6;
      let ty = Math.sin(a) * sp * 0.7;
      let ix = 0;
      let iy = 0;
      if (ha > 0.01) {
        const dx = x - hx;
        const dy = y - hy;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 1) {
          const d = Math.sqrt(d2);
          const f = 1 - d / R;
          const ff = f * f;
          const nx = dx / d;
          const ny = dy / d;
          tx += -ny * swirlK * ff * 3.2 + hvx * 0.12 * ff;
          ty += nx * swirlK * ff * 3.2 + hvy * 0.12 * ff;
          iy -= lift * ff * 0.03;
          if (pinchK) {
            ix -= nx * ff * 0.09;
            iy -= ny * ff * 0.09;
          }
        }
      }
      iy +=
        (dBase +
          Math.sin(x * 0.0035 + dT1) * dA1 +
          Math.sin(x * 0.0081 - dT2) * dA2 +
          off[i] * (1 + I * 2.2) -
          y) *
        duneK;
      // v8 notation: downbeat breath and the gather toward held pitches (zero when notation is off).
      if (brK) {
        ix += (x - bcx) * brK;
        iy += (y - bcy) * brK * 0.7;
      }
      for (let q = 0; q < ng; q++) {
        const dy = gs[q][0] - y;
        if (dy < 70 && dy > -70) {
          iy += dy * gs[q][1] * (1 - Math.abs(dy) / 70);
        }
      }
      for (let r = 0; r < nr; r++) {
        const rp = rips[r];
        const dx = x - rp.x;
        const dy = y - rp.y;
        const d2 = dx * dx + dy * dy;
        const lo = rp.r - rp.w;
        const hi = rp.r + rp.w;
        if (d2 < hi * hi && (lo < 0 || d2 > lo * lo) && d2 > 1) {
          const d = Math.sqrt(d2);
          const u = (d - rp.r) / rp.w;
          const kk = u * (1 - Math.abs(u)) * rp.s * rp.life * 0.5;
          ix += (dx / d) * kk;
          iy += (dy / d) * kk;
        }
      }
      for (let q = 0; q < nh; q++) {
        const dx = x - hs[q][0];
        const dy = y - hs[q][1];
        const d2 = dx * dx + dy * dy;
        if (d2 < HR2) {
          const fq = 1 - Math.sqrt(d2) / HR;
          const f2 = fq * fq;
          iy -= f2 * 0.05 * rmF;
          ix -= dx * fq * 0.0006;
          tx *= 1 - fq * 0.5;
          ty *= 1 - fq * 0.7;
        }
      }
      let fade = 1;
      for (let q = 0; q < na; q++) {
        const b = av[q];
        if (b[4]) {
          const ex = (x - (b[0] + b[2]) * 0.5) / ((b[2] - b[0]) * 0.5 + 60);
          const ey = (y - (b[1] + b[3]) * 0.5) / ((b[3] - b[1]) * 0.5 + 60);
          const e2 = ex * ex + ey * ey;
          if (e2 < 1.1) {
            const u = Math.min(1, Math.max(0, (Math.sqrt(e2) - 0.45) / 0.6));
            fade = Math.min(fade, 0.22 + 0.78 * u * u * (3 - 2 * u));
          }
          continue;
        }
        if (x > b[0] - M && x < b[2] + M && y > b[1] - M && y < b[3] + M) {
          const cx = (b[0] + b[2]) * 0.5;
          const cy = (b[1] + b[3]) * 0.5;
          const hw = (b[2] - b[0]) * 0.5 - 14;
          const hh = (b[3] - b[1]) * 0.5 - 14;
          const qx = Math.max(Math.abs(x - cx) - hw, 0);
          const qy = Math.max(Math.abs(y - cy) - hh, 0);
          const dd = Math.sqrt(qx * qx + qy * qy);
          const u = Math.min(1, dd / (M + 14));
          fade = Math.min(fade, u * u * (3 - 2 * u));
        }
      }
      vx[i] += (tx - vx[i]) * inert + ix * dtk + (Math.random() - 0.5) * 0.06 * dtk;
      vy[i] += (ty - vy[i]) * inert + iy * dtk + (Math.random() - 0.5) * 0.06 * dtk;
      x += vx[i] * dtk;
      y += vy[i] * dtk;
      if (x < 0 || x > W || y < 0 || y > H) {
        x = Math.random() * W;
        y = this.duneY(x, t) + off[i];
        vx[i] = 0;
        vy[i] = 0;
      }
      px[i] = x;
      py[i] = y;
      const spd = Math.abs(vx[i]) + Math.abs(vy[i]);
      const br =
        (0.16 + z * 0.5 + Math.min(spd * 0.12, 0.35) + I * 0.22) *
        fade *
        (0.85 + 0.15 * Math.sin(i * 1.7 + t * (0.6 + z)));
      if (br < 0.05) {
        key[i] = 255;
        continue;
      }
      const lv = Math.min(5, ((y > hy0 ? br + (hb * (y - hy0)) / (H - hy0) : br) * 6) | 0);
      const sz = z < 0.4 ? 0 : z < 0.8 ? 1 : 2;
      const kk = (hue[i] * 6 + lv) * 3 + sz;
      key[i] = kk;
      counts[kk]++;
    }

    // Counting sort by bucket, then draw each bucket with one fillStyle.
    let acc = 0;
    for (let q = 0; q < 72; q++) {
      starts[q] = acc;
      acc += counts[q];
    }
    const fill = starts.slice();
    for (let i = 0; i < n; i++) {
      const kk = key[i];
      if (kk !== 255) {
        order[fill[kk]++] = i;
      }
    }
    const SZ = [1, 1.5, 2.1];
    for (let q = 0; q < 72; q++) {
      const c = counts[q];
      if (!c) {
        continue;
      }
      ctx.fillStyle = this.fills[(q / 3) | 0];
      const sz = SZ[q % 3];
      const hs = sz / 2;
      const st = starts[q];
      for (let j = st; j < st + c; j++) {
        const i = order[j];
        ctx.fillRect(px[i] - hs, py[i] - hs, sz, sz);
      }
    }

    // Ripple rings: advance, expire, stroke.
    for (let r = rips.length - 1; r >= 0; r--) {
      const rp = rips[r];
      rp.r += rp.v * dtk;
      rp.life -= rp.decay * dtk;
      if (rp.life <= 0 || rp.r > Math.max(W, H) * 1.2) {
        rips.splice(r, 1);
        continue;
      }
      ctx.strokeStyle = rp.hot
        ? 'rgba(242,189,114,' + 0.08 * rp.life + ')'
        : rp.col
          ? 'rgba(' + rp.col + ',' + 0.05 * rp.life + ')'
          : 'rgba(127,224,236,' + 0.035 * rp.life + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, 6.2832);
      ctx.stroke();
    }

    // v8 notation layer (instrument marks, held-note ribbons, live trail), when enabled.
    this.overlay?.(ctx, t);

    // Hand glow and ring, for each hand in play (the second hand only appears with the camera;
    // the sand's swirl follows the primary hand).
    for (const hd of s.hands) {
      const a = s.focus ? 0 : hd.amt * s.handScale;
      if (a <= 0.02) {
        continue;
      }
      const gr = ctx.createRadialGradient(hd.x, hd.y, 0, hd.x, hd.y, 150);
      gr.addColorStop(0, 'rgba(127,224,236,' + (0.06 + (hd.pinch ? 0.05 : 0)) * a * fa + ')');
      gr.addColorStop(1, 'rgba(127,224,236,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(hd.x - 150, hd.y - 150, 300, 300);
      ctx.strokeStyle = 'rgba(236,230,216,' + Math.min(0.5, 0.35 * a * fa * 2) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hd.x, hd.y, hd.pinch ? 8 : 15, 0, 6.2832);
      ctx.stroke();
    }

    // Floating note / drum labels.
    ctx.font = '500 13px "Geist Mono", monospace';
    ctx.textAlign = 'center';
    for (let f = s.floats.length - 1; f >= 0; f--) {
      const fl = s.floats[f];
      fl.y -= 0.35 * dtk;
      fl.life -= 0.008 * dtk;
      if (fl.life <= 0) {
        s.floats.splice(f, 1);
        continue;
      }
      ctx.fillStyle = 'rgba(236,230,216,' + fl.life * 0.5 + ')';
      ctx.fillText(fl.text, fl.x, fl.y);
    }
  }
}

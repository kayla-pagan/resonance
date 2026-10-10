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

  constructor(sim: Sim) {
    this.sim = sim;
    const cols = [[236, 230, 216], [127, 224, 236], [169, 155, 255], [242, 189, 114]], al = [.07, .14, .25, .4, .58, .82];
    cols.forEach(c => al.forEach(a => this.fills.push('rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')')));
  }

  applyTone(p: TonalBase) { const s = this.sim; s.pp = p.particles; let a = 0; const tot = p.particles.hues.reduce((x, y) => x + y, 0); s.hueW = p.particles.hues.map(x => (a += x / tot)); }
  pickHue() { const w = this.sim.hueW, r = Math.random(); for (let i = 0; i < 4; i++) if (r < w[i]) return i; return 0; }

  /** Sizes the backing store to the canvas box. Returns false if the canvas is gone. */
  resize(c: HTMLCanvasElement | null) {
    const s = this.sim; if (!c) return false;
    const r = c.getBoundingClientRect(); const oW = s.W, oH = s.H;
    s.W = Math.max(1, r.width); s.H = Math.max(1, r.height); s.ox = r.left; s.oy = r.top;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(s.W * dpr); c.height = Math.round(s.H * dpr);
    this.ctx = c.getContext('2d'); if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.n && oW > 1) { for (let i = 0; i < s.n; i++) { s.px[i] *= s.W / oW; s.py[i] *= s.H / oH; } }
    return true;
  }

  duneY(x: number, t: number) { const H = this.sim.H; return H * .64 + Math.sin(x * .0035 + t * .03) * H * .06 + Math.sin(x * .0081 - t * .05) * H * .025; }

  initParticles(density: Density | undefined) {
    const s = this.sim;
    const base = { Light: 3500, Balanced: 6500, Dense: 11000 }[density || 'Balanced'] || 6500;
    const area = Math.min(1.6, Math.max(.5, (s.W * s.H) / (1440 * 900)));
    const n = Math.round(base * area * (s.reduced ? .5 : 1));
    s.n = n; s.px = new Float32Array(n); s.py = new Float32Array(n); s.vx = new Float32Array(n); s.vy = new Float32Array(n);
    s.pz = new Float32Array(n); s.off = new Float32Array(n); s.hue = new Uint8Array(n); s.key = new Uint8Array(n);
    s.order = new Int32Array(n); s.counts = new Int32Array(72); s.starts = new Int32Array(72);
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * s.W; s.px[i] = x; s.pz[i] = Math.pow(Math.random(), .8); s.off[i] = g() * 55;
      s.py[i] = Math.random() < .62 ? this.duneY(x, s.t) + s.off[i] : Math.random() * s.H;
      s.hue[i] = this.pickHue();
    }
  }

  /** One frame: intensity easing, particle physics, ripples, hand glow and floating labels. */
  render(dtk: number, trails: number | undefined) {
    const s = this.sim, h = s.hand, ctx = this.ctx; if (!ctx) return;
    const t = s.t, W = s.W, H = s.H;
    const running = !!s.clock;
    const target = s.focus ? Math.min(1, .05 + s.boost * .6) : Math.min(1, .08 + (running && s.screen === 'studio' ? .22 : 0) + s.energy * .32 + (h.pinch ? .28 : 0) + s.boost);
    s.intensity += (target * (s.silent ? .65 : 1) - s.intensity) * Math.min(1, .03 * dtk);
    s.haptic *= Math.pow(.93, dtk); s.noteFlash *= Math.pow(.95, dtk); s.boost *= Math.pow(.97, dtk);
    const trl = trails ?? .6;
    ctx.globalCompositeOperation = 'destination-out';
    const fa = s.reduced ? .5 : Math.max(.06, .42 - trl * .5);
    ctx.fillStyle = 'rgba(0,0,0,' + fa + ')'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const { px, py, vx, vy, pz, off, hue, key, counts, starts, order } = s; const n = s.n, pp = s.pp || { speed: 1, turb: 1 };
    if (!s.reduced) { const kk = Math.max(1, (n * .003) | 0); for (let j = 0; j < kk; j++) hue[(Math.random() * n) | 0] = this.pickHue(); }
    { const rs = Math.max(1, (n * .002 * dtk) | 0); for (let j = 0; j < rs; j++) { const i = (Math.random() * n) | 0, x = Math.random() * W; px[i] = x; py[i] = this.duneY(x, t) + off[i]; vx[i] = 0; vy[i] = 0; } }
    const I = s.intensity, rmF = s.reduced ? .45 : 1, breath = .5 + .5 * Math.sin(t * .55);
    const base = (.22 + .18 * breath + I * 1.9) * rmF * pp.speed;
    const hvx = Math.max(-6, Math.min(6, h.vx)), hvy = Math.max(-6, Math.min(6, h.vy)), hx = h.x, hy = h.y, R = s.reduced ? 170 : 230, R2 = R * R, ha = s.focus ? 0 : h.amt * s.handScale;
    const lift = (.25 + (1 - hy / H) * 1.1) * ha, swirlK = (.9 + Math.min(h.speed, 18) * .06) * ha * rmF, pinchK = h.pinch ? 1 : 0;
    const turb = (.35 + I * 1.2) * pp.turb, duneK = .0004 * (1 - I * .6);
    const t1 = t * .07, t2 = t * .05, t3 = t * .03, t4 = t * .35, dT1 = t * .03, dT2 = t * .05, dBase = H * .64, dA1 = H * .06, dA2 = H * .025;
    const rips = s.ripples, nr = rips.length, av = s.avoid, na = av.length, M = 34, inert = Math.min(1, .045 * dtk);
    const hb = s.screen === 'studio' && !s.hideWrist ? s.haptic * .5 : 0, hy0 = H * .7;
    counts.fill(0);
    const hl = s.holds.filter(o => o.end > t); s.holds = hl; const hs = hl.map(o => [o.x, o.y]); if (s.live && s.live.holdSent && ha > .01) hs.push([h.x, h.y]); const nh = hs.length, HR = 160, HR2 = HR * HR;
    for (let i = 0; i < n; i++) {
      let x = px[i], y = py[i]; const z = pz[i];
      const a = Math.sin(x * .0023 + t1) * 1.7 + Math.cos(y * .0031 - t2) * 1.7 + Math.sin((x - y) * .0011 + t3) * 2.2 + Math.sin(x * .0093 + y * .0071 + t4) * turb;
      const sp = base * (.4 + z * .9);
      let tx = Math.cos(a) * sp * 1.6, ty = Math.sin(a) * sp * .7, ix = 0, iy = 0;
      if (ha > .01) {
        const dx = x - hx, dy = y - hy, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 1) {
          const d = Math.sqrt(d2), f = 1 - d / R, ff = f * f, nx = dx / d, ny = dy / d;
          tx += -ny * swirlK * ff * 3.2 + hvx * .12 * ff; ty += nx * swirlK * ff * 3.2 + hvy * .12 * ff;
          iy -= lift * ff * .03;
          if (pinchK) { ix -= nx * ff * .09; iy -= ny * ff * .09; }
        }
      }
      iy += (dBase + Math.sin(x * .0035 + dT1) * dA1 + Math.sin(x * .0081 - dT2) * dA2 + off[i] * (1 + I * 2.2) - y) * duneK;
      for (let r = 0; r < nr; r++) {
        const rp = rips[r], dx = x - rp.x, dy = y - rp.y, d2 = dx * dx + dy * dy, lo = rp.r - rp.w, hi = rp.r + rp.w;
        if (d2 < hi * hi && (lo < 0 || d2 > lo * lo) && d2 > 1) { const d = Math.sqrt(d2), u = (d - rp.r) / rp.w, kk = u * (1 - Math.abs(u)) * rp.s * rp.life * .5; ix += dx / d * kk; iy += dy / d * kk; }
      }
      for (let q = 0; q < nh; q++) { const dx = x - hs[q][0], dy = y - hs[q][1], d2 = dx * dx + dy * dy; if (d2 < HR2) { const fq = 1 - Math.sqrt(d2) / HR, f2 = fq * fq; iy -= f2 * .05 * rmF; ix -= dx * fq * .0006; tx *= 1 - fq * .5; ty *= 1 - fq * .7; } }
      let fade = 1;
      for (let q = 0; q < na; q++) {
        const b = av[q];
        if (b[4]) {
          const ex = (x - (b[0] + b[2]) * .5) / ((b[2] - b[0]) * .5 + 60), ey = (y - (b[1] + b[3]) * .5) / ((b[3] - b[1]) * .5 + 60);
          const e2 = ex * ex + ey * ey;
          if (e2 < 1.1) { const u = Math.min(1, Math.max(0, (Math.sqrt(e2) - .45) / .6)); fade = Math.min(fade, .22 + .78 * u * u * (3 - 2 * u)); }
          continue;
        }
        if (x > b[0] - M && x < b[2] + M && y > b[1] - M && y < b[3] + M) {
          const cx = (b[0] + b[2]) * .5, cy = (b[1] + b[3]) * .5, hw = (b[2] - b[0]) * .5 - 14, hh = (b[3] - b[1]) * .5 - 14;
          const qx = Math.max(Math.abs(x - cx) - hw, 0), qy = Math.max(Math.abs(y - cy) - hh, 0), dd = Math.sqrt(qx * qx + qy * qy);
          const u = Math.min(1, dd / (M + 14)); fade = Math.min(fade, u * u * (3 - 2 * u));
        }
      }
      vx[i] += (tx - vx[i]) * inert + ix * dtk + (Math.random() - .5) * .06 * dtk; vy[i] += (ty - vy[i]) * inert + iy * dtk + (Math.random() - .5) * .06 * dtk;
      x += vx[i] * dtk; y += vy[i] * dtk;
      if (x < 0 || x > W || y < 0 || y > H) { x = Math.random() * W; y = this.duneY(x, t) + off[i]; vx[i] = 0; vy[i] = 0; }
      px[i] = x; py[i] = y;
      const spd = Math.abs(vx[i]) + Math.abs(vy[i]);
      const br = (.16 + z * .5 + Math.min(spd * .12, .35) + I * .22) * fade * (.85 + .15 * Math.sin(i * 1.7 + t * (.6 + z)));
      if (br < .05) { key[i] = 255; continue; }
      const lv = Math.min(5, ((y > hy0 ? br + hb * (y - hy0) / (H - hy0) : br) * 6) | 0), sz = z < .4 ? 0 : z < .8 ? 1 : 2;
      const kk = (hue[i] * 6 + lv) * 3 + sz; key[i] = kk; counts[kk]++;
    }
    let acc = 0; for (let q = 0; q < 72; q++) { starts[q] = acc; acc += counts[q]; }
    const fill = starts.slice();
    for (let i = 0; i < n; i++) { const kk = key[i]; if (kk !== 255) order[fill[kk]++] = i; }
    const SZ = [1, 1.5, 2.1];
    for (let q = 0; q < 72; q++) {
      const c = counts[q]; if (!c) continue;
      ctx.fillStyle = this.fills[(q / 3) | 0]; const sz = SZ[q % 3], hs = sz / 2, st = starts[q];
      for (let j = st; j < st + c; j++) { const i = order[j]; ctx.fillRect(px[i] - hs, py[i] - hs, sz, sz); }
    }
    for (let r = rips.length - 1; r >= 0; r--) {
      const rp = rips[r]; rp.r += rp.v * dtk; rp.life -= rp.decay * dtk;
      if (rp.life <= 0 || rp.r > Math.max(W, H) * 1.2) { rips.splice(r, 1); continue; }
      ctx.strokeStyle = rp.hot ? 'rgba(242,189,114,' + (.08 * rp.life) + ')' : rp.col ? 'rgba(' + rp.col + ',' + (.05 * rp.life) + ')' : 'rgba(127,224,236,' + (.035 * rp.life) + ')';
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r, 0, 6.2832); ctx.stroke();
    }
    if (ha > .02) {
      const gr = ctx.createRadialGradient(hx, hy, 0, hx, hy, 150);
      gr.addColorStop(0, 'rgba(127,224,236,' + ((.06 + (h.pinch ? .05 : 0)) * ha * fa) + ')'); gr.addColorStop(1, 'rgba(127,224,236,0)');
      ctx.fillStyle = gr; ctx.fillRect(hx - 150, hy - 150, 300, 300);
      ctx.strokeStyle = 'rgba(236,230,216,' + Math.min(.5, .35 * ha * fa * 2) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hx, hy, h.pinch ? 8 : 15, 0, 6.2832); ctx.stroke();
    }
    ctx.font = '500 13px "Geist Mono", monospace'; ctx.textAlign = 'center';
    for (let f = s.floats.length - 1; f >= 0; f--) {
      const fl = s.floats[f]; fl.y -= .35 * dtk; fl.life -= .008 * dtk;
      if (fl.life <= 0) { s.floats.splice(f, 1); continue; }
      ctx.fillStyle = 'rgba(236,230,216,' + (fl.life * .5) + ')'; ctx.fillText(fl.text, fl.x, fl.y);
    }
  }
}

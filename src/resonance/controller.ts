import * as R from './engine';
import type { Channel, HapticCmd, PerfLayer } from './engine';
import { ParticleField } from './particleField';
import { createSim, type Sim, type Transport } from './sim';
import type { AppState, Feel, PrototypeProps, StatePatch, UiStore } from './appState';

export interface ControllerHost {
  getState(): AppState;
  setState(patch: StatePatch): void;
  ui: UiStore;
  props: PrototypeProps;
  rootRef: { current: HTMLDivElement | null };
  canvasRef: { current: HTMLCanvasElement | null };
  stageRef: { current: HTMLDivElement | null };
}

interface PointerLike { clientX: number; clientY: number; button?: number; pointerType?: string }

/**
 * The imperative half of the v7 prototype component: input, hand model, live gestures,
 * tutorial ghost hand, pulse finding, haptic routing core and the frame loop that drives
 * the particle field. Method bodies are ported from Resonance v7.dc.html.
 *
 * Subsystems not migrated yet are kept as named stubs (see "Pending" below) so the
 * ported call sites stay identical to the prototype.
 */
export class ResonanceController {
  private host: ControllerHost;
  sim: Sim;
  field: ParticleField;
  hap = new R.HapticRouter();
  perf: { layers: PerfLayer[] } = { layers: [] };
  ver = 0;
  private raf = 0; private last = 0; private uiTimer = 0; private avTimer = 0; private fmT = 0;
  private lastFlick = 0; private lp: { y: number; t: number } | null = null; private td: { y: number; t: number } | null = null;
  private ps: { reduced: boolean; screen: string; step: number; focus: string | null } | null = null;

  FEELS: [Feel, string][] = [['full', 'Full'], ['rhythm', 'Pulse'], ['expression', 'Expression'], ['off', 'Off']];
  QUANTS: [AppState['quant'], string][] = [['off', 'Off'], ['loose', 'Loose'], ['balanced', 'Balanced']];
  FEEL_MSG: Record<Feel, string> = { full: 'Feel both channels.', rhythm: 'Feel only the beat.', expression: 'Feel notes and accents.', off: 'Touch is off.' };

  constructor(host: ControllerHost) {
    this.host = host;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const screen = host.props.startScreen || 'welcome';
    this.sim = createSim(screen, reduced);
    this.field = new ParticleField(this.sim);
    this.boot(reduced, screen);
  }

  private get state() { return this.host.getState(); }
  private setState(patch: StatePatch) { this.host.setState(patch); }

  private boot(reduced: boolean, screen: AppState['screen']) {
    this.hap.hw.onState(bandHw => this.setState({ bandHw }));
    if (!R.BluetoothHapticTransport.supported()) this.hap.hw.setState('unavailable');
    this.field.applyTone(this.tone0());
    this.resize();
    const h = this.sim.hand; h.x = h.tx = h.px = this.sim.W * .5; h.y = h.ty = h.py = this.sim.H * .5;
    this.field.initParticles(this.host.props.density);
    window.addEventListener('resize', this.resize); window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp); window.addEventListener('pointerup', this.onUp);
    this.last = performance.now(); this.raf = requestAnimationFrame(this.loop);
    this.uiTimer = window.setInterval(this.pushUI, 66); this.avTimer = window.setInterval(this.measureAvoid, 350);
    this.setState({ reduced, screen });
  }

  destroy() {
    cancelAnimationFrame(this.raf); clearInterval(this.uiTimer); clearInterval(this.avTimer); clearTimeout(this.fmT);
    window.removeEventListener('resize', this.resize); window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp); window.removeEventListener('pointerup', this.onUp);
    // Pending (camera): stop the media stream and close the hand tracker.
    this.hap.hw.disconnect();
    // Pending (audio): close the AudioContext.
  }

  /** The prototype's componentDidUpdate: pushes React state into the sim. */
  didUpdate(st: AppState) {
    const s = this.sim, ps = this.ps;
    this.ps = { reduced: st.reduced, screen: st.screen, step: st.step, focus: st.focus };
    s.screen = st.screen; s.step = st.step; s.muted = st.muted;
    if (ps && ps.reduced !== st.reduced) { s.reduced = st.reduced; this.field.initParticles(this.host.props.density); }
    // Pending (transport): rebuildMaster() when quant changes. Pending (audio): applyGain() when muted changes.
    if (!ps || ps.screen !== st.screen || ps.step !== st.step || ps.focus !== st.focus) setTimeout(this.measureAvoid, 60);
  }

  // ---- tonal base (fixed)
  tone0() { return R.TONE; }

  // ---- haptic routing core. Single exit point: Feel mode and Hear-only filter here, then the router fans out to simulated + ESP32.
  chanAllowed(ch: Channel) { const f = this.state.feel; return f === 'full' || f === ch; }
  sendHaptics(cmds: HapticCmd[], cue?: string) {
    const s = this.sim; if (s.noHaptic || !cmds || !cmds.length) return;
    const out = cmds.filter(c => this.chanAllowed(c.channel)); if (!out.length) return;
    this.hap.send(out);
    const lf = s.lastFire; out.forEach(c => { lf[c.channel] = s.t; });
    if (Math.abs(lf.rhythm - lf.expression) < .06 && s.t - (s.bothT || -9) > .2) { s.bothT = s.t; s.boost = Math.min(.6, s.boost + .14); s.ripples.push({ x: s.W * .5, y: s.H * .55, r: 0, v: s.reduced ? 3 : 5, w: 120, s: .55 * (s.reduced ? .4 : 1), life: 1, decay: .01 }); }
    let m = 0; out.forEach(c => { if (c.intensity > m) m = c.intensity; }); s.haptic = Math.max(s.haptic, m * .9);
    if (cue) { s.lastCue = cue; s.cueT = s.t; }
  }

  melodyVisual(x: number, y: number, name: string, big: boolean, fromScore: boolean, accent: boolean) {
    const s = this.sim, rm = (s.reduced ? .4 : 1) * (s.focus ? .6 : 1);
    s.ripples.push({ x, y, r: 0, v: big ? 5.5 : 3.6, w: big ? 56 : 40, s: (big ? 2.4 : 1.3) * rm * (accent ? 1.2 : 1), life: 1, decay: big ? .011 : .016, hot: 1 });
    if (s.ripples.length > 16) s.ripples.shift();
    if (!s.focus) {
      const lf = s.floats[s.floats.length - 1];
      if (!big && lf && lf.held && lf.life > .4) { lf.x = x; lf.y = y - 30; lf.text = name; lf.life = 1; }
      else { s.floats.push({ x, y: y - 30, text: name, life: 1, held: !fromScore }); if (s.floats.length > 12) s.floats.shift(); }
    }
    s.noteFlash = 1; s.boost = Math.min(.5, s.boost + .18 * (s.focus ? .4 : 1));
  }

  resize = () => {
    if (!this.field.resize(this.host.canvasRef.current)) return;
    if (window.innerWidth !== this.state.vw || window.innerHeight !== this.state.vh) this.setState({ vw: window.innerWidth, vh: window.innerHeight });
    this.measureAvoid();
  };
  measureAvoid = () => {
    const root = this.host.rootRef.current, s = this.sim; if (!root) return;
    const out: Sim['avoid'] = [];
    root.querySelectorAll('[data-avoid]').forEach(el => { const b = el.getBoundingClientRect(); if (b.width > 0) out.push([b.left - s.ox, b.top - s.oy, b.right - s.ox, b.bottom - s.oy, el.getAttribute('data-avoid') === 'soft' ? 1 : 0]); });
    s.avoid = out;
    const sg = this.host.stageRef.current;
    if (sg && this.state.screen === 'studio') { const b = sg.getBoundingClientRect(); s.band = b.height > 40 ? [b.top - s.oy, b.bottom - s.oy] : null; } else s.band = null;
  };
  slotAt(y: number) { const bd = this.sim.band; const ny = bd ? (y - bd[0]) / (bd[1] - bd[0]) : (y / this.sim.H - .08) / .84; return Math.max(0, Math.min(5, Math.floor((1 - ny) * 6))); }
  yForSlot(i: number) { const bd = this.sim.band; return bd ? bd[0] + (1 - (i + .5) / 6) * (bd[1] - bd[0]) : ((1 - (i + .5) / 6) * .84 + .08) * this.sim.H; }
  fmt(sec: number) { const m = Math.floor(sec / 60), r = sec - m * 60; return String(m).padStart(2, '0') + ':' + r.toFixed(1).padStart(4, '0'); }
  setTransport(tr: Transport, extra?: Partial<AppState>) { this.sim.transport = tr; this.setState(Object.assign({ transport: tr }, extra || {})); }

  // ---- input + live melody
  onMove = (e: PointerLike) => {
    const s = this.sim; const h = s.hand; if (s.handSeen && s.t - s.handSeen < .6) return;
    h.tx = e.clientX - s.ox; h.ty = e.clientY - s.oy; h.lastMove = s.t; s.mouseT = s.t; if (h.ghostPinch) { h.ghostPinch = false; this.pinchEnd(); }
    const now = performance.now(), lp = this.lp; this.lp = { y: e.clientY, t: now };
    if (lp && !h.pinch && !s.focus && (s.screen === 'studio' || s.screen === 'tutorial')) {
      const dt = now - lp.t, dy = e.clientY - lp.y;
      if (dt > 0 && dt < 60 && dy > 18 && dy / dt > 2.6 && now - (this.lastFlick || 0) > 450) { this.lastFlick = now; this.flick(h.tx, h.ty); }
    }
  };
  onDown = (e: PointerLike) => { if (e.button !== 0) return; this.td = e.pointerType === 'touch' ? { y: e.clientY, t: performance.now() } : null; const st = this.state; if (st.showA11y || st.showChar || st.showKeys || st.showBand) this.setState({ showA11y: false, showChar: false, showKeys: false, showBand: false }); this.onMove(e); if (this.state.screen === 'tempo') this.ensureAudio(); this.pinchStart(); };
  // Touch fallback: a fast vertical swipe ends as an accent, same event as a camera flick.
  onUp = (e: PointerEvent) => {
    const td = this.td; this.td = null;
    if (td && e && (this.state.screen === 'studio' || this.state.screen === 'tutorial')) {
      const dt = performance.now() - td.t, dy = e.clientY - td.y;
      if (dt < 320 && Math.abs(dy) > 70 && Math.abs(dy) / dt > .6 && performance.now() - (this.lastFlick || 0) > 450) { this.lastFlick = performance.now(); const h0 = this.sim.hand; this.pinchEnd(); this.flick(h0.x, h0.y); return; }
    }
    const h = this.sim.hand; if (h && h.pinch && !h.ghostPinch && !h.camPinch) this.pinchEnd(); };
  pinchStart() { const s = this.sim, h = s.hand; if (s.focus || h.pinch) return; h.pinch = true; h.lastMove = s.t; if (this.liveInst() === 'drums') this.drumHit(); else this.noteOn(this.slotAt(h.y), false); }
  pinchEnd() { const s = this.sim, h = s.hand; if (!h.pinch) return; h.pinch = false; this.noteOff(false); s.heldNote = -1; s.ripples.push({ x: h.x, y: h.y, r: 0, v: 3, w: 50, s: .6 * (s.reduced ? .4 : 1), life: 1, decay: .018 }); }
  // Strength comes from body movement energy: big movement = louder note, stronger expression pulse.
  liveVel() { return Math.max(.45, Math.min(1, .45 + this.sim.energy * .6)); }
  noteOn(slot: number, slur: boolean) {
    const s = this.sim, h = s.hand, p = this.tone0(), inst = this.liveInst(), midi = R.midiFor(inst, slot, p), vel = this.liveVel(), acc = vel >= .85;
    s.live = { start: s.t, slot, midi, vel, slur, holdSent: false, inst }; s.heldNote = slot;
    this.melodyVisual(h.x, h.y, R.noteName(midi), !slur, false, acc);
    if (this.audible()) this.noteStart(midi, vel, inst);
    if (s.screen === 'studio') this.sendHaptics(R.compile({ layer: 'melody', velocity: vel, accent: acc, articulation: 'normal', duration: .1 }), acc ? 'Expression · accent' : 'Expression · note');
  }
  noteOff(slurring: boolean) {
    const s = this.sim, n = s.live; if (!n) return;
    const dur = s.t - n.start;
    if (n.holdSent) this.hap.send([R.releaseCmd('expression')]);
    this.noteEnd(n.midi, n.inst);
    const art = slurring || n.slur ? 'legato' : dur < .22 ? 'staccato' : dur > .5 ? 'legato' : 'normal';
    if (!n.done) this.recEvent({ layer: 'note', dur, slot: n.slot, vel: n.vel, art, accent: n.vel >= .85 }, n.start);
    s.live = null;
  }
  // Which voice receives live gestures. Drums until a loop exists; then the layer being recorded or the last one chosen.
  liveInst() { const s = this.sim; if (s.screen === 'tempo') return 'drums'; if (s.screen !== 'studio') return 'lead'; if (s.rec) return s.rec.inst; const tr = s.transport; if (tr === 'ready' || tr === 'finding' || !this.perf.layers.length) return 'drums'; return s.inst || 'drums'; }
  drumHit() {
    const s = this.sim, h = s.hand, slot = this.slotAt(h.y), drum = R.DRUM_OF_SLOT[slot], vel = this.liveVel(), rm = s.reduced ? .4 : 1;
    s.ripples.push({ x: h.x, y: h.y, r: 0, v: s.reduced ? 3 : 4.6, w: 44, s: (drum === 'kick' ? 1.9 : drum === 'snare' ? 1.25 : .7) * rm, life: 1, decay: .022, hot: drum === 'kick' ? 1 : 0 });
    if (s.ripples.length > 16) s.ripples.shift();
    s.floats.push({ x: h.x, y: h.y - 30, text: R.DRUM_NAME[drum], life: .9 }); if (s.floats.length > 12) s.floats.shift();
    s.noteFlash = 1; s.boost = Math.min(.5, s.boost + (drum === 'kick' ? .16 : .08));
    if (this.audible()) this.drumSound(drum, vel);
    const finding = s.transport === 'finding';
    this.sendHaptics(finding ? [{ channel: 'rhythm', intensity: .85, duration: 80, type: 'drum' }] : R.compile({ layer: 'drum', drum, velocity: vel }), finding ? 'Pulse · hit' : R.describe({ layer: 'drum', drum }));
    if (finding) this.pulseHit();
    this.recEvent({ layer: 'drum', drum, slot, vel, dur: .08, art: 'staccato', accent: vel >= .85 }, s.t);
  }
  onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (this.state.screen === 'tempo') { const kk = e.key.toLowerCase(); if ((kk === 'j' || kk === 'enter') && !e.repeat && tag !== 'BUTTON') { this.sim.hand.ghostPinch = false; this.pinchStart(); } return; }
    if (this.state.screen !== 'studio') return;
    const onBtn = tag === 'BUTTON' || tag === 'INPUT';
    const k = e.key.toLowerCase(), s = this.sim, h = s.hand;
    if (k === 'escape') { if (this.state.focus) this.closeFocus(); else this.setState({ showKeys: false, showA11y: false, showChar: false, showBand: false, pick: false }); return; }
    if (this.state.focus) { if (k === ' ' && !onBtn && this.state.focus === 'feel') { e.preventDefault(); this.feelPlay(); } else if (k === 'f') this.cycleFeel(); return; }
    if (k.startsWith('arrow')) {
      e.preventDefault(); const stp = 44;
      if (k === 'arrowup') h.ty = Math.max(0, h.ty - stp); if (k === 'arrowdown') h.ty = Math.min(s.H, h.ty + stp);
      if (k === 'arrowleft') h.tx = Math.max(0, h.tx - stp); if (k === 'arrowright') h.tx = Math.min(s.W, h.tx + stp);
      h.lastMove = s.t; s.mouseT = s.t; return;
    }
    if (e.repeat) return;
    if (k === ' ' && !onBtn) { e.preventDefault(); this.togglePlay(); }
    else if (k === 'r') this.primary();
    else if (k === 's') this.stop();
    else if (k === 'c') this.toggleClick();
    else if (this.state.pick && k >= '1' && k <= '4') { const a = this.available()[+k - 1]; if (a) this.armRecord(a); }
    else if (k === 'x') this.reset();
    else if (k === 'm') this.toggleMute();
    else if (k === 'f') this.cycleFeel();
    else if (k === 'q') { const i = this.QUANTS.findIndex(q => q[0] === this.state.quant); this.setState({ quant: this.QUANTS[(i + 1) % 3][0] }); }
    else if (e.key === '?') this.setState(st => ({ showKeys: !st.showKeys }));
    else if (k === 'j' || (k === 'enter' && !onBtn)) { h.ghostPinch = false; this.pinchStart(); }
    else if (k === 'a') this.flick(h.x, h.y);
  };
  onKeyUp = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); /* also ends tempo-screen hits */ if ((k === 'j' || k === 'enter') && this.sim.hand.pinch) this.pinchEnd(); };
  cycleFeel() { const i = this.FEELS.findIndex(f => f[0] === this.state.feel); this.setFeel(this.FEELS[(i + 1) % 4][0]); }
  setFeel(k: Feel) { clearTimeout(this.fmT); this.setState({ feel: k, feelMsg: this.FEEL_MSG[k], feelMsgOn: true }); this.fmT = window.setTimeout(() => this.setState({ feelMsgOn: false }), 2600); }
  audible() { const s = this.sim; return s.audioOn && !s.muted && !s.silent && (s.screen === 'studio' || s.screen === 'tempo'); }
  available() { const used = this.perf.layers.map(l => l.inst); return R.INSTR_ORDER.filter(k => !used.includes(k)); }
  toggleClick = () => this.setState(x => ({ clickOn: !x.clickOn }));
  toggleMute = () => { if (!this.state.audioOn) return; this.setState(st => ({ muted: !st.muted })); };

  // ---- tempo: −/+ sets the tempo; Find my pulse taps it in; Start carries it into the studio.
  findPulse = () => { const s = this.sim; this.ensureAudio(); s.prevBpm = this.state.bpm; s.clock = null; s.pulseHits = []; s.beatInBar = -1; this.setTransport('finding', { bpm: null, pick: false, pulse: { n: 0, msg: '' }, prevBpm: s.prevBpm }); };
  cancelPulse() { const s = this.sim, pb = s.prevBpm; s.pulseHits = []; if (pb) { this.startMaster(s.t, pb); this.setTransport('found', { bpm: pb, pulse: { n: 0, msg: '' } }); } else this.setTransport('ready', { pulse: { n: 0, msg: '' } }); }
  tempoAdj(d: number) {
    const s = this.sim, bpm = Math.max(60, Math.min(180, (this.state.bpm || s.prevBpm || 100) + d)); this.ensureAudio(); s.pulseHits = []; s.viaPulse = false;
    this.startMaster(s.t, bpm); this.setTransport('found', { bpm, pulse: { n: 0, msg: '' }, viaPulse: false });
  }
  tempoStart = () => {
    const s = this.sim, bpm = this.state.bpm || s.prevBpm || 100; this.ensureAudio(); s.pulseHits = [];
    if (!s.clock || s.clock.kind !== 'master' || s.transport === 'finding') this.startMaster(s.t, bpm);
    this.setTransport('found', { bpm, screen: 'studio', pulse: { n: 0, msg: '' } });
  };
  pulseHit() {
    const s = this.sim, now = performance.now() / 1000; let hs = s.pulseHits; const last = hs[hs.length - 1];
    if (last != null && now - last > 2.5) hs = s.pulseHits = [];
    else if (last != null && now - last < .18) return;
    hs.push(now);
    const r = R.estimateBpm(hs);
    if (r.ok) return this.pulseFound(r.bpm as number, s.t);
    if (hs.length >= 8) { s.pulseHits = []; return this.setState({ pulse: { n: 0, msg: 'uneven' } }); }
    this.setState({ pulse: { n: hs.length, msg: '' } });
  }
  // The last steady hit becomes beat 1 of the master loop, so the metronome carries on from the performer's own pulse.
  pulseFound(bpm: number, at: number) {
    const s = this.sim; s.pulseHits = []; s.viaPulse = true;
    this.startMaster(at, bpm);
    s.ripples.push({ x: s.W * .5, y: s.H * .55, r: 0, v: 6, w: 130, s: 1.1 * (s.reduced ? .4 : 1), life: 1, decay: .007 }); s.boost = Math.min(.6, s.boost + .25);
    this.setTransport('found', { bpm, pulse: { n: 0, msg: '' }, scoreVer: ++this.ver, viaPulse: true });
  }

  // Flick = musical hit: big wave, both motors, accent sound. Recorded into the loop like any other event.
  flick(x: number, y: number) {
    const s = this.sim; if (s.focus) return; const rm = s.reduced ? .4 : 1;
    s.ripples.push({ x, y, r: 0, v: s.reduced ? 4 : 6.5, w: 100, s: .95 * rm, life: 1, decay: .012, hot: 1 });
    if (s.ripples.length > 16) s.ripples.shift();
    s.boost = Math.min(.5, s.boost + .25); s.haptic = Math.max(s.haptic, .9); s.flickT = s.t;
    if (s.screen === 'studio') this.sendHaptics(R.compile({ layer: 'hit' }), 'Both motors · flick');
    if (this.audible()) this.hitSound();
    if (s.transport === 'finding') this.pulseHit();
    this.recEvent({ layer: 'hit', dur: .1, slot: -1, vel: 1, art: 'staccato', accent: true, gesture: 'flick' }, s.t);
  }

  // ---- frame
  private loop = (now: number) => { this.raf = requestAnimationFrame(this.loop); const dt = Math.min(.05, (now - this.last) / 1000) || .016; this.last = now; this.step(dt); };
  private step(dt: number) {
    const s = this.sim, h = s.hand; if (!this.field.ctx || !s.n) return;
    s.t += dt; const t = s.t, W = s.W, H = s.H, dtk = Math.min(dt * 60, 3);
    this.detect();
    if (s.screen !== 'studio' && t - s.mouseT > 2.2) {
      if (s.screen === 'welcome' || s.screen === 'tempo') { h.tx = W * (.5 + .3 * Math.sin(t * .21)); h.ty = H * (.42 + .2 * Math.sin(t * .29 + 1)); }
      else if (s.step === 0) { h.tx = W * .5 + Math.sin(t * .35) * W * .12; h.ty = H * (.46 - .3 * Math.sin(t * .55)); }
      else if (s.step === 1) {
        h.tx = W * .5 + Math.cos(t * .7) * W * .14; h.ty = H * .38 + Math.sin(t * .7) * H * .1;
        const want = (t % 1.9) < .35;
        if (want && !h.pinch) { h.ghostPinch = true; this.pinchStart(); } else if (!want && h.pinch && h.ghostPinch) { h.ghostPinch = false; this.pinchEnd(); }
      } else if (s.step === 2) { const fast = Math.sin(t * .6) > 0, sp = fast ? 1.4 : .6, rr = fast ? .14 : .07; h.tx = W * .5 + Math.cos(t * sp) * W * rr; h.ty = H * .4 + Math.sin(t * sp) * H * rr; }
      else { const ph = t % 3.6; h.tx = W * (.5 + .2 * Math.sin(t * .4)); h.ty = ph < 3 ? H * (.3 + .06 * Math.sin(t * .9)) : H * .72; if (ph >= 3 && !s.ghostFlicked) { s.ghostFlicked = true; this.flick(W * .5, H * .5); } if (ph < 3) s.ghostFlicked = false; }
      h.lastMove = t;
    }
    s.handScale = s.screen === 'welcome' ? .55 : 1;
    const k = 1 - Math.pow(.8, dtk); h.x += (h.tx - h.x) * k; h.y += (h.ty - h.y) * k;
    h.vx = (h.x - h.px) / dtk; h.vy = (h.y - h.py) / dtk; h.px = h.x; h.py = h.y;
    h.speed += (Math.hypot(h.vx, h.vy) - h.speed) * .15;
    const want = (t - h.lastMove < 1.2 || h.pinch) ? 1 : 0; h.amt += (want - h.amt) * Math.min(1, (want ? .08 : .012) * dtk);
    if (h.pinch && s.live) { const slot = this.slotAt(h.y); if (slot !== s.heldNote) { this.noteOff(true); this.noteOn(slot, true); } }
    if (s.live && !s.live.holdSent && t - s.live.start > .25) { s.live.holdSent = true; if (s.screen === 'studio') this.sendHaptics([R.holdCmd(s.live.vel)], 'Expression · held note'); }
    if (s.live && s.live.holdSent && !s.reduced && t - (s.holdRipT || 0) > .4) { s.holdRipT = t; s.ripples.push({ x: h.x, y: h.y, r: 0, v: 2.2, w: 36, s: .5, life: 1, decay: .02 }); if (s.ripples.length > 16) s.ripples.shift(); }
    const eRaw = h.amt > .2 ? Math.min(1, h.speed / 22) : 0; s.energy += (eRaw - s.energy) * Math.min(1, (eRaw > s.energy ? .08 : .02) * dtk);
    // Pending (recording): count-in → recording → finishRecording transitions on s.rec.
    this.clockStep();
    // Pending (transport/haptics UI): playheads, wristband canvases, score autoscroll, tactile module edges.
    this.field.render(dtk, this.host.props.trails);
  }

  pushUI = () => {
    const s = this.sim, h = s.hand, slot = this.slotAt(h.y), p = this.tone0(), inst = this.liveInst(), drums = inst === 'drums', midi = R.midiFor(inst, slot, p), tr = s.transport, c = s.clock, bpm = this.state.bpm;
    let timer = 0, total = 0, count = 0, recBar = 0; const ph = this.clockPhase();
    if (c && c.kind === 'master') { total = c.len; timer = Math.max(0, ph) * c.len; }
    if (s.rec && bpm) { const bt = 60 / bpm; if (tr === 'countin') { const el = s.t - s.rec.ci; count = el < 0 ? 0 : Math.max(1, 4 - Math.floor(el / bt)); } else recBar = Math.min(4, Math.floor((s.t - s.rec.start) / (bt * 4)) + 1); }
    const act: Record<string, boolean> = {}; this.perf.layers.forEach(l => { act[l.id] = s.t - (s.layerFire[l.id] || -9) < .16; });
    const handIn = !!(s.handSeen && s.t - s.handSeen < .5);
    // Pending (audio): Tone filter follows energy and two-hand spread.
    if (handIn !== this.state.handIn) this.setState({ handIn });
    this.host.ui.set({ inst, count, recBar, act, energy: s.energy, slot, name: drums ? R.DRUM_NAME[R.DRUM_OF_SLOT[slot]] : R.noteName(midi), deg: drums ? ['low', 'low', 'mid', 'mid', 'high', 'high'][slot] : p.degrees[slot], zone: R.ZONE_OF_SLOT[slot], nx: Math.max(0, Math.min(1, h.x / s.W)), ny: Math.max(0, Math.min(1, h.y / s.H)), pinch: h.pinch, hap: s.haptic, beat: c ? s.beatInBar : -1, timer: this.fmt(timer), total: total ? ' / ' + this.fmt(total) : '', phase: Math.max(0, ph), bar: ph >= 0 ? Math.min(4, Math.floor(ph * 4) + 1) : 0, flash: s.noteFlash, active: h.amt > .2, cue: s.t - s.cueT < 1.4 ? s.lastCue : '' });
  };

  clockPhase() { const s = this.sim, c = s.clock; if (!c) return -1; const raw = s.t - c.start; return c.loop ? (raw % c.len) / c.len : Math.min(1, raw / c.len); }

  // ---- Pending subsystems. Each stub keeps the prototype's call sites intact until its milestone lands.
  /** Pending (audio): Tone.js / Web Audio init. Until then audioOn stays false, so audible() is false. */
  ensureAudio() {}
  noteStart(_midi: number, _vel: number, _inst: string) {}
  noteEnd(_midi: number, _inst: string) {}
  drumSound(_d: R.DrumKey, _vel: number) {}
  hitSound() {}
  /** Pending (master transport): starts the looping master clock. */
  startMaster(_start: number, _bpm?: number) {}
  clockStep() {}
  togglePlay = () => {};
  primary = () => {};
  stop = () => {};
  reset = () => {};
  /** Pending (recording/playback). */
  recEvent(_r: R.EventInput | Omit<R.EventInput, 't'>, _at: number) {}
  armRecord(_inst: R.InstKey) {}
  /** Pending (focus modes: Feel this loop, Tactile memory). */
  closeFocus = () => {};
  feelPlay = () => {};
  /** Pending (camera + MediaPipe hand tracking). */
  detect() {}
}

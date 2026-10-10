import * as R from './engine';
import type { Channel, HapticCmd, InstKey, MusicEvent, PerfLayer, RawNote } from './engine';
import { ParticleField } from './particleField';
import { createSim, type Sim, type Transport } from './sim';
import {
  availableInstruments,
  type AppState,
  type Feel,
  type PrototypeProps,
  type StatePatch,
  type UiStore,
} from './appState';
import { AudioEngine, type TriggerMeta } from './audioEngine';
import { BAR_STEPS, LOOP_STEPS, MasterTransport } from './masterTransport';
import { drawWrist } from './tactileView';

/** How early (in sixteenths) a hit may land and still count as the next downbeat (v7 value). */
const REC_EARLY = 0.6;

/**
 * A cursor flick followed this quickly by a click is one gesture — travel into a zone, then the
 * hit — so only the click is recorded.
 */
const FLICK_CLICK_MERGE_MS = 200;

/** A recorded event before it is placed on the loop (time and duration are derived on capture). */
type RecInput = Omit<RawNote, 't' | 'dur'> & { dur?: number };

/** Dev-only record of dispatched loop events, for timing verification. */
export interface DispatchLog {
  id: string;
  layer: string;
  lid: string | null;
  t: number;
  time: number;
  abs: number;
  origin: number;
  s16: number;
  run: number;
}

export interface ControllerHost {
  getState(): AppState;
  setState(patch: StatePatch): void;
  ui: UiStore;
  props: PrototypeProps;
  rootRef: { current: HTMLDivElement | null };
  canvasRef: { current: HTMLCanvasElement | null };
  stageRef: { current: HTMLDivElement | null };
  tactile: TactileRefs;
}

/** DOM the controller updates every frame (tactile module, score playhead and marks). */
export interface TactileRefs {
  wrist: { current: HTMLCanvasElement | null };
  box: { current: HTMLDivElement | null };
  edgeL: { current: HTMLSpanElement | null };
  edgeR: { current: HTMLSpanElement | null };
  playhead: { current: HTMLSpanElement | null };
  score: { current: HTMLDivElement | null };
}

interface PointerLike {
  clientX: number;
  clientY: number;
  button?: number;
  pointerType?: string;
}

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
  audio = new AudioEngine();
  transport: MasterTransport;
  perf: { layers: PerfLayer[] } = { layers: [] };
  ver = 0;
  /** Dev builds only: every dispatched loop event, for timing verification. */
  dispatchLog: DispatchLog[] = [];
  private lid = 0;
  private lastAbs = 0;
  /** Score marks currently lit, with the sim time their highlight ends. */
  private lit = new Map<HTMLElement, number>();
  private raf = 0;
  private last = 0;
  private uiTimer = 0;
  private avTimer = 0;
  private fmT = 0;
  private lastFlick = 0;
  /** The most recent cursor flick and the event it recorded, if any. */
  private cursorFlick: { wall: number; ev: RawNote | null } | null = null;
  private lp: { y: number; t: number } | null = null;
  private td: { y: number; t: number } | null = null;
  private ps: {
    reduced: boolean;
    screen: string;
    step: number;
    focus: string | null;
    quant: string;
    muted: boolean;
  } | null = null;

  FEELS: [Feel, string][] = [
    ['full', 'Full'],
    ['rhythm', 'Pulse'],
    ['expression', 'Expression'],
    ['off', 'Off'],
  ];
  QUANTS: [AppState['quant'], string][] = [
    ['off', 'Off'],
    ['loose', 'Loose'],
    ['balanced', 'Balanced'],
  ];
  FEEL_MSG: Record<Feel, string> = {
    full: 'Feel both channels.',
    rhythm: 'Feel only the beat.',
    expression: 'Feel notes and accents.',
    off: 'Touch is off.',
  };

  constructor(host: ControllerHost) {
    this.host = host;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const screen = host.props.startScreen || 'welcome';
    this.sim = createSim(screen, reduced);
    this.field = new ParticleField(this.sim);
    this.transport = new MasterTransport({ onStep: this.onStep, onEvent: this.dispatch });
    if (import.meta.env.DEV) {
      (window as unknown as { __resonance?: ResonanceController }).__resonance = this;
    }
    this.boot(reduced, screen);
  }

  private get state() {
    return this.host.getState();
  }

  private setState(patch: StatePatch) {
    this.host.setState(patch);
  }

  private boot(reduced: boolean, screen: AppState['screen']) {
    this.hap.hw.onState((bandHw) => this.setState({ bandHw }));
    if (!R.BluetoothHapticTransport.supported()) {
      this.hap.hw.setState('unavailable');
    }
    this.field.applyTone(this.tone0());
    this.resize();
    const h = this.sim.hand;
    h.x = h.tx = h.px = this.sim.W * 0.5;
    h.y = h.ty = h.py = this.sim.H * 0.5;
    this.field.initParticles(this.host.props.density);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointerup', this.onUp);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    this.uiTimer = window.setInterval(this.pushUI, 66);
    this.avTimer = window.setInterval(this.measureAvoid, 350);
    this.setState({ reduced, screen });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.uiTimer);
    clearInterval(this.avTimer);
    clearTimeout(this.fmT);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerup', this.onUp);
    // Pending (camera): stop the media stream and close the hand tracker.
    this.hap.hw.disconnect();
    this.transport.dispose();
    this.audio.dispose();
  }

  /** The prototype's componentDidUpdate: pushes React state into the sim. */
  didUpdate(st: AppState) {
    const s = this.sim;
    const ps = this.ps;
    this.ps = {
      reduced: st.reduced,
      screen: st.screen,
      step: st.step,
      focus: st.focus,
      quant: st.quant,
      muted: st.muted,
    };
    s.screen = st.screen;
    s.step = st.step;
    s.muted = st.muted;
    if (ps && ps.reduced !== st.reduced) {
      s.reduced = st.reduced;
      this.field.initParticles(this.host.props.density);
    }
    if (ps && ps.quant !== st.quant) {
      this.rebuildScore();
    }
    if (ps && ps.muted !== st.muted) {
      this.applyGain(st.muted);
    }
    if (!ps || ps.screen !== st.screen || ps.step !== st.step || ps.focus !== st.focus) {
      setTimeout(this.measureAvoid, 60);
    }
  }

  // ---- tonal base (fixed)
  tone0() {
    return R.TONE;
  }

  // ---- haptic routing core
  // Single exit point: Feel mode and Hear-only filter here,
  // then the router fans out to simulated + ESP32.
  chanAllowed(ch: Channel) {
    const f = this.state.feel;
    return f === 'full' || f === ch;
  }

  sendHaptics(cmds: HapticCmd[], cue?: string) {
    const s = this.sim;
    if (s.noHaptic || !cmds || !cmds.length) {
      return;
    }
    const out = cmds.filter((c) => this.chanAllowed(c.channel));
    if (!out.length) {
      return;
    }
    this.hap.send(out);
    const lf = s.lastFire;
    out.forEach((c) => {
      lf[c.channel] = s.t;
    });
    if (Math.abs(lf.rhythm - lf.expression) < 0.06 && s.t - (s.bothT || -9) > 0.2) {
      s.bothT = s.t;
      s.boost = Math.min(0.6, s.boost + 0.14);
      s.ripples.push({
        x: s.W * 0.5,
        y: s.H * 0.55,
        r: 0,
        v: s.reduced ? 3 : 5,
        w: 120,
        s: 0.55 * (s.reduced ? 0.4 : 1),
        life: 1,
        decay: 0.01,
      });
    }
    let m = 0;
    out.forEach((c) => {
      if (c.intensity > m) {
        m = c.intensity;
      }
    });
    s.haptic = Math.max(s.haptic, m * 0.9);
    if (cue) {
      s.lastCue = cue;
      s.cueT = s.t;
    }
  }

  melodyVisual(
    x: number,
    y: number,
    name: string,
    big: boolean,
    fromScore: boolean,
    accent: boolean,
  ) {
    const s = this.sim;
    const rm = (s.reduced ? 0.4 : 1) * (s.focus ? 0.6 : 1);
    s.ripples.push({
      x,
      y,
      r: 0,
      v: big ? 5.5 : 3.6,
      w: big ? 56 : 40,
      s: (big ? 2.4 : 1.3) * rm * (accent ? 1.2 : 1),
      life: 1,
      decay: big ? 0.011 : 0.016,
      hot: 1,
    });
    if (s.ripples.length > 16) {
      s.ripples.shift();
    }
    if (!s.focus) {
      const lf = s.floats[s.floats.length - 1];
      if (!big && lf && lf.held && lf.life > 0.4) {
        lf.x = x;
        lf.y = y - 30;
        lf.text = name;
        lf.life = 1;
      } else {
        s.floats.push({ x, y: y - 30, text: name, life: 1, held: !fromScore });
        if (s.floats.length > 12) {
          s.floats.shift();
        }
      }
    }
    s.noteFlash = 1;
    s.boost = Math.min(0.5, s.boost + 0.18 * (s.focus ? 0.4 : 1));
  }

  resize = () => {
    if (!this.field.resize(this.host.canvasRef.current)) {
      return;
    }
    if (window.innerWidth !== this.state.vw || window.innerHeight !== this.state.vh) {
      this.setState({ vw: window.innerWidth, vh: window.innerHeight });
    }
    this.measureAvoid();
  };

  measureAvoid = () => {
    const root = this.host.rootRef.current;
    const s = this.sim;
    if (!root) {
      return;
    }
    const out: Sim['avoid'] = [];
    root.querySelectorAll('[data-avoid]').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width > 0) {
        out.push([
          b.left - s.ox,
          b.top - s.oy,
          b.right - s.ox,
          b.bottom - s.oy,
          el.getAttribute('data-avoid') === 'soft' ? 1 : 0,
        ]);
      }
    });
    s.avoid = out;
    const sg = this.host.stageRef.current;
    if (sg && this.state.screen === 'studio') {
      const b = sg.getBoundingClientRect();
      s.band = b.height > 40 ? [b.top - s.oy, b.bottom - s.oy] : null;
    } else {
      s.band = null;
    }
  };

  slotAt(y: number) {
    const bd = this.sim.band;
    const ny = bd ? (y - bd[0]) / (bd[1] - bd[0]) : (y / this.sim.H - 0.08) / 0.84;
    return Math.max(0, Math.min(5, Math.floor((1 - ny) * 6)));
  }

  yForSlot(i: number) {
    const bd = this.sim.band;
    return bd
      ? bd[0] + (1 - (i + 0.5) / 6) * (bd[1] - bd[0])
      : ((1 - (i + 0.5) / 6) * 0.84 + 0.08) * this.sim.H;
  }

  fmt(sec: number) {
    const m = Math.floor(sec / 60);
    const r = sec - m * 60;
    return String(m).padStart(2, '0') + ':' + r.toFixed(1).padStart(4, '0');
  }

  setTransport(tr: Transport, extra?: Partial<AppState>) {
    this.sim.transport = tr;
    this.setState(Object.assign({ transport: tr }, extra || {}));
  }

  // ---- input + live melody
  onMove = (e: PointerLike) => {
    const s = this.sim;
    const h = s.hand;
    if (s.handSeen && s.t - s.handSeen < 0.6) {
      return;
    }
    h.tx = e.clientX - s.ox;
    h.ty = e.clientY - s.oy;
    h.lastMove = s.t;
    s.mouseT = s.t;
    if (h.ghostPinch) {
      h.ghostPinch = false;
      this.pinchEnd();
    }
    const now = performance.now();
    const lp = this.lp;
    this.lp = { y: e.clientY, t: now };
    if (lp && !h.pinch && !s.focus && (s.screen === 'studio' || s.screen === 'tutorial')) {
      const dt = now - lp.t;
      const dy = e.clientY - lp.y;
      if (dt > 0 && dt < 60 && dy > 18 && dy / dt > 2.6 && now - (this.lastFlick || 0) > 450) {
        this.lastFlick = now;
        this.flick(h.tx, h.ty, true);
      }
    }
  };

  onDown = (e: PointerLike) => {
    if (e.button !== 0) {
      return;
    }
    this.td = e.pointerType === 'touch' ? { y: e.clientY, t: performance.now() } : null;
    const st = this.state;
    if (st.showA11y || st.showChar || st.showKeys || st.showBand) {
      this.setState({ showA11y: false, showChar: false, showKeys: false, showBand: false });
    }
    this.onMove(e);
    if (this.state.screen === 'tempo') {
      this.ensureAudio();
    }
    this.pinchStart();
  };

  // Touch fallback: a fast vertical swipe ends as an accent, same event as a camera flick.
  onUp = (e: PointerEvent) => {
    const td = this.td;
    this.td = null;
    if (td && e && (this.state.screen === 'studio' || this.state.screen === 'tutorial')) {
      const dt = performance.now() - td.t;
      const dy = e.clientY - td.y;
      if (
        dt < 320 &&
        Math.abs(dy) > 70 &&
        Math.abs(dy) / dt > 0.6 &&
        performance.now() - (this.lastFlick || 0) > 450
      ) {
        this.lastFlick = performance.now();
        const h0 = this.sim.hand;
        this.pinchEnd();
        this.flick(h0.x, h0.y);
        return;
      }
    }
    const h = this.sim.hand;
    if (h && h.pinch && !h.ghostPinch && !h.camPinch) {
      this.pinchEnd();
    }
  };

  pinchStart() {
    const s = this.sim;
    const h = s.hand;
    if (s.focus || h.pinch) {
      return;
    }
    h.pinch = true;
    h.lastMove = s.t;
    this.absorbCursorFlick();
    if (this.liveInst() === 'drums') {
      this.drumHit();
    } else {
      this.noteOn(this.slotAt(h.y), false);
    }
  }

  pinchEnd() {
    const s = this.sim;
    const h = s.hand;
    if (!h.pinch) {
      return;
    }
    h.pinch = false;
    this.noteOff(false);
    s.heldNote = -1;
    s.ripples.push({
      x: h.x,
      y: h.y,
      r: 0,
      v: 3,
      w: 50,
      s: 0.6 * (s.reduced ? 0.4 : 1),
      life: 1,
      decay: 0.018,
    });
  }

  // Strength comes from body movement energy:
  // big movement = louder note, stronger expression pulse.
  liveVel() {
    return Math.max(0.45, Math.min(1, 0.45 + this.sim.energy * 0.6));
  }

  noteOn(slot: number, slur: boolean) {
    const s = this.sim;
    const h = s.hand;
    const p = this.tone0();
    const inst = this.liveInst();
    const midi = R.midiFor(inst, slot, p);
    const vel = this.liveVel();
    const acc = vel >= 0.85;
    s.live = {
      start: s.t,
      startStep: this.transport.nowStep(),
      slot,
      midi,
      vel,
      slur,
      holdSent: false,
      inst,
    };
    s.heldNote = slot;
    this.melodyVisual(h.x, h.y, R.noteName(midi), !slur, false, acc);
    if (this.audible()) {
      this.noteStart(midi, vel, inst);
    }
    if (s.screen === 'studio') {
      this.sendHaptics(
        R.compile({
          layer: 'melody',
          velocity: vel,
          accent: acc,
          articulation: 'normal',
          duration: 0.1,
        }),
        acc ? 'Expression · accent' : 'Expression · note',
      );
    }
  }

  noteOff(slurring: boolean) {
    const s = this.sim;
    const n = s.live;
    if (!n) {
      return;
    }
    const dur = s.t - n.start;
    if (n.holdSent) {
      this.hap.send([R.releaseCmd('expression')]);
    }
    this.noteEnd(n.midi, n.inst);
    const art =
      slurring || n.slur ? 'legato' : dur < 0.22 ? 'staccato' : dur > 0.5 ? 'legato' : 'normal';
    if (!n.done) {
      this.recEvent(
        { layer: 'note', dur, slot: n.slot, vel: n.vel, art, accent: n.vel >= 0.85 },
        n.startStep,
      );
    }
    s.live = null;
  }

  // Which voice receives live gestures. Drums until a loop exists;
  // then the layer being recorded or the last one chosen.
  liveInst() {
    const s = this.sim;
    if (s.screen === 'tempo') {
      return 'drums';
    }
    if (s.screen !== 'studio') {
      return 'lead';
    }
    if (s.rec) {
      return s.rec.inst;
    }
    const tr = s.transport;
    if (tr === 'ready' || tr === 'finding' || !this.perf.layers.length) {
      return 'drums';
    }
    return s.inst || 'drums';
  }

  drumHit() {
    const s = this.sim;
    const h = s.hand;
    const slot = this.slotAt(h.y);
    const drum = R.DRUM_OF_SLOT[slot];
    const vel = this.liveVel();
    const rm = s.reduced ? 0.4 : 1;
    s.ripples.push({
      x: h.x,
      y: h.y,
      r: 0,
      v: s.reduced ? 3 : 4.6,
      w: 44,
      s: (drum === 'kick' ? 1.9 : drum === 'snare' ? 1.25 : 0.7) * rm,
      life: 1,
      decay: 0.022,
      hot: drum === 'kick' ? 1 : 0,
    });
    if (s.ripples.length > 16) {
      s.ripples.shift();
    }
    s.floats.push({ x: h.x, y: h.y - 30, text: R.DRUM_NAME[drum], life: 0.9 });
    if (s.floats.length > 12) {
      s.floats.shift();
    }
    s.noteFlash = 1;
    s.boost = Math.min(0.5, s.boost + (drum === 'kick' ? 0.16 : 0.08));
    if (this.audible()) {
      this.drumSound(drum, vel);
    }
    const finding = s.transport === 'finding';
    this.sendHaptics(
      finding
        ? [{ channel: 'rhythm', intensity: 0.85, duration: 80, type: 'drum' }]
        : R.compile({ layer: 'drum', drum, velocity: vel }),
      finding ? 'Pulse · hit' : R.describe({ layer: 'drum', drum }),
    );
    if (finding) {
      this.pulseHit();
    }
    this.recEvent(
      { layer: 'drum', drum, slot, vel, dur: 0.08, art: 'staccato', accent: vel >= 0.85 },
      this.transport.nowStep(),
    );
  }

  onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (this.state.screen === 'tempo') {
      const kk = e.key.toLowerCase();
      if ((kk === 'j' || kk === 'enter') && !e.repeat && tag !== 'BUTTON') {
        this.sim.hand.ghostPinch = false;
        this.pinchStart();
      }
      return;
    }
    if (this.state.screen !== 'studio') {
      return;
    }
    const onBtn = tag === 'BUTTON' || tag === 'INPUT';
    const k = e.key.toLowerCase();
    const s = this.sim;
    const h = s.hand;
    if (k === 'escape') {
      if (this.state.focus) {
        this.closeFocus();
      } else {
        this.setState({
          showKeys: false,
          showA11y: false,
          showChar: false,
          showBand: false,
          pick: false,
        });
      }
      return;
    }
    if (this.state.focus) {
      if (k === ' ' && !onBtn && this.state.focus === 'feel') {
        e.preventDefault();
        this.feelPlay();
      } else if (k === 'f') {
        this.cycleFeel();
      }
      return;
    }
    if (k.startsWith('arrow')) {
      e.preventDefault();
      const stp = 44;
      if (k === 'arrowup') {
        h.ty = Math.max(0, h.ty - stp);
      }
      if (k === 'arrowdown') {
        h.ty = Math.min(s.H, h.ty + stp);
      }
      if (k === 'arrowleft') {
        h.tx = Math.max(0, h.tx - stp);
      }
      if (k === 'arrowright') {
        h.tx = Math.min(s.W, h.tx + stp);
      }
      h.lastMove = s.t;
      s.mouseT = s.t;
      return;
    }
    if (e.repeat) {
      return;
    }
    if (k === ' ' && !onBtn) {
      e.preventDefault();
      this.togglePlay();
    } else if (k === 'r') {
      this.primary();
    } else if (k === 's') {
      this.stop();
    } else if (k === 'c') {
      this.toggleClick();
    } else if (this.state.pick && k >= '1' && k <= '4') {
      const a = this.available()[+k - 1];
      if (a) {
        this.armRecord(a);
      }
    } else if (k === 'x') {
      this.reset();
    } else if (k === 'm') {
      this.toggleMute();
    } else if (k === 'f') {
      this.cycleFeel();
    } else if (k === 'q') {
      const i = this.QUANTS.findIndex((q) => q[0] === this.state.quant);
      this.setState({ quant: this.QUANTS[(i + 1) % 3][0] });
    } else if (e.key === '?') {
      this.setState((st) => ({ showKeys: !st.showKeys }));
    } else if (k === 'j' || (k === 'enter' && !onBtn)) {
      h.ghostPinch = false;
      this.pinchStart();
    } else if (k === 'a') {
      this.flick(h.x, h.y);
    }
  };

  onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    // Also ends tempo-screen hits.
    if ((k === 'j' || k === 'enter') && this.sim.hand.pinch) {
      this.pinchEnd();
    }
  };

  cycleFeel() {
    const i = this.FEELS.findIndex((f) => f[0] === this.state.feel);
    this.setFeel(this.FEELS[(i + 1) % 4][0]);
  }

  setFeel(k: Feel) {
    clearTimeout(this.fmT);
    this.setState({ feel: k, feelMsg: this.FEEL_MSG[k], feelMsgOn: true });
    this.fmT = window.setTimeout(() => this.setState({ feelMsgOn: false }), 2600);
  }

  audible() {
    const s = this.sim;
    return s.audioOn && !s.muted && !s.silent && (s.screen === 'studio' || s.screen === 'tempo');
  }

  available() {
    return availableInstruments(this.perf.layers);
  }

  toggleClick = () => this.setState((x) => ({ clickOn: !x.clickOn }));
  toggleMute = () => {
    if (!this.state.audioOn) {
      return;
    }
    this.setState((st) => ({ muted: !st.muted }));
  };

  // ---- tempo: −/+ sets the tempo; Find my pulse taps it in; Start carries it into the studio.
  findPulse = () => {
    const s = this.sim;
    this.ensureAudio();
    s.prevBpm = this.state.bpm;
    this.stopMaster();
    s.pulseHits = [];
    s.beatInBar = -1;
    this.setTransport('finding', {
      bpm: null,
      pick: false,
      pulse: { n: 0, msg: '' },
      prevBpm: s.prevBpm,
    });
  };

  cancelPulse() {
    const s = this.sim;
    const pb = s.prevBpm;
    s.pulseHits = [];
    if (pb) {
      this.startMaster(pb);
      this.setTransport('found', { bpm: pb, pulse: { n: 0, msg: '' } });
    } else {
      this.setTransport('ready', { pulse: { n: 0, msg: '' } });
    }
  }

  tempoAdj(d: number) {
    const s = this.sim;
    const bpm = Math.max(60, Math.min(180, (this.state.bpm || s.prevBpm || 100) + d));
    this.ensureAudio();
    s.pulseHits = [];
    s.viaPulse = false;
    this.startMaster(bpm);
    this.setTransport('found', { bpm, pulse: { n: 0, msg: '' }, viaPulse: false });
  }

  tempoStart = () => {
    const s = this.sim;
    const bpm = this.state.bpm || s.prevBpm || 100;
    this.ensureAudio();
    s.pulseHits = [];
    if (!this.transport.running || s.transport === 'finding') {
      this.startMaster(bpm);
    }
    this.setTransport('found', { bpm, screen: 'studio', pulse: { n: 0, msg: '' } });
  };

  pulseHit() {
    const s = this.sim;
    const now = performance.now() / 1000;
    let hs = s.pulseHits;
    const last = hs[hs.length - 1];
    if (last != null && now - last > 2.5) {
      hs = s.pulseHits = [];
    } else if (last != null && now - last < 0.18) {
      return;
    }
    hs.push(now);
    const r = R.estimateBpm(hs);
    if (r.ok) {
      return this.pulseFound(r.bpm as number);
    }
    if (hs.length >= 8) {
      s.pulseHits = [];
      return this.setState({ pulse: { n: 0, msg: 'uneven' } });
    }
    this.setState({ pulse: { n: hs.length, msg: '' } });
  }

  // The last steady hit becomes beat 1 of the master loop,
  // so the metronome carries on from the performer's own pulse.
  pulseFound(bpm: number) {
    const s = this.sim;
    s.pulseHits = [];
    s.viaPulse = true;
    // The transport restarts now, so the hit that completed the pulse is beat 1.
    this.startMaster(bpm);
    s.ripples.push({
      x: s.W * 0.5,
      y: s.H * 0.55,
      r: 0,
      v: 6,
      w: 130,
      s: 1.1 * (s.reduced ? 0.4 : 1),
      life: 1,
      decay: 0.007,
    });
    s.boost = Math.min(0.6, s.boost + 0.25);
    this.setTransport('found', {
      bpm,
      pulse: { n: 0, msg: '' },
      scoreVer: ++this.ver,
      viaPulse: true,
    });
  }

  // Flick = musical hit: big wave, both motors, accent sound.
  // Recorded into the loop like any other event.
  flick(x: number, y: number, fromCursor = false) {
    const s = this.sim;
    if (s.focus) {
      return;
    }
    const before = s.recRaw.length;
    const rm = s.reduced ? 0.4 : 1;
    s.ripples.push({
      x,
      y,
      r: 0,
      v: s.reduced ? 4 : 6.5,
      w: 100,
      s: 0.95 * rm,
      life: 1,
      decay: 0.012,
      hot: 1,
    });
    if (s.ripples.length > 16) {
      s.ripples.shift();
    }
    s.boost = Math.min(0.5, s.boost + 0.25);
    s.haptic = Math.max(s.haptic, 0.9);
    s.flickT = s.t;
    if (s.screen === 'studio') {
      this.sendHaptics(R.compile({ layer: 'hit' }), 'Both motors · flick');
    }
    if (this.audible()) {
      this.hitSound();
    }
    if (s.transport === 'finding') {
      this.pulseHit();
    }
    this.recEvent(
      { layer: 'hit', dur: 0.1, slot: -1, vel: 1, art: 'staccato', accent: true, gesture: 'flick' },
      this.transport.nowStep(),
    );
    this.cursorFlick = fromCursor
      ? {
          wall: performance.now(),
          ev: s.recRaw.length > before ? s.recRaw[s.recRaw.length - 1] : null,
        }
      : null;
  }

  /**
   * A click right after a cursor flick is one gesture (moving into a zone, then hitting), not two
   * hits. The click is the intended hit, so the flick's recorded event is withdrawn.
   */
  private absorbCursorFlick() {
    const f = this.cursorFlick;
    this.cursorFlick = null;
    if (!f || !f.ev || performance.now() - f.wall > FLICK_CLICK_MERGE_MS) {
      return;
    }
    const s = this.sim;
    const owners = [s.recRaw, ...this.perf.layers.map((l) => l.raw)];
    for (const raw of owners) {
      const i = raw.indexOf(f.ev);
      if (i >= 0) {
        raw.splice(i, 1);
        this.rebuildScore();
        return;
      }
    }
  }

  // ---- frame
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000) || 0.016;
    this.last = now;
    this.step(dt);
  };

  private step(dt: number) {
    const s = this.sim;
    const h = s.hand;
    if (!this.field.ctx || !s.n) {
      return;
    }
    s.t += dt;
    const t = s.t;
    const W = s.W;
    const H = s.H;
    const dtk = Math.min(dt * 60, 3);

    this.detect();

    // Ghost hand: outside the studio, demonstrate the current screen's gesture when idle.
    if (s.screen !== 'studio' && t - s.mouseT > 2.2) {
      if (s.screen === 'welcome' || s.screen === 'tempo') {
        h.tx = W * (0.5 + 0.3 * Math.sin(t * 0.21));
        h.ty = H * (0.42 + 0.2 * Math.sin(t * 0.29 + 1));
      } else if (s.step === 0) {
        h.tx = W * 0.5 + Math.sin(t * 0.35) * W * 0.12;
        h.ty = H * (0.46 - 0.3 * Math.sin(t * 0.55));
      } else if (s.step === 1) {
        h.tx = W * 0.5 + Math.cos(t * 0.7) * W * 0.14;
        h.ty = H * 0.38 + Math.sin(t * 0.7) * H * 0.1;
        const want = t % 1.9 < 0.35;
        if (want && !h.pinch) {
          h.ghostPinch = true;
          this.pinchStart();
        } else if (!want && h.pinch && h.ghostPinch) {
          h.ghostPinch = false;
          this.pinchEnd();
        }
      } else if (s.step === 2) {
        const fast = Math.sin(t * 0.6) > 0;
        const sp = fast ? 1.4 : 0.6;
        const rr = fast ? 0.14 : 0.07;
        h.tx = W * 0.5 + Math.cos(t * sp) * W * rr;
        h.ty = H * 0.4 + Math.sin(t * sp) * H * rr;
      } else {
        const ph = t % 3.6;
        h.tx = W * (0.5 + 0.2 * Math.sin(t * 0.4));
        h.ty = ph < 3 ? H * (0.3 + 0.06 * Math.sin(t * 0.9)) : H * 0.72;
        if (ph >= 3 && !s.ghostFlicked) {
          s.ghostFlicked = true;
          this.flick(W * 0.5, H * 0.5);
        }
        if (ph < 3) {
          s.ghostFlicked = false;
        }
      }
      h.lastMove = t;
    }

    // Hand smoothing, velocity and presence.
    s.handScale = s.screen === 'welcome' ? 0.55 : 1;
    const k = 1 - Math.pow(0.8, dtk);
    h.x += (h.tx - h.x) * k;
    h.y += (h.ty - h.y) * k;
    h.vx = (h.x - h.px) / dtk;
    h.vy = (h.y - h.py) / dtk;
    h.px = h.x;
    h.py = h.y;
    h.speed += (Math.hypot(h.vx, h.vy) - h.speed) * 0.15;
    const want = t - h.lastMove < 1.2 || h.pinch ? 1 : 0;
    h.amt += (want - h.amt) * Math.min(1, (want ? 0.08 : 0.012) * dtk);

    // Live held note: slur to a new slot, start the hold pulse, emit hold ripples.
    if (h.pinch && s.live) {
      const slot = this.slotAt(h.y);
      if (slot !== s.heldNote) {
        this.noteOff(true);
        this.noteOn(slot, true);
      }
    }
    if (s.live && !s.live.holdSent && t - s.live.start > 0.25) {
      s.live.holdSent = true;
      if (s.screen === 'studio') {
        this.sendHaptics([R.holdCmd(s.live.vel)], 'Expression · held note');
      }
    }
    if (s.live && s.live.holdSent && !s.reduced && t - (s.holdRipT || 0) > 0.4) {
      s.holdRipT = t;
      s.ripples.push({ x: h.x, y: h.y, r: 0, v: 2.2, w: 36, s: 0.5, life: 1, decay: 0.02 });
      if (s.ripples.length > 16) {
        s.ripples.shift();
      }
    }

    // Movement energy.
    const eRaw = h.amt > 0.2 ? Math.min(1, h.speed / 22) : 0;
    s.energy += (eRaw - s.energy) * Math.min(1, (eRaw > s.energy ? 0.08 : 0.02) * dtk);

    // Recording boundaries and loop playback are driven by the master transport (onStep / dispatch).

    // Pending (haptics UI): wristband canvases, tactile module edges.
    this.drawTactile();
    this.field.render(dtk, this.host.props.trails);
  }

  pushUI = () => {
    const s = this.sim;
    const h = s.hand;
    const slot = this.slotAt(h.y);
    const p = this.tone0();
    const inst = this.liveInst();
    const drums = inst === 'drums';
    const midi = R.midiFor(inst, slot, p);
    const tr = s.transport;
    const c = s.clock;
    const now = this.transport.nowStep();
    let timer = 0;
    let total = 0;
    let count = 0;
    let recBar = 0;
    const ph = this.clockPhase();
    if (c) {
      total = c.len;
      timer = Math.max(0, ph) * c.len;
    }

    // Count-in (4 → 1) and recording bar, read from the transport position.
    const rc = s.rec;
    if (rc && now >= 0) {
      if (tr === 'countin') {
        const beats = (now - rc.ciStep) / 4;
        count = beats < 0 ? 0 : Math.max(1, 4 - Math.floor(beats));
      } else {
        recBar = Math.max(1, Math.min(4, Math.floor((now - rc.startStep) / BAR_STEPS) + 1));
      }
    }

    const act: Record<string, boolean> = {};
    this.perf.layers.forEach((l) => {
      act[l.id] = s.t - (s.layerFire[l.id] || -9) < 0.16;
    });
    const handIn = !!(s.handSeen && s.t - s.handSeen < 0.5);
    this.audio.setEnergy(s.energy, s.spread);
    if (handIn !== this.state.handIn) {
      this.setState({ handIn });
    }
    this.host.ui.set({
      inst,
      count,
      recBar,
      act,
      energy: s.energy,
      slot,
      name: drums ? R.DRUM_NAME[R.DRUM_OF_SLOT[slot]] : R.noteName(midi),
      deg: drums ? ['low', 'low', 'mid', 'mid', 'high', 'high'][slot] : p.degrees[slot],
      zone: R.ZONE_OF_SLOT[slot],
      nx: Math.max(0, Math.min(1, h.x / s.W)),
      ny: Math.max(0, Math.min(1, h.y / s.H)),
      pinch: h.pinch,
      hap: s.haptic,
      beat: c ? s.beatInBar : -1,
      timer: this.fmt(timer),
      total: total ? ' / ' + this.fmt(total) : '',
      phase: Math.max(0, ph),
      bar: ph >= 0 ? Math.min(4, Math.floor(ph * 4) + 1) : 0,
      flash: s.noteFlash,
      active: h.amt > 0.2,
      cue: s.t - s.cueT < 1.4 ? s.lastCue : '',
      loopReady: tr === 'playing' && now >= 0 && now < s.loopReadyUntil,
    });
  };

  clockPhase() {
    return this.sim.clock ? this.transport.phase() : -1;
  }

  // ---- audio

  /** Called from user gestures only (autoplay policy). */
  ensureAudio() {
    const s = this.sim;
    s.audioOn = true;
    if (!this.state.audioOn) {
      this.setState({ audioOn: true });
    }
    this.audio.start();
    this.applyGain();
  }

  /** Feel only fades the whole mix out slowly; mute is immediate (v7 applyGain). */
  applyGain(muted = this.state.muted) {
    const silent = this.sim.silent;
    this.audio.setOutput(muted || silent, silent ? 0.9 : 0.15);
  }

  /** Playback mode changes outputs only; the master clock keeps running (v7 setPlayMode). */
  setPlayMode(k: AppState['playMode']) {
    const s = this.sim;
    s.silent = k === 'feel';
    s.noHaptic = k === 'hear';
    if (k !== 'feel') {
      this.ensureAudio();
    }
    this.applyGain();
    this.setState({ playMode: k });
    if (s.transport === 'paused' && this.perf.layers.length) {
      this.togglePlay();
    }
  }

  // ---- wristband hardware

  connectBand() {
    void this.hap.hw.connect();
  }

  disconnectBand() {
    this.hap.hw.disconnect();
  }

  /** Hardware test bypasses Feel modes on purpose: it checks the circuit, not the music. */
  hwTestFire(chs: Channel[]) {
    const v = { low: 90, med: 170, high: 255 }[this.state.hwLevel] ?? 170;
    const ms = 150;
    this.hap.send(
      chs.map((channel) => ({ channel, intensity: v / 255, duration: ms, type: 'test' })),
    );
    this.setState({
      hwLast:
        'Sent ' +
        chs.map((c) => (c === 'rhythm' ? 'R' : 'E') + ',' + v + ',' + ms).join('  ') +
        (this.state.bandHw === 'connected' ? '' : '  (simulated only)'),
    });
  }

  noteStart(midi: number, vel: number, inst: string) {
    this.audio.noteStart(midi, vel, inst, this.liveMeta('live'));
  }

  noteEnd(midi: number, inst: string) {
    this.audio.noteEnd(midi, inst);
  }

  drumSound(d: R.DrumKey, vel: number) {
    this.audio.drum(d, vel, undefined, this.liveMeta('live'));
  }

  hitSound() {
    this.audio.hit(undefined, this.liveMeta('flick-live'));
  }

  /** Dev diagnostics: where a live trigger sits on the master loop. */
  private liveMeta(source: 'live' | 'flick-live'): TriggerMeta | undefined {
    if (!import.meta.env.DEV) {
      return undefined;
    }
    const tp = this.transport;
    const now = tp.nowStep();
    return {
      source,
      step: now,
      loopTime: now >= 0 ? tp.loopSeconds(now) : -1,
      transport: this.sim.transport,
      iteration: now >= 0 ? Math.floor((now - tp.origin) / LOOP_STEPS) : -1,
    };
  }

  /** Dev diagnostics: which loop event produced a scheduled trigger. */
  private eventMeta(ev: MusicEvent): TriggerMeta | undefined {
    if (!import.meta.env.DEV) {
      return undefined;
    }
    return {
      source: ev.metro ? 'metronome' : ev.layer === 'hit' ? 'flick-playback' : 'playback',
      id: ev.id,
      step: this.lastAbs,
      loopTime: ev.t,
      transport: this.sim.transport,
      iteration: Math.floor((this.lastAbs - this.transport.origin) / LOOP_STEPS),
    };
  }

  /** The audible click plays while setting tempo, counting in and recording — never in playback. */
  clickAudible() {
    const tr = this.sim.transport;
    return this.state.clickOn && (tr === 'countin' || tr === 'recording' || tr === 'found');
  }

  // ---- master transport

  /** (Re)starts the master clock from beat 1 at `bpm`. Loop bar 1 begins at absolute step `origin`. */
  startMaster(bpm: number, origin = 0) {
    this.transport.start(bpm, origin);
    this.rebuildScore(bpm);
    this.sim.clock = { kind: 'master', len: this.transport.len, bpm };
  }

  stopMaster() {
    this.transport.stop();
    this.sim.clock = null;
    this.sim.beatInBar = -1;
  }

  /** Metronome + every layer, quantized, as one 4-bar score on the master loop. */
  rebuildScore(bpm = this.transport.bpm) {
    this.transport.setScore(R.buildLayered({ bpm, layers: this.perf.layers, q: this.state.quant }));
    this.publishScore();
  }

  /**
   * Republishes the tactile score's marks to React: every layer, plus the take being recorded
   * (shown dimmed). Only called when the score changes, never per frame.
   */
  publishScore() {
    const s = this.sim;
    const layers = this.perf.layers.slice();
    const take = s.rec && !s.rec.closing ? s.rec : null;
    if (take && s.recRaw.length) {
      layers.push({ id: 'rec', inst: take.inst, raw: s.recRaw, muted: false, rec: true });
    }
    const view = R.buildLayered({ bpm: this.transport.bpm, layers, q: this.state.quant });
    this.setState({
      score: {
        len: view.len,
        marks: view.events.map((e) => ({
          id: e.id,
          t: e.t,
          layer: e.layer,
          inst: e.inst,
          drum: e.drum,
          metro: e.metro,
          step: e.step,
          dur: e.duration ?? 0,
          vel: e.velocity ?? 0.6,
          legato: e.articulation === 'legato',
          accent: e.accent,
          muted: e.muted,
          rec: e.rec,
          felt: e.haptic.length > 0,
        })),
        legend: this.perf.layers
          .map((l) => ({ inst: l.inst, muted: l.muted, rec: false }))
          .concat(take ? [{ inst: take.inst, muted: false, rec: true }] : []),
      },
    });
  }

  /** Light a fired event's marks on the score until its felt duration ends (v7 scoreGeom "on"). */
  private flashScore(ev: MusicEvent) {
    const root = this.host.tactile.score.current;
    if (!root) {
      return;
    }
    const mel = ev.layer === 'melody' || ev.layer === 'note';
    const held = mel && ev.articulation === 'legato' ? Math.min(ev.duration ?? 0, 1.5) : 0.16;
    const until = this.sim.t + Math.max(0.16, held);
    root.querySelectorAll<HTMLElement>(`[data-ev="${CSS.escape(ev.id)}"]`).forEach((el) => {
      el.dataset.on = '1';
      this.lit.set(el, until);
    });
  }

  /** Per frame: wristband canvas, tactile module edges, score playhead and mark expiry (v7). */
  private drawTactile() {
    const s = this.sim;
    const refs = this.host.tactile;
    const st = this.state;
    const levels = this.hap.sim.levels(performance.now());
    const off = st.feel === 'off';
    const allowed = {
      rhythm: this.chanAllowed('rhythm'),
      expression: this.chanAllowed('expression'),
    };
    drawWrist(refs.wrist.current, {
      levels,
      allowed,
      off,
      reduced: s.reduced,
      big: false,
      hidden: false,
    });

    // Module edges answer their own motor; the whole border lifts only when both fire together.
    const p = off || !allowed.rhythm ? 0 : levels.rhythm;
    const e = off || !allowed.expression ? 0 : levels.expression;
    if (refs.edgeL.current) {
      refs.edgeL.current.style.opacity = (p * 0.8).toFixed(3);
    }
    if (refs.edgeR.current) {
      refs.edgeR.current.style.opacity = (e * 0.8).toFixed(3);
    }
    const box = refs.box.current;
    if (box) {
      const both = Math.min(p, e);
      box.style.borderColor =
        st.bandHw === 'connected'
          ? 'rgba(127,224,236,' + (0.16 + both * 0.22).toFixed(3) + ')'
          : 'rgba(236,230,216,' + (0.1 + both * 0.18).toFixed(3) + ')';
    }

    const ph = this.clockPhase();
    const head = refs.playhead.current;
    if (head) {
      head.style.left = (Math.max(0, ph) * 100).toFixed(2) + '%';
      head.style.opacity = ph >= 0 && s.screen === 'studio' ? '0.9' : '0';
    }

    for (const [el, until] of this.lit) {
      if (s.t >= until || !el.isConnected) {
        delete el.dataset.on;
        this.lit.delete(el);
      }
    }
  }

  /** Runs once per sixteenth on the transport, before that step's events. */
  private onStep = (abs: number, time: number) => {
    this.lastAbs = abs;
    const s = this.sim;
    const rc = s.rec;
    if (!rc) {
      return;
    }
    if (s.transport === 'countin' && abs >= rc.startStep) {
      s.transport = 'recording';
      this.transport.draw(() => {
        if (s.rec === rc) {
          this.setState({ transport: 'recording' });
        }
      }, time);
    }
    if (!rc.closing && abs >= rc.endStep) {
      this.commitRecording(time);
    }
  };

  /** Runs for every loop event at its exact transport time. */
  private dispatch = (ev: MusicEvent, time: number) => {
    const s = this.sim;
    if (ev.muted || ev.rec) {
      return;
    }
    if (import.meta.env.DEV) {
      this.dispatchLog.push({
        id: ev.id,
        layer: ev.layer,
        lid: ev.lid,
        t: ev.t,
        time,
        abs: this.lastAbs,
        origin: this.transport.origin,
        s16: this.transport.s16,
        run: this.transport.run,
      });
      if (this.dispatchLog.length > 20000) {
        this.dispatchLog.splice(0, 5000);
      }
    }
    if (this.audible()) {
      this.audioFor(ev, time);
    }
    // Decide haptics now, while the transport state matches this event's time.
    const haptic: [HapticCmd[], string] | null = ev.metro
      ? this.metroHaptic(ev)
      : [ev.haptic || R.compile(ev), R.describe(ev)];
    this.transport.draw(() => {
      if (ev.lid) {
        s.layerFire[ev.lid] = s.t;
      }
      this.visualFor(ev);
      if (haptic) {
        this.sendHaptics(haptic[0], haptic[1]);
      }
      s.fired[ev.id] = s.t;
      this.flashScore(ev);
    }, time);
  };

  private audioFor(ev: MusicEvent, time: number) {
    const meta = this.eventMeta(ev);
    if (ev.metro) {
      if (this.clickAudible()) {
        this.audio.click(ev.accent, time, meta);
      }
      return;
    }
    if (ev.layer === 'hit') {
      this.audio.hit(time, meta);
    } else if (ev.layer === 'drum' && ev.drum) {
      this.audio.drum(ev.drum, ev.velocity ?? 0.7, time, meta);
    } else if (ev.layer === 'note' && ev.inst && ev.midi != null) {
      const dur = ev.articulation === 'staccato' ? 0.14 : Math.max(0.15, ev.duration ?? 0.15);
      this.audio.note(ev.inst, ev.midi, dur, ev.velocity ?? 0.6, time, meta);
    }
  }

  /**
   * Count-in / recording: Pulse is the tactile metronome, beat 1 strongest.
   * Playback: Pulse carries only the composition's own rhythm events. The v7 fallback that
   * invented a beat-1 pulse when no drums were sounding is intentionally not carried over.
   */
  private metroHaptic(ev: MusicEvent): [HapticCmd[], string] | null {
    const tr = this.sim.transport;
    if (tr !== 'countin' && tr !== 'recording') {
      return null;
    }
    return ev.accent
      ? [
          [{ channel: 'rhythm', intensity: 1, duration: 140, type: 'downbeat' }],
          'Pulse · metronome 1',
        ]
      : [
          [{ channel: 'rhythm', intensity: 0.55, duration: 45, type: 'beat' }],
          'Pulse · metronome ' + ev.beat,
        ];
  }

  /** Particles: beat, downbeat, drum hit, bass / keys / lead note, flick hit (v7 visualFor). */
  private visualFor(ev: MusicEvent) {
    const s = this.sim;
    const W = s.W;
    const H = s.H;
    const len = this.transport.len;
    const rm = (s.reduced ? 0.4 : 1) * (s.focus ? 0.55 : 1);

    if (ev.metro) {
      s.beatInBar = ev.beat - 1;
      s.beatT = s.t;
      s.ripples.push({
        x: W * 0.5,
        y: H * 0.6,
        r: 0,
        v: s.reduced ? 4 : 6.5,
        w: 90,
        s: (ev.accent ? 0.7 : 0.2) * rm,
        life: 1,
        decay: 0.0055,
      });
      if (ev.accent) {
        s.boost = Math.min(0.5, s.boost + 0.05);
      }
      if (s.ripples.length > 16) {
        s.ripples.shift();
      }
      return;
    }

    if (ev.layer === 'drum') {
      const x = W * (0.16 + 0.68 * (ev.t / len));
      const y = ev.drum === 'kick' ? H * 0.78 : ev.drum === 'snare' ? H * 0.6 : H * 0.42;
      const v = ev.velocity ?? 0.7;
      s.ripples.push({
        x,
        y,
        r: 0,
        v: s.reduced ? 3 : 4.4,
        w: 44,
        s: (ev.drum === 'kick' ? 1.7 : ev.drum === 'snare' ? 1.1 : 0.55) * (0.6 + 0.4 * v) * rm,
        life: 1,
        decay: 0.022,
        hot: ev.drum === 'kick' ? 1 : 0,
      });
      if (s.ripples.length > 16) {
        s.ripples.shift();
      }
      return;
    }

    if (ev.layer === 'note') {
      const x = W * (0.16 + 0.68 * (ev.t / len));
      const y = this.yForSlot(ev.slot ?? 0);
      const held = ev.articulation === 'legato';
      const v = ev.velocity ?? 0.6;
      if (ev.inst === 'bass') {
        s.ripples.push({
          x,
          y: H * 0.86,
          r: 0,
          v: s.reduced ? 2.4 : 3.2,
          w: 150,
          s: 0.85 * v * rm,
          life: 1,
          decay: 0.006,
          col: '169,155,255',
        });
      } else if (ev.inst === 'keys') {
        s.ripples.push({
          x,
          y,
          r: 0,
          v: s.reduced ? 1.8 : 2.4,
          w: 90,
          s: rm,
          life: 1,
          decay: 0.008,
          col: '236,230,216',
        });
        if (!s.focus) {
          s.floats.push({ x, y: y - 30, text: ev.note || '', life: 0.8 });
          if (s.floats.length > 12) {
            s.floats.shift();
          }
        }
      } else {
        this.melodyVisual(x, y, ev.note || '', true, true, ev.accent);
      }
      if (held && !s.hideWrist) {
        s.holds.push({
          x,
          y: ev.inst === 'bass' ? H * 0.82 : y,
          end: s.t + Math.min(ev.duration ?? 0, 3),
        });
        if (s.holds.length > 4) {
          s.holds.shift();
        }
      }
      if (s.ripples.length > 16) {
        s.ripples.shift();
      }
      return;
    }

    if (ev.layer === 'hit') {
      s.ripples.push({
        x: W * 0.5,
        y: H * 0.5,
        r: 0,
        v: s.reduced ? 4 : 6.5,
        w: 100,
        s: 0.95 * rm,
        life: 1,
        decay: 0.012,
        hot: 1,
      });
      s.boost = Math.min(0.5, s.boost + 0.25);
      if (s.ripples.length > 16) {
        s.ripples.shift();
      }
    }
  }

  // ---- recording

  /**
   * One bar of count-in on the master grid, then exactly four bars.
   * The first layer re-anchors the loop so its bar 1 is loop bar 1.
   */
  armRecord(inst: InstKey) {
    const s = this.sim;
    const bpm = this.state.bpm;
    if (!bpm || s.rec) {
      return;
    }
    this.ensureAudio();
    const first = !this.perf.layers.length;
    let ci: number;
    if (!this.transport.running) {
      // Start the clock on loop bar 4: the count-in bar begins now, loop bar 1 follows.
      this.startMaster(bpm, BAR_STEPS);
      ci = 0;
    } else {
      const now = this.transport.nowStep();
      const o = this.transport.origin;
      const barStart = o + BAR_STEPS * Math.floor((now - o) / BAR_STEPS);
      // Pressed right on a downbeat: count in from this bar, otherwise from the next.
      ci = now - barStart < BAR_STEPS * 0.12 ? barStart : barStart + BAR_STEPS;
      if (first) {
        this.transport.origin = ci + BAR_STEPS;
      }
    }
    s.rec = {
      inst,
      ciStep: ci,
      startStep: ci + BAR_STEPS,
      endStep: ci + BAR_STEPS + LOOP_STEPS,
    };
    s.recRaw = [];
    s.inst = inst;
    if (s.hand.pinch) {
      this.pinchEnd();
    }
    this.setTransport('countin', {
      pick: false,
      recInst: inst,
      sheet: 'closed',
      scoreVer: ++this.ver,
    });
    this.publishScore();
  }

  /** Stores a live event relative to the master loop start (seconds into the 4-bar loop). */
  recEvent(r: RecInput, at: number) {
    const s = this.sim;
    const rc = s.rec;
    if (!rc || at < 0) {
      return;
    }
    // The window is exactly one loop long: it opens REC_EARLY before bar 1 (an early downbeat
    // counts as beat 1) and closes REC_EARLY before the end of bar 4, because a hit there is the
    // next loop's downbeat played early — already captured at the start, not a second hit.
    if (at < rc.startStep - REC_EARLY || at >= rc.endStep - REC_EARLY) {
      return;
    }
    const tp = this.transport;
    const a = Math.max(at, rc.startStep);
    const t = tp.loopSeconds(a);
    const dur = Math.max(0.05, Math.min(r.dur ?? 0.08, (rc.endStep - a) * tp.s16, tp.len - t));
    s.recRaw.push({ ...r, t, dur });
    if (rc.closing) {
      this.rebuildScore();
    } else {
      this.publishScore();
    }
  }

  /**
   * Bar 4 is over: the layer joins the loop on this very step, so its first events play at once.
   * The window stays open until the boundary is heard, so late events inside the scheduler
   * lookahead still land in the layer.
   */
  private commitRecording(time: number) {
    const s = this.sim;
    const rc = s.rec;
    if (!rc) {
      return;
    }
    const n = s.live;
    if (n && !n.done) {
      // A note still held at the boundary is captured up to the end of bar 4.
      this.recEvent(
        { layer: 'note', dur: Infinity, slot: n.slot, vel: n.vel, art: 'legato', accent: false },
        n.startStep,
      );
      n.done = true;
    }
    rc.closing = true;
    this.perf.layers.push({ id: 'L' + ++this.lid, inst: rc.inst, raw: s.recRaw, muted: false });
    s.transport = 'playing';
    s.loopReadyUntil = rc.endStep + LOOP_STEPS;
    this.rebuildScore();
    this.transport.draw(() => {
      if (s.rec === rc) {
        s.rec = null;
        s.recRaw = [];
      }
      this.setState({
        transport: 'playing',
        recInst: null,
        layers: this.layerSummary(),
        layersVer: ++this.ver,
        scoreVer: ++this.ver,
      });
    }, time);
  }

  cancelRecording() {
    const s = this.sim;
    const rc = s.rec;
    if (!rc || rc.closing) {
      return;
    }
    if (s.live) {
      s.live.done = true;
    }
    s.rec = null;
    s.recRaw = [];
    this.setTransport(this.perf.layers.length ? 'playing' : 'found', {
      recInst: null,
      scoreVer: ++this.ver,
    });
    this.publishScore();
  }

  // ---- transport controls

  /** Record button / R key: find pulse → record drums → add a layer. */
  primary = () => {
    const s = this.sim;
    const tr = s.transport;
    const n = this.perf.layers.length;
    if (tr === 'ready') {
      return this.findPulse();
    }
    if (tr === 'finding') {
      return this.cancelPulse();
    }
    if (tr === 'countin' || tr === 'recording') {
      return this.cancelRecording();
    }
    if (!n) {
      return this.armRecord('drums');
    }
    if (this.available().length) {
      this.setState((x) => ({ pick: !x.pick, sheet: 'closed' }));
    }
  };

  /** Pause stops the transport; Play restarts the loop from bar 1 (as in v7). */
  togglePlay = () => {
    const s = this.sim;
    const tr = s.transport;
    const bpm = this.state.bpm;
    if (!bpm || tr === 'countin' || tr === 'recording' || tr === 'finding') {
      return;
    }
    this.ensureAudio();
    if (tr === 'paused') {
      this.startMaster(bpm);
      this.setTransport(this.perf.layers.length ? 'playing' : 'found');
    } else {
      this.stopMaster();
      this.hap.send([R.releaseCmd('expression')]);
      this.audio.releaseAll();
      this.setTransport('paused');
    }
  };

  stop = () => {
    const tr = this.sim.transport;
    if (tr === 'playing' || tr === 'found') {
      this.togglePlay();
    }
  };

  reset = () => {
    const s = this.sim;
    this.stopMaster();
    this.audio.releaseAll();
    this.hap.send([R.releaseCmd('expression')]);
    s.rec = null;
    s.recRaw = [];
    s.pulseHits = [];
    s.silent = false;
    s.noHaptic = false;
    this.applyGain();
    this.perf.layers = [];
    this.rebuildScore();
    s.boost = 0;
    this.setTransport('ready', {
      screen: 'tempo',
      pick: false,
      recInst: null,
      playMode: 'both',
      pulse: { n: 0, msg: '' },
      layers: [],
      layersVer: ++this.ver,
      scoreVer: ++this.ver,
    });
  };

  muteLayer(id: string) {
    const l = this.perf.layers.find((x) => x.id === id);
    if (!l) {
      return;
    }
    l.muted = !l.muted;
    this.rebuildScore();
    this.setState({ layers: this.layerSummary(), layersVer: ++this.ver });
  }

  deleteLayer(id: string) {
    const s = this.sim;
    this.perf.layers = this.perf.layers.filter((l) => l.id !== id);
    this.rebuildScore();
    if (!this.perf.layers.length && s.transport === 'playing') {
      s.transport = 'found';
    }
    this.setState({
      layers: this.layerSummary(),
      layersVer: ++this.ver,
      scoreVer: ++this.ver,
      transport: s.transport,
      pick: false,
    });
  }

  private layerSummary() {
    return this.perf.layers.map((l) => ({ id: l.id, inst: l.inst, muted: l.muted }));
  }

  // ---- Pending subsystems
  // Each stub keeps the prototype's call sites intact until its milestone lands.

  /** Pending (focus modes: Feel this loop, Tactile memory). */
  closeFocus = () => {};
  feelPlay = () => {};
  /** Pending (camera + MediaPipe hand tracking). */
  detect() {}
}

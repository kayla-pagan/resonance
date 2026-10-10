/* Resonance engine (two-channel hackathon build).
   One MusicEvent feeds audio, particles, the score and the wristband.
   Motor 1 = RHYTHM, shown as PULSE (beat, downbeat).
   Motor 2 = EXPRESSION (notes, held notes, accents).
   Flick = both.

   Ported from resonance-engine-v7.js. Logic is unchanged;
   the IIFE + window.Resonance global became ES module exports. */

export type Channel = 'rhythm' | 'expression';
export interface HapticCmd {
  channel: Channel;
  intensity: number;
  duration: number;
  type: string;
}
export type InstKey = 'drums' | 'bass' | 'keys' | 'lead';
export type DrumKey = 'kick' | 'snare' | 'hat';
export type Layer = 'rhythm' | 'bass' | 'chord' | 'melody' | 'note' | 'hit' | 'drum';

export interface TonalBase {
  key: string;
  name: string;
  keyName: string;
  mode: 'major' | 'minor';
  root: number;
  scale: number[];
  degrees: string[];
  bpm: number;
  rhythm: Record<string, number>;
  bass: [number, number, string, number][];
  chords: [number, number, number][];
  prog: number[];
  particles: { speed: number; turb: number; hues: number[] };
}

/** Input to makeEvent: a base-pattern step or a recorded note. */
export interface EventInput {
  t: number;
  layer: Layer;
  midi?: number | null;
  slot?: number;
  inst?: string | null;
  drum?: DrumKey | null;
  metro?: boolean;
  muted?: boolean;
  rec?: boolean;
  lid?: string | null;
  degree?: string | null;
  chord?: number[] | null;
  vel?: number;
  dur?: number;
  art?: string;
  accent?: boolean;
  gesture?: string;
}
export type RawNote = EventInput & { dur: number };

export interface MusicEvent {
  id: string;
  t: number;
  layer: Layer;
  midi: number | null;
  note: string | null;
  slot: number | undefined;
  inst: string | null;
  drum: DrumKey | null;
  metro: boolean;
  muted: boolean;
  rec: boolean;
  lid: string | null;
  degree: string | null;
  chord: number[] | null;
  velocity: number | undefined;
  duration: number | undefined;
  articulation: string | undefined;
  accent: boolean;
  gesture: string;
  bar: number;
  beat: number;
  step: number;
  haptic: HapticCmd[];
}
/** compile()/describe() are also called with partial live events. */
export type EventLike = Partial<MusicEvent> & { layer: Layer };

export interface LoopDef {
  preset: string;
  bpm: number;
  len: number;
  bars?: number;
  base?: EventInput[];
  raw?: RawNote[];
  name?: string;
  desc?: string;
  custom?: boolean;
}
export interface Score {
  events: MusicEvent[];
  len: number;
  bpm: number;
  bars: number;
  preset: string;
}
export interface PerfLayer {
  id: string;
  inst: InstKey;
  raw: RawNote[];
  muted: boolean;
  rec?: boolean;
}
export type Quant = 'off' | 'loose' | 'balanced';

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = (m: number) => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const ZONE_OF_SLOT = [0, 1, 1, 2, 2, 3];

// One neutral tonal base. The tempo and the performer's own layers drive everything else.
export const TONE: TonalBase = {
  key: 'base',
  name: '',
  keyName: 'C',
  mode: 'major',
  root: 60,
  scale: [0, 2, 4, 7, 9, 12],
  degrees: ['1', '2', '3', '5', '6', '8'],
  bpm: 90,
  rhythm: { 0: 0.9, 4: 0.6, 8: 0.75, 12: 0.6 },
  bass: [],
  chords: [],
  prog: [0],
  particles: { speed: 1, turb: 1, hues: [0.35, 0.4, 0.15, 0.1] },
};
export const PRESETS: Record<string, TonalBase> = { base: TONE };
export const ORDER: string[] = [];
export const INSTR: Record<InstKey, { name: string; desc: string }> = {
  drums: { name: 'Drums', desc: 'Height picks kick, snare or hat. Flick for a crash.' },
  bass: { name: 'Bass', desc: 'Low synth. Hand height sets the note; hold to sustain.' },
  keys: { name: 'Keys', desc: 'Warm two-note chords. Pinch to play, hold to ring.' },
  lead: { name: 'Lead', desc: 'Bright voice on top. Move more for stronger notes.' },
};
export const INSTR_ORDER: InstKey[] = ['drums', 'bass', 'keys', 'lead'];
export const DRUM_OF_SLOT: DrumKey[] = ['kick', 'kick', 'snare', 'snare', 'hat', 'hat'];
export const DRUM_NAME: Record<DrumKey, string> = { kick: 'Kick', snare: 'Snare', hat: 'Hat' };
export function midiFor(inst: string, slot: number, p: TonalBase) {
  const d = p.scale[slot];
  if (inst === 'bass') {
    let m = p.root - 24 + d;
    while (m < 33) {
      m += 12;
    }
    return m;
  }
  if (inst === 'keys') {
    return p.root - 12 + d;
  }
  return p.root + d;
}
const LAYER_ORDER: Record<string, number> = { rhythm: 0, bass: 1, chord: 2, melody: 3, hit: 4 };

function bassMidi(p: TonalBase, off: number) {
  let m = p.root - 24 + off;
  while (m < 36) {
    m += 12;
  }
  return m;
}
// Backing triads follow the bar progression; quality comes from the scale degree of the chord root.
const QMAJ: Record<number, number> = { 0: 4, 2: 3, 4: 3, 5: 4, 7: 4, 9: 3 };
const QMIN: Record<number, number> = { 0: 3, 3: 4, 5: 3, 7: 3, 8: 4, 10: 4 };
function chordMidis(p: TonalBase, off: number) {
  let r = p.root - 12 + off;
  while (r < 52) {
    r += 12;
  }
  while (r > 63) {
    r -= 12;
  }
  const pc = ((off % 12) + 12) % 12;
  const third = (p.mode === 'minor' ? QMIN : QMAJ)[pc] || (p.mode === 'minor' ? 3 : 4);
  const v = [r, r + third, r + 7];
  return v;
}

function makeEvent(o: EventInput, bpm: number): MusicEvent {
  const b = o.t / (60 / bpm);
  const step = Math.round(b * 4);
  const mel = o.layer === 'melody' || o.layer === 'note';
  const ev: MusicEvent = {
    id:
      (o.lid || '') +
      o.layer[0] +
      Math.round(o.t * 1000) +
      (mel ? 's' + o.slot : '') +
      (o.drum ? o.drum[0] : ''),
    t: o.t,
    layer: o.layer,
    midi: o.midi != null ? o.midi : null,
    note: o.midi != null ? noteName(o.midi) : null,
    slot: mel || o.layer === 'drum' ? o.slot : -1,
    inst: o.inst || null,
    drum: o.drum || null,
    metro: !!o.metro,
    muted: !!o.muted,
    rec: !!o.rec,
    lid: o.lid || null,
    degree: o.degree || null,
    chord: o.chord || null,
    velocity: o.vel,
    duration: o.dur,
    articulation: o.art,
    accent: !!o.accent,
    gesture:
      o.gesture ||
      (mel ? (o.art === 'legato' ? 'hold' : 'pinch') : o.layer === 'hit' ? 'flick' : 'beat'),
    bar: Math.floor(b / 4) + 1,
    beat: Math.floor(b % 4) + 1,
    step: ((step % 16) + 16) % 16,
    haptic: [],
  };
  ev.haptic = compile(ev);
  return ev;
}

export function buildBase(p: TonalBase, bpm: number, bars?: number) {
  bars = bars || 4;
  const s16 = 60 / bpm / 4;
  const out: EventInput[] = [];
  for (let bar = 0; bar < bars; bar++) {
    Object.keys(p.rhythm).forEach((k) => {
      const v = p.rhythm[k];
      out.push({
        t: (bar * 16 + +k) * s16,
        layer: 'rhythm',
        vel: v,
        dur: s16 * 0.5,
        art: 'staccato',
        accent: +k === 0,
      });
    });
    p.bass.forEach(([st, len, art, v]) =>
      out.push({
        t: (bar * 16 + st) * s16,
        layer: 'bass',
        midi: bassMidi(p, p.prog[bar % p.prog.length]),
        vel: v,
        dur: len * s16,
        art,
        accent: false,
      }),
    );
    (p.chords || []).forEach(([st, len, v]) =>
      out.push({
        t: (bar * 16 + st) * s16,
        layer: 'chord',
        chord: chordMidis(p, p.prog[bar % p.prog.length]),
        vel: v,
        dur: len * s16,
        art: 'legato',
        accent: false,
      }),
    );
  }
  return out;
}

// Light quantization to 1/8 notes. Affects recorded playback only; live sound is immediate.
const QUANT: Record<string, { pull: number; dur: boolean }> = {
  off: { pull: 0, dur: false },
  loose: { pull: 0.5, dur: false },
  balanced: { pull: 1, dur: true },
};
export function quantizeNote(
  n: RawNote,
  q: string,
  bpm: number,
  len: number,
  gm?: number,
): RawNote {
  const s16 = 60 / bpm / 4;
  const g = s16 * (gm || 2);
  const Q = QUANT[q] || QUANT.balanced;
  let t = n.t + (Math.round(n.t / g) * g - n.t) * Q.pull;
  if (t >= len - 1e-6) {
    t -= len;
  }
  if (t < 0) {
    t = 0;
  }
  let dur = n.dur;
  if (n.art === 'staccato') {
    dur = Math.min(dur, s16);
  } else if (Q.dur) {
    dur = Math.max(s16, Math.round(dur / s16) * s16);
  }
  return Object.assign({}, n, { t, dur: Math.max(0.04, Math.min(dur, len - t)) });
}

export function buildScore(loop: LoopDef, q: string): Score {
  const p = PRESETS[loop.preset] || TONE;
  const bpm = loop.bpm;
  const len = loop.len;
  const rec: EventInput[] = (loop.raw || []).map((n) => {
    const m = quantizeNote(n, q, bpm, len);
    if (n.layer === 'hit') {
      return Object.assign({}, m, { layer: 'hit' as const, accent: true, gesture: 'flick' });
    }
    return Object.assign({ layer: 'melody' as Layer, degree: p.degrees[n.slot as number] }, m);
  });
  const ev = (loop.base || [])
    .concat(rec)
    .map((o) => makeEvent(o, bpm))
    .sort(
      (a, b) =>
        a.t - b.t ||
        LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] ||
        (a.slot as number) - (b.slot as number),
    );
  const seen: Record<string, number> = {};
  ev.forEach((e) => {
    if (seen[e.id]) {
      e.id += '_' + seen[e.id]++;
    } else {
      seen[e.id] = 1;
    }
  });
  return { events: ev, len, bpm, bars: loop.bars || 4, preset: loop.preset };
}

/* ---- Tactile grammar (fixed) ----
   BEAT      rhythm      short       .6  60 ms
   DOWNBEAT  rhythm      stronger    .95 110 ms
   NOTE      expression  short       70 ms, strength from movement
   HELD NOTE expression  long        note length
   ACCENT    expression  strong      1.0 140 ms
   FLICK     both motors together    1.0 90 ms
   Off-beat taps and bass are heard, not felt, so Motor 1 stays a clean pulse. */
export function compile(ev: EventLike): HapticCmd[] {
  if (ev.layer === 'rhythm') {
    if ((ev.step as number) % 4 !== 0) {
      return [];
    }
    return ev.step === 0
      ? [{ channel: 'rhythm', intensity: 0.95, duration: 110, type: 'downbeat' }]
      : [{ channel: 'rhythm', intensity: 0.6, duration: 60, type: 'beat' }];
  }
  if (ev.layer === 'hit') {
    return [
      { channel: 'rhythm', intensity: 1, duration: 90, type: 'hit' },
      { channel: 'expression', intensity: 1, duration: 90, type: 'hit' },
    ];
  }
  if (ev.layer === 'drum') {
    const dv = ev.velocity || 0.7;
    return ev.drum === 'kick'
      ? [{ channel: 'rhythm', intensity: Math.min(1, 0.7 + 0.3 * dv), duration: 100, type: 'drum' }]
      : ev.drum === 'snare'
        ? [{ channel: 'rhythm', intensity: 0.45 + 0.3 * dv, duration: 60, type: 'drum' }]
        : [];
  }
  if (ev.layer === 'note') {
    const nv = ev.velocity || 0.6;
    const bass = ev.inst === 'bass';
    if (ev.articulation === 'legato') {
      return [
        {
          channel: 'expression',
          intensity: ev.accent ? 1 : (bass ? 0.6 : 0.5) + 0.35 * nv,
          duration: Math.round(clamp((ev.duration as number) * 1000, 220, 1400)),
          type: 'held',
        },
      ];
    }
    if (ev.accent) {
      return [{ channel: 'expression', intensity: 1, duration: 140, type: 'accent' }];
    }
    return [
      {
        channel: 'expression',
        intensity: (bass ? 0.55 : 0.45) + 0.4 * nv,
        duration: bass ? 110 : 70,
        type: 'note',
      },
    ];
  }
  if (ev.layer !== 'melody') {
    return [];
  }
  const v = ev.velocity || 0.6;
  if (ev.articulation === 'legato') {
    return [
      {
        channel: 'expression',
        intensity: ev.accent ? 1 : 0.5 + 0.35 * v,
        duration: Math.round(clamp((ev.duration as number) * 1000, 220, 1400)),
        type: 'held',
      },
    ];
  }
  if (ev.accent) {
    return [{ channel: 'expression', intensity: 1, duration: 140, type: 'accent' }];
  }
  return [{ channel: 'expression', intensity: 0.45 + 0.4 * v, duration: 70, type: 'note' }];
}
// Live held pinch: duration 0 = keep vibrating until a release (0 intensity) on the same channel.
export function holdCmd(vel: number): HapticCmd {
  return { channel: 'expression', intensity: 0.5 + 0.35 * vel, duration: 0, type: 'hold' };
}
export function releaseCmd(ch?: Channel): HapticCmd {
  return { channel: ch || 'expression', intensity: 0, duration: 0, type: 'release' };
}
export function describe(ev: EventLike) {
  if (ev.layer === 'rhythm') {
    return ev.step === 0 ? 'Pulse · downbeat' : (ev.step as number) % 4 === 0 ? 'Pulse · beat' : '';
  }
  if (ev.layer === 'hit') {
    return 'Pulse + Expression · flick';
  }
  if (ev.layer === 'drum') {
    return ev.drum === 'hat' ? '' : 'Pulse · ' + ev.drum;
  }
  if (ev.layer === 'note') {
    return (
      'Expression · ' +
      (ev.inst ? ev.inst + ' ' : '') +
      (ev.articulation === 'legato' ? 'held note' : ev.accent ? 'accent' : 'note')
    );
  }
  if (ev.layer !== 'melody') {
    return '';
  }
  return (
    'Expression · ' + (ev.articulation === 'legato' ? 'held note' : ev.accent ? 'accent' : 'note')
  );
}

// ESP32 protocol, one line per command: "R,<0-255>,<ms>\n" or "E,<0-255>,<ms>\n".
// ms 0 = hold until next command on that motor.
export function encode(c: HapticCmd) {
  const ch = c.channel === 'rhythm' ? 'R' : 'E';
  return new TextEncoder().encode(
    ch +
      ',' +
      Math.round(clamp(c.intensity || 0, 0, 1) * 255) +
      ',' +
      Math.min(65535, Math.round(c.duration || 0)) +
      '\n',
  );
}

export type HwState =
  'not-connected' | 'searching' | 'connecting' | 'connected' | 'lost' | 'unavailable';

export class HapticTransport {
  kind: string;
  state: HwState = 'not-connected';
  listeners: ((s: HwState) => void)[] = [];
  constructor(kind: string) {
    this.kind = kind;
  }

  onState(fn: (s: HwState) => void) {
    this.listeners.push(fn);
  }

  setState(s: HwState) {
    this.state = s;
    this.listeners.forEach((f) => f(s));
  }

  send(_c: HapticCmd) {}
}

interface SimPulse extends HapticCmd {
  at: number;
  rel?: number;
}

export class SimulatedHapticTransport extends HapticTransport {
  pulses: SimPulse[] = [];
  constructor() {
    super('simulated');
    this.state = 'connected';
  }

  send(c: HapticCmd) {
    const now = performance.now();
    if (c.type === 'release') {
      this.pulses.forEach((p) => {
        if (p.type === 'hold' && p.channel === c.channel && !p.rel) {
          p.rel = now;
        }
      });
      return;
    }
    this.pulses.push(Object.assign({ at: now }, c));
    if (this.pulses.length > 60) {
      this.pulses.splice(0, this.pulses.length - 60);
    }
  }

  env(p: SimPulse, x: number, now: number) {
    if (x < 0) {
      return 0;
    }
    if (p.type === 'hold') {
      if (x > 8000) {
        return -1;
      }
      const up = Math.min(1, x / 50);
      if (!p.rel) {
        return up;
      }
      const r = (now - p.rel) / 180;
      return r < 1 ? up * (1 - r) : -1;
    }
    if (p.type === 'held') {
      const D = p.duration;
      if (x < 40) {
        return x / 40;
      }
      if (x < D) {
        return 1 - (0.25 * (x - 40)) / D;
      }
      const r = (x - D) / 160;
      return r < 1 ? 0.75 * (1 - r) : -1;
    }
    const D = Math.max(p.duration, 90);
    if (x < 12) {
      return x / 12;
    }
    if (x < D) {
      return 1;
    }
    const r = (x - D) / 150;
    return r < 1 ? 1 - r : -1;
  }

  levels(now: number) {
    const L: Record<Channel, number> = { rhythm: 0, expression: 0 };
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const e = this.env(p, now - p.at, now);
      if (e < 0) {
        this.pulses.splice(i, 1);
        continue;
      }
      const v = e * p.intensity;
      if (v > L[p.channel]) {
        L[p.channel] = v;
      }
    }
    return L;
  }

  clear() {
    this.pulses.length = 0;
  }
}

// Minimal Web Bluetooth surface used here (not in TypeScript's DOM lib).
interface BleCharacteristic {
  writeValue(b: BufferSource): Promise<void>;
  writeValueWithoutResponse?(b: BufferSource): Promise<void>;
}
interface BleDevice extends EventTarget {
  gatt: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryService(
        s: string,
      ): Promise<{ getCharacteristic(c: string): Promise<BleCharacteristic> }>;
    }>;
    disconnect(): void;
  };
}
interface BleNavigator {
  bluetooth?: { requestDevice(o: unknown): Promise<BleDevice> };
}
const ble = () => (navigator as Navigator & BleNavigator).bluetooth;

// ESP32 over BLE (Nordic UART service UUIDs, the default in most ESP32 BLE-UART sketches).
export class BluetoothHapticTransport extends HapticTransport {
  q: Promise<unknown> = Promise.resolve();
  pending = 0;
  dev: BleDevice | null = null;
  ch: BleCharacteristic | null = null;
  manual = false;
  constructor() {
    super('bluetooth');
  }

  static readonly SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  static readonly CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  static supported() {
    const b = ble();
    return !!(b && b.requestDevice);
  }

  async connect() {
    if (!BluetoothHapticTransport.supported()) {
      this.setState('unavailable');
      return false;
    }
    try {
      if (!this.dev) {
        this.setState('searching');
        this.dev = await ble()!.requestDevice({
          filters: [{ services: [BluetoothHapticTransport.SERVICE] }, { namePrefix: 'Resonance' }],
          optionalServices: [BluetoothHapticTransport.SERVICE],
        });
        this.dev.addEventListener('gattserverdisconnected', () => {
          this.ch = null;
          if (!this.manual) {
            this.setState('lost');
          }
        });
      }
      this.manual = false;
      this.setState('connecting');
      const srv = await this.dev.gatt.connect();
      const svc = await srv.getPrimaryService(BluetoothHapticTransport.SERVICE);
      this.ch = await svc.getCharacteristic(BluetoothHapticTransport.CHAR);
      this.setState('connected');
      return true;
    } catch (e) {
      const err = e as { name?: string; message?: string } | null;
      const n = err && err.name;
      const m = (err && err.message) || '';
      if (n === 'SecurityError' || /policy|adapter|not available|globally disabled/i.test(m)) {
        this.setState('unavailable');
      } else {
        this.setState(this.dev && this.state === 'connecting' ? 'lost' : 'not-connected');
      }
      if (this.state === 'not-connected') {
        this.dev = null;
      }
      return false;
    }
  }

  disconnect() {
    this.manual = true;
    try {
      if (this.dev && this.dev.gatt.connected) {
        this.dev.gatt.disconnect();
      }
    } catch {
      /* ignore */
    }
    this.ch = null;
    this.dev = null;
    this.setState('not-connected');
  }

  send(c: HapticCmd) {
    if (this.state !== 'connected' || !this.ch || this.pending > 6) {
      return;
    }
    const ch = this.ch;
    const buf = encode(c);
    this.pending++;
    this.q = this.q
      .then(() =>
        ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(buf) : ch.writeValue(buf),
      )
      .catch(() => {})
      .then(() => {
        this.pending--;
      });
  }
}

export class HapticRouter {
  sim = new SimulatedHapticTransport();
  hw = new BluetoothHapticTransport();
  send(cmds: HapticCmd[]) {
    for (const c of cmds) {
      this.sim.send(c);
      this.hw.send(c);
    }
  }
}

type PhraseNote = [number, number, number, number, string];
export const PHRASES: Record<'A' | 'B', { name: string; desc: string; notes: PhraseNote[] }> = {
  A: {
    name: 'Phrase A',
    desc: 'Long held notes',
    notes: [
      [0, 2, 0, 0.7, 'legato'],
      [2, 2, 2, 0.7, 'legato'],
      [4, 3, 4, 0.8, 'legato'],
      [8, 2, 1, 0.7, 'legato'],
      [10, 2, 3, 0.75, 'legato'],
      [12, 3.5, 5, 0.9, 'legato'],
    ],
  },
  B: {
    name: 'Phrase B',
    desc: 'Short notes and accents',
    notes: [
      [0, 0.25, 5, 0.95, 'staccato'],
      [0.5, 0.25, 4, 0.6, 'staccato'],
      [1, 0.25, 3, 0.6, 'staccato'],
      [1.5, 0.25, 2, 0.6, 'staccato'],
      [3, 0.25, 1, 0.95, 'staccato'],
      [4.5, 0.25, 0, 0.6, 'staccato'],
      [5, 0.25, 1, 0.6, 'staccato'],
      [8, 0.25, 5, 0.95, 'staccato'],
      [8.5, 0.25, 4, 0.6, 'staccato'],
      [9, 0.25, 3, 0.6, 'staccato'],
      [9.5, 0.25, 2, 0.6, 'staccato'],
      [11, 0.25, 1, 0.95, 'staccato'],
      [12.5, 0.25, 0, 0.6, 'staccato'],
      [13, 0.25, 0, 0.95, 'staccato'],
    ],
  },
};
export function phraseLoop(k: 'A' | 'B', _presetKey: unknown, bpmIn?: number | null): LoopDef {
  const p = TONE;
  const bpm = bpmIn || p.bpm;
  const beat = 60 / bpm;
  const def = PHRASES[k];
  return {
    name: def.name,
    desc: def.desc,
    custom: false,
    preset: p.key,
    bpm,
    bars: 4,
    len: 16 * beat,
    base: buildBase(p, bpm, 4),
    raw: def.notes.map(([b, d, slot, vel, art]) => ({
      layer: 'melody' as const,
      t: b * beat,
      dur: d * beat,
      slot,
      midi: p.root + p.scale[slot],
      vel,
      art,
      accent: vel >= 0.9,
      gesture: art === 'legato' ? 'hold' : 'pinch',
    })),
  };
}

// Layered composition: one master loop (4 bars at the detected BPM).
// Metronome beats + every layer, all relative to the same loop start.
export function buildLayered(o: {
  preset?: string;
  bpm: number;
  layers?: PerfLayer[];
  q: string;
}): Score {
  const p = PRESETS[o.preset as string] || TONE;
  const bpm = o.bpm;
  const s16 = 60 / bpm / 4;
  const len = 64 * s16;
  const out: EventInput[] = [];
  for (let bar = 0; bar < 4; bar++) {
    for (let b = 0; b < 4; b++) {
      out.push({
        t: (bar * 16 + b * 4) * s16,
        layer: 'rhythm',
        metro: true,
        vel: b === 0 ? 0.95 : 0.55,
        dur: s16 * 0.5,
        art: 'staccato',
        accent: b === 0,
      });
    }
  }
  (o.layers || []).forEach((L) =>
    (L.raw || []).forEach((n) => {
      const m = quantizeNote(n, o.q, bpm, len, n.layer === 'note' ? 2 : 1);
      const e: EventInput = Object.assign({}, m, {
        inst: L.inst,
        lid: L.id,
        muted: !!L.muted,
        rec: !!L.rec,
      });
      if (n.layer === 'note') {
        e.midi = midiFor(L.inst, n.slot as number, p);
        e.degree = p.degrees[n.slot as number];
      }
      out.push(e);
    }),
  );
  const ev = out
    .map((x) => makeEvent(x, bpm))
    .sort((a, b) => a.t - b.t || (LAYER_ORDER[a.layer] || 0) - (LAYER_ORDER[b.layer] || 0));
  const seen: Record<string, number> = {};
  ev.forEach((e) => {
    if (seen[e.id]) {
      e.id += '_' + seen[e.id]++;
    } else {
      seen[e.id] = 1;
    }
  });
  return { events: ev, len, bpm, bars: 4, preset: p.key };
}
// Tempo from steady hits: median of recent intervals, accepted once the last few agree.
// No model, just timing.
export function estimateBpm(hits: number[]): { ok: boolean; bpm?: number; med?: number } {
  if (hits.length < 4) {
    return { ok: false };
  }
  const iv: number[] = [];
  for (let i = 1; i < hits.length; i++) {
    iv.push(hits[i] - hits[i - 1]);
  }
  const tail = iv.slice(-4);
  const srt = tail.slice().sort((a, b) => a - b);
  const med =
    srt.length % 2 ? srt[srt.length >> 1] : (srt[srt.length / 2 - 1] + srt[srt.length / 2]) / 2;
  const dev = iv.map((x) => Math.abs(x - med) / med);
  const l3 = Math.max(...dev.slice(-3));
  const l4 = Math.max(...dev.slice(-4));
  const ok = (iv.length >= 3 && l3 < 0.12) || (iv.length >= 4 && l4 < 0.22);
  let bpm = 60 / med;
  while (bpm > 180) {
    bpm /= 2;
  }
  while (bpm < 60) {
    bpm *= 2;
  }
  return { ok, bpm: Math.round(clamp(bpm, 60, 180)), med };
}

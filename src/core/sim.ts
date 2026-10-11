import type { Channel, InstKey, RawNote } from './engine';

/**
 * Mutable per-frame state shared by the controller and the particle field.
 * Never put this in React state.
 */

export type Screen = 'welcome' | 'tutorial' | 'tempo' | 'studio';
export type Transport =
  | 'ready'
  | 'finding'
  | 'found'
  /** A take is armed: the loop plays on until the next bar line that allows a full count-in. */
  | 'armed'
  | 'countin'
  | 'recording'
  | 'playing'
  | 'paused'
  | 'replay'
  | 'saved';

export interface Ripple {
  x: number;
  y: number;
  r: number;
  v: number;
  w: number;
  s: number;
  life: number;
  decay: number;
  hot?: number;
  col?: string;
}
export interface Float {
  x: number;
  y: number;
  text: string;
  life: number;
  held?: boolean;
}
export interface Hold {
  x: number;
  y: number;
  end: number;
}

/** v8 notation: one instrument-shaped mark (kick ellipse, snare spokes, keys triangles, …). */
export interface NoteMark {
  k: string;
  x: number;
  y: number;
  t0: number;
  v: number;
  life: number;
  /** snare spoke angle */
  a?: number;
  /** hat grain angles and radii */
  pts?: [number, number][];
  /** lead direction */
  dx?: number;
}

/** v8 notation: a held note's ribbon, growing at loop speed for the note's duration. */
export interface Ribbon {
  inst: string;
  x0: number;
  y: number;
  t0: number;
  end: number;
  sp: number;
  v: number;
  ph: number;
}

/** v8 notation: particles gather briefly toward a melodic note's pitch height. */
export interface Gather {
  y: number;
  t0: number;
  k: number;
}
/** [left, top, right, bottom, soft] in canvas coordinates. */
export type AvoidRect = [number, number, number, number, number];

/**
 * One performing hand. Hand 0 is the primary hand (cursor, keyboard, tutorial ghost and the
 * camera's first hand); hand 1 exists only for a second camera hand. Every piece of interaction
 * state lives here, so one hand opening or leaving never touches the other's pinch or note.
 */
export interface Hand {
  /** 0 = primary, 1 = second camera hand. */
  idx: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  speed: number;
  amt: number;
  pinch: boolean;
  ghostPinch: boolean;
  camPinch?: boolean;
  lastMove: number;
  /** Movement energy of this hand (0..1); drives its own note / hit strength. */
  energy: number;
  /** This hand's sounding note, if any. */
  live: LiveNote | null;
  /** Pitch slot of this hand's held note (-1 = none), for slurs. */
  heldNote: number;
  /** Camera pinch hysteresis: closest distance while pinched, widest since the last pinch. */
  pinchLo: number;
  pinchHi: number;
  /** Camera identity: MediaPipe handedness label this hand is following, and when last seen. */
  camKey: string | null;
  camSeen: number;
  /** Last camera palm position (normalised), for matching when handedness is unavailable. */
  camX: number;
  camY: number;
}

export function createHand(idx: number): Hand {
  return {
    idx,
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    amt: 0,
    pinch: false,
    ghostPinch: false,
    lastMove: -99,
    energy: 0,
    live: null,
    heldNote: -1,
    pinchLo: Infinity,
    pinchHi: Infinity,
    camKey: null,
    camSeen: -99,
    camX: 0.5,
    camY: 0.5,
  };
}
export interface LiveNote {
  start: number;
  /** Transport position (sixteenths) when the note started. */
  startStep: number;
  slot: number;
  midi: number;
  vel: number;
  slur: boolean;
  holdSent: boolean;
  /** The held-note pulse actually reached the Bass motor (so its release must follow). */
  holdFelt?: boolean;
  inst: string;
  done?: boolean;
}
/** Set while the master transport runs. The transport owns all timing; this is a running flag + loop facts. */
export interface Clock {
  kind: 'master';
  len: number;
  bpm: number;
}

/** A recording window, in absolute transport sixteenths. */
export interface RecWindow {
  inst: InstKey;
  ciStep: number;
  startStep: number;
  endStep: number;
  /** The layer is committed at endStep; late events inside the scheduler lookahead still land in it. */
  closing?: boolean;
  /**
   * Decided when the take begins: committed Drums / Bass give the wristband a groove to feel
   * (true), otherwise the metronome carries on through the take (false).
   */
  groove?: boolean;
}

export interface Sim {
  t: number;
  W: number;
  H: number;
  ox: number;
  oy: number;
  n: number;
  ripples: Ripple[];
  floats: Float[];
  avoid: AvoidRect[];
  band?: [number, number] | null;
  intensity: number;
  boost: number;
  haptic: number;
  noteFlash: number;
  beatInBar: number;
  transport: Transport;
  screen: Screen;
  step: number;
  reduced: boolean;
  muted: boolean;
  audioOn: boolean;
  mouseT: number;
  loop: null;
  handScale: number;
  handSize: number;
  clock: Clock | null;
  fired: Record<string, number>;
  lastLive: null;
  recRaw: RawNote[];
  recBase: unknown[];
  lastCue: string;
  cueT: number;
  focus: boolean;
  silent: boolean;
  hideWrist: boolean;
  noHaptic: boolean;
  /** Overall movement energy (the stronger hand), for the sand and the sound's brightness. */
  energy: number;
  spread: number;
  rec: RecWindow | null;
  pulseHits: number[];
  layerFire: Record<string, number>;
  inst: InstKey;
  /** Absolute transport step until which the status reads "Loop ready". */
  loopReadyUntil: number;
  beatT: number;
  holds: Hold[];
  lastFire: Record<Channel, number>;
  /** Both performing hands; `hand` is hands[0]. */
  hands: [Hand, Hand];
  hand: Hand;
  // v8 visual notation (empty / inactive when notation is off)
  marks: NoteMark[];
  ribbons: Ribbon[];
  /** Live held-note trail: [x, y, t] points. */
  trail: [number, number, number][];
  /** When the live trail started fading out (0 = not fading). */
  trailOff: number;
  trailInst?: string;
  gathers: Gather[];
  /** Downbeat "breath": start time and strength. */
  breathT: number;
  breathK: number;
  // optional/late-bound fields the prototype adds on the fly
  handSeen?: number;
  bothT?: number;
  holdRipT?: number;
  prevBpm?: number | null;
  viaPulse?: boolean;
  // particle buffers (sized in initParticles)
  pp: { speed: number; turb: number; hues: number[] };
  hueW: number[];
  px: Float32Array;
  py: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  pz: Float32Array;
  off: Float32Array;
  hue: Uint8Array;
  key: Uint8Array;
  order: Int32Array;
  counts: Int32Array;
  starts: Int32Array;
}

export function createSim(screen: Screen, reduced: boolean): Sim {
  const hands: [Hand, Hand] = [createHand(0), createHand(1)];
  return {
    t: 0,
    W: 1,
    H: 1,
    ox: 0,
    oy: 0,
    n: 0,
    ripples: [],
    floats: [],
    avoid: [],
    intensity: 0.1,
    boost: 0,
    haptic: 0,
    noteFlash: 0,
    beatInBar: -1,
    transport: 'ready',
    screen,
    step: 0,
    reduced,
    muted: false,
    audioOn: false,
    mouseT: -99,
    loop: null,
    handScale: 1,
    handSize: 0.2,
    clock: null,
    fired: {},
    lastLive: null,
    recRaw: [],
    recBase: [],
    lastCue: '',
    cueT: -9,
    focus: false,
    silent: false,
    hideWrist: false,
    noHaptic: false,
    energy: 0,
    spread: 0,
    rec: null,
    pulseHits: [],
    layerFire: {},
    inst: 'drums',
    loopReadyUntil: -1,
    beatT: -9,
    holds: [],
    marks: [],
    ribbons: [],
    trail: [],
    trailOff: 0,
    gathers: [],
    breathT: -9,
    breathK: 0,
    lastFire: { rhythm: -9, expression: -9 },
    hands,
    hand: hands[0],
    pp: { speed: 1, turb: 1, hues: [] },
    hueW: [],
    px: new Float32Array(0),
    py: new Float32Array(0),
    vx: new Float32Array(0),
    vy: new Float32Array(0),
    pz: new Float32Array(0),
    off: new Float32Array(0),
    hue: new Uint8Array(0),
    key: new Uint8Array(0),
    order: new Int32Array(0),
    counts: new Int32Array(72),
    starts: new Int32Array(72),
  };
}

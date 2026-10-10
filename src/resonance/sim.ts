import type { Channel, MusicEvent } from './engine';

/** Mutable per-frame state shared by the controller and the particle field. Never put this in React state. */

export type Screen = 'welcome' | 'tutorial' | 'tempo' | 'studio';
export type Transport = 'ready' | 'finding' | 'found' | 'countin' | 'recording' | 'playing' | 'paused' | 'replay' | 'saved';

export interface Ripple { x: number; y: number; r: number; v: number; w: number; s: number; life: number; decay: number; hot?: number; col?: string }
export interface Float { x: number; y: number; text: string; life: number; held?: boolean }
export interface Hold { x: number; y: number; end: number }
/** [left, top, right, bottom, soft] in canvas coordinates. */
export type AvoidRect = [number, number, number, number, number];

export interface Hand {
  x: number; y: number; tx: number; ty: number; px: number; py: number; vx: number; vy: number; speed: number; amt: number;
  pinch: boolean; ghostPinch: boolean; camPinch?: boolean; lastMove: number;
}
export interface LiveNote { start: number; slot: number; midi: number; vel: number; slur: boolean; holdSent: boolean; inst: string; done?: boolean }
export interface Clock { kind: string; events: MusicEvent[]; len: number; bpm: number; preset?: string; start: number; prev: number; loop: boolean; onEnd?: () => void }
export interface RecWindow { inst: string; ci: number; start: number; end: number }

export interface Sim {
  t: number; W: number; H: number; ox: number; oy: number; n: number;
  ripples: Ripple[]; floats: Float[]; avoid: AvoidRect[]; band?: [number, number] | null;
  intensity: number; boost: number; haptic: number; noteFlash: number; beatInBar: number;
  transport: Transport; screen: Screen; step: number; reduced: boolean; muted: boolean; audioOn: boolean;
  mouseT: number; heldNote: number; loop: null; handScale: number; handSize: number;
  clock: Clock | null; fired: Record<string, number>; live: LiveNote | null; lastLive: null; recRaw: unknown[]; recBase: unknown[];
  lastCue: string; cueT: number; focus: boolean; silent: boolean; hideWrist: boolean; noHaptic: boolean; energy: number; spread: number;
  rec: RecWindow | null; pulseHits: number[]; layerFire: Record<string, number>; inst: string; loopReadyUntil: number; beatT: number;
  holds: Hold[]; lastFire: Record<Channel, number>; hand: Hand;
  // optional/late-bound fields the prototype adds on the fly
  handSeen?: number; bothT?: number; flickT?: number; holdRipT?: number; ghostFlicked?: boolean; prevBpm?: number | null; viaPulse?: boolean;
  // particle buffers (sized in initParticles)
  pp: { speed: number; turb: number; hues: number[] }; hueW: number[];
  px: Float32Array; py: Float32Array; vx: Float32Array; vy: Float32Array; pz: Float32Array; off: Float32Array;
  hue: Uint8Array; key: Uint8Array; order: Int32Array; counts: Int32Array; starts: Int32Array;
}

export function createSim(screen: Screen, reduced: boolean): Sim {
  return { t: 0, W: 1, H: 1, ox: 0, oy: 0, n: 0, ripples: [], floats: [], avoid: [], intensity: .1, boost: 0, haptic: 0, noteFlash: 0, beatInBar: -1,
    transport: 'ready', screen, step: 0, reduced, muted: false, audioOn: false, mouseT: -99, heldNote: -1, loop: null, handScale: 1, handSize: .2,
    clock: null, fired: {}, live: null, lastLive: null, recRaw: [], recBase: [], lastCue: '', cueT: -9, focus: false, silent: false, hideWrist: false, noHaptic: false, energy: 0, spread: 0,
    rec: null, pulseHits: [], layerFire: {}, inst: 'drums', loopReadyUntil: -1, beatT: -9, holds: [], lastFire: { rhythm: -9, expression: -9 }, hand: { x: 0, y: 0, tx: 0, ty: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0, amt: 0, pinch: false, ghostPinch: false, lastMove: -99 },
    pp: { speed: 1, turb: 1, hues: [] }, hueW: [],
    px: new Float32Array(0), py: new Float32Array(0), vx: new Float32Array(0), vy: new Float32Array(0), pz: new Float32Array(0), off: new Float32Array(0),
    hue: new Uint8Array(0), key: new Uint8Array(0), order: new Int32Array(0), counts: new Int32Array(72), starts: new Int32Array(72) };
}

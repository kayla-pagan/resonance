import type { HwState, InstKey, Quant } from './engine';
import type { Screen, Transport } from './sim';

/** Fixed design-time props of the v7 prototype (its data-props defaults). */
export const PROTOTYPE_PROPS = {
  welcomeLayout: 'Editorial',
  startScreen: 'welcome' as Screen,
  density: 'Light' as const,
  trails: 0.45,
};
export type PrototypeProps = typeof PROTOTYPE_PROPS;

export type Feel = 'full' | 'rhythm' | 'expression' | 'off';

/**
 * React-owned application state.
 * Field names match the prototype's `this.state` so ported logic reads the same.
 */
export interface AppState {
  loopPop: boolean;
  vh: number;
  pvMobHidden: boolean;
  sheet: 'closed' | 'half' | 'full' | 'layers';
  vw: number;
  showBand: boolean;
  hwTest: boolean;
  hwLevel: 'low' | 'med' | 'high';
  hwLast: string;
  showKeys: boolean;
  showA11y: boolean;
  showChar: boolean;
  playMode: 'both' | 'feel' | 'hear';
  feelMsg: string;
  feelMsgOn: boolean;
  camNotice: boolean;
  camBlocked: boolean;
  showPreview: boolean;
  track: 'off' | 'loading' | 'on' | 'failed';
  handIn: boolean;
  screen: Screen;
  step: number;
  mode: 'demo' | 'live';
  cam: 'simulated' | 'pending' | 'live' | 'unavailable';
  transport: Transport;
  audioOn: boolean;
  muted: boolean;
  reduced: boolean;
  bpm: number | null;
  pick: boolean;
  clickOn: boolean;
  recInst: InstKey | null;
  pulse: { n: number; msg: string };
  layersVer: number;
  quant: Quant;
  feel: Feel;
  focus: 'feel' | 'quiz' | null;
  feelAudio: 'both' | 'feel' | 'hear';
  bandHw: HwState;
  scoreVer: number;
  savedMsg: string;
  quiz: {
    phase: 'learn' | 'playing' | 'answer' | 'result';
    which: 'A' | 'B' | null;
    guess: 'A' | 'B' | null;
    playing: 'A' | 'B' | null;
    showScore: boolean;
  };
  /** Mirrors of sim.prevBpm / sim.viaPulse, so render code never reads the mutable sim. */
  prevBpm: number | null;
  viaPulse: boolean;
}

export type StatePatch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

export function initialState(): AppState {
  return {
    loopPop: false,
    vh: window.innerHeight,
    pvMobHidden: false,
    sheet: 'closed',
    vw: window.innerWidth,
    showBand: false,
    hwTest: false,
    hwLevel: 'med',
    hwLast: '',
    showKeys: false,
    showA11y: false,
    showChar: false,
    playMode: 'both',
    feelMsg: '',
    feelMsgOn: false,
    camNotice: false,
    camBlocked: false,
    showPreview: true,
    track: 'off',
    handIn: false,
    screen: PROTOTYPE_PROPS.startScreen,
    step: 0,
    mode: 'demo',
    cam: 'simulated',
    transport: 'ready',
    audioOn: false,
    muted: false,
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    bpm: null,
    pick: false,
    clickOn: true,
    recInst: null,
    pulse: { n: 0, msg: '' },
    layersVer: 0,
    quant: 'balanced',
    feel: 'full',
    focus: null,
    feelAudio: 'feel',
    bandHw: 'not-connected',
    scoreVer: 0,
    savedMsg: '',
    quiz: { phase: 'learn', which: null, guess: null, playing: null, showScore: false },
    prevBpm: null,
    viaPulse: false,
  };
}

/** Low-rate (66 ms) readout snapshot, the prototype's `state.ui`. */
export interface Ui {
  inst: string;
  count: number;
  recBar: number;
  act: Record<string, boolean>;
  energy: number;
  slot: number;
  name: string;
  deg: string;
  zone: number;
  nx: number;
  ny: number;
  pinch: boolean;
  hap: number;
  beat: number;
  timer: string;
  total: string;
  phase: number;
  bar: number;
  flash: number;
  active: boolean;
  cue: string;
}

const INITIAL_UI: Ui = {
  inst: '',
  count: 0,
  recBar: 0,
  act: {},
  slot: 2,
  name: '',
  deg: '3',
  zone: 1,
  nx: 0.5,
  ny: 0.5,
  pinch: false,
  hap: 0,
  beat: -1,
  timer: '00:00.0',
  total: '',
  phase: 0,
  bar: 0,
  flash: 0,
  active: false,
  cue: '',
  energy: 0,
};

function sameUi(a: Ui, b: Ui) {
  for (const k in a) {
    const key = k as keyof Ui;
    if (key !== 'act' && a[key] !== b[key]) {
      return false;
    }
  }
  const ak = Object.keys(a.act);
  const bk = Object.keys(b.act);
  return ak.length === bk.length && ak.every((k) => a.act[k] === b.act[k]);
}

/** External store for the UI snapshot; components read it with useSyncExternalStore. */
export class UiStore {
  private snap: Ui = INITIAL_UI;
  private subs = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  get = () => this.snap;
  set(u: Ui) {
    if (sameUi(this.snap, u)) {
      return;
    }
    this.snap = u;
    this.subs.forEach((f) => f());
  }
}

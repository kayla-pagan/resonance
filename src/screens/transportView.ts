import { INSTR } from '../resonance/engine';
import { availableInstruments, type AppState, type Ui } from '../resonance/appState';

const TRI = 'polygon(0 0,100% 50%,0 100%)';

export interface StatusLook {
  label: string;
  col: string;
  radius: string;
  bg: string;
  border: string;
  clip: string;
  bar: string;
}

/** Transport status and control state, derived the way v7's renderVals did. */
export function transportView(st: AppState, u: Ui) {
  const tr = st.transport;
  const nL = st.layers.length;
  const mob = st.vw < 700;
  const busy = tr === 'countin' || tr === 'recording';
  const running = tr === 'playing' || tr === 'found';
  const canPlay = !!st.bpm && (running || tr === 'paused');
  const recName = st.recInst ? INSTR[st.recInst].name : '';
  const available = availableInstruments(st.layers);

  const looks: Record<string, Omit<StatusLook, 'bar'>> = {
    ready: {
      label: 'Ready',
      col: '#ece6d8',
      radius: '50%',
      bg: 'transparent',
      border: '1.5px solid #ece6d8',
      clip: 'none',
    },
    finding: {
      label: 'Finding pulse',
      col: '#7fe0ec',
      radius: '50%',
      bg: 'transparent',
      border: '1.5px dashed #7fe0ec',
      clip: 'none',
    },
    found: {
      label: (st.viaPulse ? 'Pulse found' : 'Tempo set') + (mob ? '' : ' — ' + st.bpm + ' BPM'),
      col: '#ece6d8',
      radius: '50%',
      bg: '#7fe0ec',
      border: 'none',
      clip: 'none',
    },
    countin: {
      label: 'Count in',
      col: '#f2bd72',
      radius: '50%',
      bg: 'transparent',
      border: '1.5px solid #f2bd72',
      clip: 'none',
    },
    recording: {
      label: 'Recording ' + recName,
      col: '#f2bd72',
      radius: '50%',
      bg: '#f2bd72',
      border: 'none',
      clip: 'none',
    },
    loopready: {
      label: 'Loop ready',
      col: '#ece6d8',
      radius: '1px',
      bg: '#7fe0ec',
      border: 'none',
      clip: 'none',
    },
    playing: {
      label: 'Playing',
      col: '#ece6d8',
      radius: '0',
      bg: '#7fe0ec',
      border: 'none',
      clip: TRI,
    },
    paused: {
      label: 'Paused',
      col: '#ece6d8',
      radius: '1px',
      bg: 'transparent',
      border: '1.5px solid #ece6d8',
      clip: 'none',
    },
  };
  const key = tr === 'playing' && u.loopReady ? 'loopready' : tr;
  const layerCount = nL === 1 ? '1 layer' : nL + ' layers';
  const bar =
    tr === 'ready'
      ? 'Drums first'
      : tr === 'finding'
        ? st.pulse.msg
          ? 'Try again'
          : st.pulse.n + ' of 8 hits'
        : tr === 'found'
          ? (mob ? st.bpm + ' BPM · ' : '') + 'Tempo locked'
          : tr === 'countin'
            ? recName + (u.count ? ' in ' + u.count : ' next bar')
            : tr === 'recording'
              ? 'Bar ' + (u.recBar || 1) + ' / 4'
              : st.bpm + ' BPM · ' + layerCount;
  const status: StatusLook = { ...(looks[key] || looks.ready), bar };

  // Record button: find pulse → record drums → add a layer → complete (all four layers).
  const complete = !busy && nL > 0 && !available.length;
  const primText =
    tr === 'ready'
      ? 'Find my pulse'
      : tr === 'finding'
        ? 'Cancel'
        : busy
          ? 'Stop'
          : !nL
            ? 'Record drums'
            : complete
              ? 'Complete'
              : '+ Add layer';
  const primDis = !!st.focus || (complete && tr !== 'ready' && tr !== 'finding');

  return {
    tr,
    nL,
    complete,
    busy,
    running,
    canPlay,
    status,
    available,
    primText,
    primDis,
    beatsOn: !!st.bpm && (running || busy),
    resetDis: tr === 'ready' && !nL,
  };
}

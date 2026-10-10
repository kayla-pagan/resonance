import type { AppState, ScoreView } from '../resonance/appState';
import type { InstKey } from '../resonance/engine';

const pct = (v: number) => (v * 100).toFixed(2) + '%';

/** Legend swatch per instrument (v7 SHP). */
export const LEGEND_SHAPE: Record<
  InstKey,
  { w: string; h: string; r: string; clip: string; bg: string }
> = {
  drums: { w: '7px', h: '7px', r: '50%', clip: 'none', bg: '#ece6d8' },
  bass: { w: '12px', h: '4px', r: '2px', clip: 'none', bg: '#7fe0ec' },
  keys: { w: '8px', h: '8px', r: '0', clip: 'polygon(50% 0,100% 100%,0 100%)', bg: '#7fe0ec' },
  lead: {
    w: '8px',
    h: '8px',
    r: '0',
    clip: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
    bg: '#7fe0ec',
  },
};

/**
 * Tactile score geometry: two lanes, one per motor of the two-motor prototype.
 * Count-in / recording: both lanes show the same metronome beats (both motors keep time) and the
 * existing layers are dimmed, since they are heard but not felt during a take.
 * Playback: Drums lane = kick / snare (hats are heard, not felt, so drawn faint); Bass lane = bass
 * notes, bars as long as held notes. No metronome is felt in playback, so none is drawn.
 * Keys and Lead have no motor and never appear here (they are in the Music view).
 */
export function scoreGeometry(score: ScoreView, st: AppState) {
  const L = score.len;
  const pOK = st.feel === 'full' || st.feel === 'rhythm';
  const eOK = st.feel === 'full' || st.feel === 'expression';
  const metroFelt = st.transport === 'countin' || st.transport === 'recording';
  const dim = (m: { muted: boolean; rec: boolean }) =>
    (m.muted ? 0.22 : m.rec ? 0.6 : 1) * (metroFelt ? 0.35 : 1);

  /** The tactile metronome: drawn identically in both lanes while it is felt. */
  const metro = (ok: boolean) =>
    metroFelt
      ? score.marks
          .filter((m) => m.layer === 'rhythm' && m.metro)
          .map((m) => {
            const size = m.step === 0 ? 7 : 4;
            return {
              id: m.id,
              left: pct(m.t / L),
              size: size + 'px',
              margin: -size / 2 + 'px',
              bg: 'rgba(236,230,216,.6)',
              op: ok ? 1 : 0.18,
            };
          })
      : [];

  const drums = score.marks
    .filter((m) => m.layer === 'drum')
    .map((m) => {
      const size = m.drum === 'kick' ? 9 : m.drum === 'snare' ? 6 : 3;
      return {
        id: m.id,
        left: pct(m.t / L),
        size: size + 'px',
        margin: -size / 2 + 'px',
        bg: m.drum === 'hat' ? 'rgba(236,230,216,.3)' : 'rgba(236,230,216,.72)',
        op: (pOK ? 1 : 0.18) * dim(m),
      };
    });

  const bass = score.marks
    .filter((m) => m.layer === 'note' && m.inst === 'bass')
    .map((m) => {
      const hh = (m.legato ? 5 : 4) + (m.accent ? 2 : 0);
      return {
        id: m.id,
        left: pct(m.t / L),
        w: m.legato ? pct(Math.max((m.dur / L) * 0.97, 0.008)) : '11px',
        h: hh + 'px',
        mt: -hh / 2 + 'px',
        op: (eOK ? 1 : 0.18) * dim(m),
      };
    });

  const bars = [0, 1, 2, 3].map((i) => ({ left: i * 25 + '%', n: i + 1 }));
  return {
    bars,
    pulse: [...metro(pOK), ...drums],
    exprBeats: metro(eOK),
    bass,
    keepingTime: metroFelt,
  };
}

/** Music view rows: one per instrument (v8 musRows). Colour plus a distinct shape per instrument. */
const MUS_TOP: Record<InstKey, number> = { drums: 12.5, bass: 37.5, keys: 62.5, lead: 87.5 };
const MUS_COL: Record<InstKey, string> = {
  drums: '#ece6d8',
  bass: '#a99bff',
  keys: '#7fe0ec',
  lead: '#f2bd72',
};
export const MUS_ROWS: {
  inst: InstKey;
  top: string;
  w: string;
  h: string;
  r: string;
  clip: string;
  bg: string;
}[] = [
  { inst: 'drums', top: '12.5%', w: '8px', h: '8px', r: '50%', clip: 'none', bg: '#ece6d8' },
  { inst: 'bass', top: '37.5%', w: '12px', h: '4px', r: '2px', clip: 'none', bg: '#a99bff' },
  {
    inst: 'keys',
    top: '62.5%',
    w: '9px',
    h: '8px',
    r: '0',
    clip: 'polygon(50% 0,100% 100%,0 100%)',
    bg: '#7fe0ec',
  },
  {
    inst: 'lead',
    top: '87.5%',
    w: '9px',
    h: '9px',
    r: '0',
    clip: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
    bg: '#f2bd72',
  },
];

export interface MusicMark {
  key: string;
  id: string;
  left: string;
  top: string;
  w: string;
  h: string;
  ml: string;
  mt: string;
  r: string;
  clip: string;
  bg: string;
  bd: string;
  col: string;
  /** Snare: an outlined ring that stays hollow when lit. */
  ring: boolean;
  op: number;
}

/**
 * Music view of the score (v8 musMarks): one row per instrument; shape = instrument,
 * width = duration, size = dynamics, small vertical offset = pitch. Firing highlights are
 * applied imperatively (data-on), like the Tactile view.
 */
export function musicGeometry(score: ScoreView) {
  const L = score.len;
  const dim = (m: { muted: boolean; rec: boolean }) => (m.muted ? 0.22 : m.rec ? 0.6 : 1);
  const marks: MusicMark[] = [];
  const mk = (
    m: ScoreView['marks'][number],
    inst: InstKey,
    part: string,
    o: Partial<MusicMark>,
  ): MusicMark => ({
    key: m.id + part,
    id: m.id,
    left: pct(m.t / L),
    top: MUS_TOP[inst] + '%',
    w: '0px',
    h: '0px',
    ml: '0px',
    mt: '0px',
    r: '0',
    clip: 'none',
    bg: MUS_COL[inst],
    bd: 'none',
    col: MUS_COL[inst],
    ring: false,
    op: dim(m),
    ...o,
  });

  for (const m of score.marks) {
    if (m.layer === 'drum') {
      const d = m.drum;
      const sz = d === 'kick' ? 10 : d === 'snare' ? 8 : 4;
      const ring = d === 'snare';
      marks.push(
        mk(m, 'drums', '', {
          w: sz + 'px',
          h: sz + 'px',
          ml: -sz / 2 + 'px',
          mt: -sz / 2 + (d === 'kick' ? 3 : d === 'hat' ? -4 : 0) + 'px',
          r: '50%',
          bg: ring ? 'transparent' : d === 'hat' ? 'rgba(236,230,216,.6)' : '#ece6d8',
          bd: ring ? '1.5px solid #ece6d8' : 'none',
          ring,
        }),
      );
      continue;
    }
    if (m.layer !== 'note' && m.layer !== 'melody') {
      continue;
    }
    const inst: InstKey =
      m.inst === 'bass' || m.inst === 'keys' || m.inst === 'lead' ? m.inst : 'lead';
    const dy = (2.5 - (m.slot || 0)) * 1.6;
    const v = m.vel;
    // Bass and held notes: a bar as long as the note.
    if (inst === 'bass' || m.legato) {
      const hh =
        (inst === 'bass' ? 4 : inst === 'keys' ? 3 : 2) + (m.accent ? 1 : 0) + (v > 0.8 ? 1 : 0);
      marks.push(
        mk(m, inst, '-bar', {
          w: pct(Math.max(((m.legato ? m.dur : 0.12) / L) * 0.97, 0.008)),
          h: hh + 'px',
          mt: dy - hh / 2 + 'px',
          r: '2px',
          op: dim(m) * (inst === 'bass' ? 1 : 0.55),
        }),
      );
      if (inst === 'bass') {
        continue;
      }
    }
    // Keys ▲ / Lead ◆ note head; larger for accents and louder notes.
    const sz = Math.round(m.accent ? 11 : 6 + v * 4);
    marks.push(
      mk(m, inst, '-head', {
        w: sz + 'px',
        h: sz + 'px',
        ml: -sz / 2 + 'px',
        mt: dy - sz / 2 + 'px',
        clip:
          inst === 'lead'
            ? 'polygon(50% 0,100% 50%,50% 100%,0 50%)'
            : 'polygon(50% 0,100% 100%,0 100%)',
      }),
    );
  }

  // Beat grid between the bar lines.
  const beats = Array.from({ length: 16 }, (_, i) => i)
    .filter((i) => i % 4)
    .map((i) => ({ i, left: pct(i / 16) }));
  const present = new Set(score.legend.map((l) => l.inst));
  const rows = MUS_ROWS.map((r) => ({ ...r, op: present.has(r.inst) ? 1 : 0.32 }));
  return { marks, beats, rows };
}

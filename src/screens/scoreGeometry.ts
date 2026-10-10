import type { AppState, ScoreView } from '../resonance/appState';
import type { InstKey } from '../resonance/engine';

const pct = (v: number) => (v * 100).toFixed(2) + '%';

/** Vertical position of each instrument in the Expression lane. */
const TOP: Record<string, string> = { bass: '86%', keys: '75%', lead: '64%' };

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
 * Tactile score geometry: two lanes, one per motor (v7 scoreGeom).
 * Pulse = felt beats and drums; Expression = notes (▲ keys, ◆ lead, bars for bass and held
 * notes, larger for accents); a flick joins both lanes.
 */
export function scoreGeometry(score: ScoreView, st: AppState) {
  const L = score.len;
  const pOK = st.feel === 'full' || st.feel === 'rhythm';
  const eOK = st.feel === 'full' || st.feel === 'expression';
  const metroFelt = st.transport === 'countin' || st.transport === 'recording';
  const dim = (m: { muted: boolean; rec: boolean }) => (m.muted ? 0.22 : m.rec ? 0.6 : 1);

  const pulse = score.marks
    .filter((m) => (m.layer === 'rhythm' && m.felt) || m.layer === 'drum')
    .map((m) => {
      let size: number;
      let bg: string;
      if (m.layer === 'rhythm') {
        size = m.metro
          ? m.step === 0
            ? metroFelt
              ? 7
              : 5
            : metroFelt
              ? 4
              : 3
          : m.step === 0
            ? 9
            : 6;
        bg = m.metro
          ? metroFelt
            ? 'rgba(236,230,216,.55)'
            : 'rgba(236,230,216,.2)'
          : 'rgba(236,230,216,.5)';
      } else {
        size = m.drum === 'kick' ? 9 : m.drum === 'snare' ? 6 : 3;
        bg = m.drum === 'hat' ? 'rgba(236,230,216,.35)' : 'rgba(236,230,216,.72)';
      }
      return {
        id: m.id,
        left: pct(m.t / L),
        size: size + 'px',
        margin: -size / 2 + 'px',
        bg,
        op: (pOK ? 1 : 0.18) * dim(m),
      };
    });

  const expr = score.marks
    .filter((m) => m.layer === 'melody' || m.layer === 'note')
    .map((m) => {
      const inst = m.inst || 'keys';
      const top = TOP[inst] || '75%';
      const op = (eOK ? 1 : 0.18) * dim(m);
      const base = { id: m.id, top, left: pct(m.t / L), op, glow: false };
      if (m.legato) {
        const hh = (inst === 'bass' ? 5 : inst === 'lead' ? 2 : 3) + (m.accent ? 2 : 0);
        return {
          ...base,
          w: pct(Math.max((m.dur / L) * 0.97, 0.008)),
          h: hh + 'px',
          mt: -hh / 2 + 'px',
          ml: '0px',
          r: '3px',
          clip: 'none',
          glow: true,
        };
      }
      if (inst === 'bass') {
        return {
          ...base,
          w: '11px',
          h: '4px',
          mt: '-2px',
          ml: '0px',
          r: '2px',
          clip: 'none',
          glow: true,
        };
      }
      const sz = Math.round(m.accent ? 12 : 7 + m.vel * 3);
      const clip =
        inst === 'lead'
          ? 'polygon(50% 0,100% 50%,50% 100%,0 50%)'
          : 'polygon(50% 0,100% 100%,0 100%)';
      return {
        ...base,
        w: sz + 'px',
        h: sz + 'px',
        mt: (inst === 'lead' ? -sz / 2 : -sz * 0.6) + 'px',
        ml: -sz / 2 + 'px',
        r: '0',
        clip,
      };
    });

  const hits = score.marks
    .filter((m) => m.layer === 'hit')
    .map((m) => ({ id: m.id, left: pct(m.t / L), op: (pOK || eOK ? 1 : 0.18) * dim(m) }));

  const bars = [0, 1, 2, 3].map((i) => ({ left: i * 25 + '%', n: i + 1 }));
  return { bars, pulse, expr, hits };
}

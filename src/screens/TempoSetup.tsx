import { useSyncExternalStore } from 'react';
import { HitDots } from '../ui/Dots';
import { beatDot } from '../ui/beats';
import type { ScreenProps } from './types';
import './TempoSetup.css';

/** "Set your tempo": −/+ adjust, Find my pulse taps it in, Start carries it into the studio. */
export function TempoSetup({ st, ctrl, ui }: ScreenProps) {
  const u = useSyncExternalStore(ui.subscribe, ui.get);
  const tr = st.transport;
  const running = tr === 'playing' || tr === 'found';
  const camHit = st.cam === 'live' && st.track === 'on';
  const finding = tr === 'finding' && !st.pulse.msg;
  const sub =
    tr === 'finding'
      ? st.pulse.msg
        ? 'That pulse was uneven. Keep the hits evenly spaced and try again.'
        : camHit
          ? 'Pinch in a steady rhythm, 4–8 times.'
          : 'Click the field in a steady rhythm, 4–8 times, or press J.'
      : tr === 'found' && st.viaPulse
        ? 'Pulse found. Start when you are ready.'
        : 'Adjust with − and +, or find the tempo from your own movement.';

  return (
    <div className="tempo-wrap">
      <div data-avoid="soft" className="tempo">
        <span className="tempo-eyebrow shadow-soft">Set your tempo</span>
        <div className="tempo-dial">
          <button
            onClick={() => ctrl.current?.tempoAdj(-1)}
            aria-label="Slower"
            className="tempo-step hv-accent-border"
          >
            −
          </button>
          <div aria-live="polite" className="tempo-readout">
            <span className="tempo-bpm serif">{st.bpm || st.prevBpm || 100}</span>
            <span className="tempo-unit mono">BPM</span>
          </div>
          <button
            onClick={() => ctrl.current?.tempoAdj(1)}
            aria-label="Faster"
            className="tempo-step hv-accent-border"
          >
            +
          </button>
        </div>
        <div aria-hidden="true" className="tempo-beats" style={{ opacity: running ? 1 : 0 }}>
          {[0, 1, 2, 3].map((i) => {
            const b = beatDot(i, u.beat);
            return (
              <span
                key={i}
                className="tempo-beat"
                style={{ width: b.size, height: b.size, background: b.bg, boxShadow: b.glow }}
              />
            );
          })}
        </div>
        {finding && <HitDots n={st.pulse.n} label={st.pulse.n + ' of 8 hits'} />}
        <p aria-live="polite" className="tempo-sub shadow-soft">
          {sub}
        </p>
        <div className="tempo-actions">
          <button
            onClick={() =>
              tr === 'finding' ? ctrl.current?.cancelPulse() : ctrl.current?.findPulse()
            }
            className="tempo-btn tempo-btn--find"
          >
            {tr === 'finding' ? 'Cancel' : 'Find my pulse'}
          </button>
          <button onClick={() => ctrl.current?.tempoStart()} className="tempo-btn tempo-btn--start">
            <span>Start</span>
            <span className="tempo-tri" />
          </button>
        </div>
      </div>
    </div>
  );
}

import { useSyncExternalStore, type RefObject } from 'react';
import { INSTR, type InstKey } from '../resonance/engine';
import type { AppState } from '../resonance/appState';
import { availableInstruments } from '../resonance/appState';
import { HitDots } from '../ui/Dots';
import { StudioDock, StudioTransport } from './StudioTransport';
import { MutedHero, TactileModule, WristbandPopover } from './Tactile';
import type { TactileRefs } from '../resonance/controller';
import type { ScreenProps } from './types';
import './Studio.css';

type Dot = { bs: string; bc: string; bg: string; text: string };
const DOT = {
  on: { bs: 'solid', bc: '#7fe0ec', bg: '#7fe0ec' },
  ring: { bs: 'solid', bc: 'rgba(236,230,216,.6)', bg: 'transparent' },
  wait: { bs: 'dashed', bc: '#ece6d8', bg: 'transparent' },
};
const cd = (k: keyof typeof DOT, text: string): Dot => Object.assign({ text }, DOT[k]);
const BAND_DOT: Record<AppState['bandHw'], Dot> = {
  'not-connected': cd('ring', 'Optional'),
  searching: cd('wait', 'Searching'),
  connecting: cd('wait', 'Connecting'),
  connected: cd('on', 'Connected'),
  lost: cd('ring', 'Reconnect'),
  unavailable: cd('ring', 'Simulated'),
};
const BAND_TITLE: Partial<Record<AppState['bandHw'], string>> = {
  'not-connected':
    'Connect a Resonance wristband over Bluetooth. The on-screen wristband works without it.',
  connected: 'Disconnect the wristband',
  lost: 'Reconnect the wristband',
  unavailable: 'This browser has no Bluetooth. The on-screen wristband is simulated.',
};
const QUANTS: [AppState['quant'], string][] = [
  ['off', 'Off'],
  ['loose', 'Loose'],
  ['balanced', 'Balanced'],
];
const DIM = 'rgba(236,230,216,.62)';

interface Guide {
  eyebrow: string;
  title?: string;
  sub: string;
  retry?: boolean;
  retryText?: string;
  dots?: boolean;
  dotsLabel?: string;
  isCount?: boolean;
  count?: string;
  countC?: string;
}

function StatusDot({ d }: { d: Dot }) {
  return (
    <span
      className="studio-dot"
      style={{ border: '1.5px ' + d.bs + ' ' + d.bc, background: d.bg }}
    />
  );
}

/**
 * Studio: status row, preview, popovers, guide, loop panel, note readout, transport,
 * tactile module and tactile score.
 */
export function Studio({
  st,
  setState,
  ctrl,
  ui,
  stageRef,
  tactile,
}: ScreenProps & { stageRef: RefObject<HTMLDivElement | null>; tactile: TactileRefs }) {
  const u = useSyncExternalStore(ui.subscribe, ui.get);
  const tr = st.transport;
  const busy = tr === 'countin' || tr === 'recording';
  const nL = st.layers.length;
  const hasLoop = nL > 0;
  const mob = st.vw < 700;
  const camHit = st.cam === 'live' && st.track === 'on';
  const recName = st.recInst ? INSTR[st.recInst].name : '';
  const inst = u.inst as InstKey;

  // Guide hero above the field, by transport state.
  let guide: Guide | null = null;
  if (tr === 'ready') {
    guide = {
      eyebrow: 'Build your loop',
      title: 'Start with rhythm.',
      sub: 'Drums come first. Find your pulse to set the tempo for every layer.',
    };
  } else if (tr === 'finding') {
    guide = st.pulse.msg
      ? {
          eyebrow: 'Finding your pulse',
          title: 'That pulse was uneven.',
          sub: 'Keep the hits evenly spaced and try again.',
          retry: true,
          retryText: 'Start over',
        }
      : {
          eyebrow: 'Finding your pulse',
          title: 'Move or trigger 4–8 steady drum hits.',
          sub: camHit
            ? 'Pinch or flick in a steady rhythm.'
            : 'Click the field in a steady rhythm, or press J.',
          dots: true,
          dotsLabel: st.pulse.n + ' of 8 hits',
        };
  } else if (tr === 'found' && !nL) {
    guide = {
      eyebrow: st.viaPulse ? 'Pulse found.' : 'Tempo set.',
      title: st.bpm + ' BPM',
      sub: 'Locked for the whole loop. Record four bars of drums next.',
      retry: true,
      retryText: 'Find again',
    };
  } else if (tr === 'countin') {
    guide = {
      eyebrow: 'Count in · ' + recName,
      isCount: true,
      count: u.count ? String(u.count) : '',
      countC: u.count === 1 ? '#f2bd72' : '#ece6d8',
      sub: u.count ? 'Recording starts on the next downbeat.' : 'Starting on the next bar.',
    };
  }
  const guideOn = !!guide && !st.focus && !st.pick;
  const pickOn = st.pick && !busy && !st.focus;
  const eyeC = tr === 'countin' ? '#f2bd72' : '#7fe0ec';

  const camDot =
    st.cam === 'live'
      ? st.track === 'on'
        ? st.handIn
          ? cd('on', mob ? 'Hand tracked' : 'Tracking')
          : cd('on', 'Ready')
        : st.track === 'loading'
          ? cd('wait', 'Loading')
          : st.track === 'failed'
            ? cd('ring', 'Cursor')
            : cd('on', 'Ready')
      : st.cam === 'pending'
        ? cd('wait', 'Waiting')
        : cd('ring', 'Cursor');
  const camTitle =
    st.cam === 'simulated'
      ? 'Use the camera'
      : st.cam === 'unavailable'
        ? st.camBlocked
          ? 'This preview blocks the camera. Open the standalone file in its own tab.'
          : 'Retry the camera'
        : '';
  const bandDot = BAND_DOT[st.bandHw] || BAND_DOT['not-connected'];
  const pvShow = st.showPreview && !(mob && st.pvMobHidden);
  const camCaption =
    st.cam === 'live'
      ? st.track === 'on'
        ? st.handIn
          ? 'Tracking'
          : 'No hand in view'
        : st.track === 'loading'
          ? 'Loading hand model'
          : 'Tracking unavailable'
      : st.cam === 'unavailable'
        ? 'Cursor control'
        : 'Cursor hand';
  const modeShort =
    inst === 'drums'
      ? camHit
        ? 'Pinch or flick to hit. Height picks kick, snare or hat.'
        : 'Your cursor is the hand. Click to hit; height picks kick, snare or hat.'
      : st.mode === 'demo' || st.cam !== 'live'
        ? st.cam === 'pending'
          ? 'Allow camera access to play with your hand.'
          : 'Your cursor is the hand. Height sets the note, hold to pinch, flick down for an accent.'
        : st.track === 'loading'
          ? 'Loading hand tracking. Your cursor works meanwhile.'
          : st.track === 'on'
            ? st.handIn
              ? 'Height sets the note. Pinch to play. Flick down for an accent.'
              : 'Show your hand to the camera.'
            : 'Your cursor is the hand. Hold to pinch, flick down for an accent.';

  // Loop panel: inline on tall desktop viewports, a popover on short ones,
  // hidden on mobile (it lives in a sheet there).
  const lpMode = mob ? 'none' : st.vh >= 760 ? 'inline' : 'pop';
  const pend = busy
    ? {
        num: String(nL + 1).padStart(2, '0'),
        name: recName,
        col: '#f2bd72',
        dot: tr === 'recording' ? '#f2bd72' : 'transparent',
        text: tr === 'recording' ? 'Bar ' + (u.recBar || 1) + ' / 4' : 'Count in',
      }
    : !nL && st.bpm
      ? { num: '01', name: 'Drums', col: 'rgba(236,230,216,.55)', dot: 'transparent', text: 'Next' }
      : null;

  const closeOthers = { showKeys: false, showA11y: false, showChar: false, showBand: false };
  const toggleA11y = () => setState((x) => ({ ...closeOthers, showA11y: !x.showA11y }));
  const toggleKeys = () => setState((x) => ({ ...closeOthers, showKeys: !x.showKeys }));
  const toggleBand = () => setState((x) => ({ ...closeOthers, showBand: !x.showBand }));
  const heroOn = tr === 'playing' && nL > 0 && st.playMode === 'feel' && !st.focus && !st.pick;
  const toggleChar = () => setState((x) => ({ ...closeOthers, showChar: !x.showChar }));
  const togglePreview = () =>
    mob
      ? setState((x) =>
          x.showPreview && !x.pvMobHidden
            ? { pvMobHidden: true }
            : { showPreview: true, pvMobHidden: false },
        )
      : setState((x) => ({ showPreview: !x.showPreview }));
  const toggleSound = () => {
    const c = ctrl.current;
    if (!c) {
      return;
    }
    if (!st.audioOn) {
      c.ensureAudio();
    } else {
      c.toggleMute();
    }
  };

  const cls = 'studio' + (mob ? ' is-mob' : '') + (st.vw < 1000 ? ' is-narrow' : '');
  return (
    <div className={cls} style={{ opacity: st.focus ? 0.06 : 1 }}>
      <p data-avoid="1" className="studio-hint">
        {modeShort}
      </p>

      <div className="studio-status">
        <div data-avoid="1" className="studio-status-row">
          {/* Pending (camera): useCamera / retry. */}
          <button title={camTitle} className="studio-chip">
            <span className="studio-chip-label">Camera</span>
            <StatusDot d={camDot} />
            <span>{camDot.text}</span>
          </button>
          <button
            onClick={toggleBand}
            aria-expanded={st.showBand}
            title={BAND_TITLE[st.bandHw] || ''}
            aria-live="polite"
            className="studio-chip"
          >
            <span className="studio-chip-label">Wristband</span>
            <StatusDot d={bandDot} />
            <span>{bandDot.text}</span>
          </button>
          <span className="studio-divider" />
          <button
            onClick={togglePreview}
            aria-pressed={st.showPreview}
            className="studio-chip studio-chip--text hv-ink"
            style={{ color: pvShow ? '#ece6d8' : DIM }}
          >
            Preview
          </button>
          <button
            onClick={toggleSound}
            aria-pressed={st.muted}
            className="studio-chip studio-chip--text studio-chip--sound hv-ink"
            style={{ color: st.audioOn && !st.muted ? '#ece6d8' : DIM }}
          >
            <span
              className="studio-sound-dot"
              style={{ background: st.audioOn && !st.muted ? '#7fe0ec' : 'rgba(236,230,216,.3)' }}
            />
            {!st.audioOn ? 'Sound' : st.muted ? 'Muted' : 'Sound'}
          </button>
          <button
            onClick={toggleA11y}
            aria-expanded={st.showA11y}
            className="studio-chip studio-chip--text hv-ink"
            style={{ color: st.showA11y || st.reduced ? '#ece6d8' : DIM }}
          >
            Accessibility
          </button>
          <button
            onClick={toggleKeys}
            aria-expanded={st.showKeys}
            className="studio-chip studio-chip--text hv-ink"
            style={{ color: st.showKeys ? '#ece6d8' : DIM }}
          >
            Help
          </button>
        </div>
        {pvShow && (
          <div data-avoid="1" className="studio-preview">
            {/* Pending (camera): live video + hand skeleton canvas, "No camera" state. */}
            {!camHit && (
              <div
                className="studio-sim-hand"
                style={{
                  left: (u.nx * 100).toFixed(1) + '%',
                  top: (u.ny * 100).toFixed(1) + '%',
                  opacity: u.active ? 1 : 0.35,
                  gap: u.pinch ? '1px' : '10px',
                }}
              >
                <span className="studio-sim-dot" />
                <span className="studio-sim-dot studio-sim-dot--cyan" />
              </div>
            )}
            <span className="studio-preview-caption">{camCaption}</span>
          </div>
        )}
      </div>

      {st.showA11y && (
        <div
          data-avoid="1"
          role="dialog"
          aria-label="Accessibility"
          className="studio-pop studio-pop--a11y"
        >
          <button
            onClick={() => setState((x) => ({ reduced: !x.reduced }))}
            role="switch"
            aria-checked={st.reduced}
            className="studio-switch"
          >
            <span>Reduce motion</span>
            <span
              className="studio-switch-track"
              style={{
                borderColor: st.reduced ? '#7fe0ec' : 'rgba(236,230,216,.3)',
                background: st.reduced ? 'rgba(127,224,236,.2)' : 'transparent',
              }}
            >
              <span
                className="studio-switch-knob"
                style={{
                  left: st.reduced ? '16px' : '2px',
                  background: st.reduced ? '#7fe0ec' : 'rgba(236,230,216,.6)',
                }}
              />
            </span>
          </button>
          <p className="studio-pop-note">
            Calmer sand and smaller waves. Every event still appears on the wristband and the
            tactile score.
          </p>
        </div>
      )}

      {st.showKeys && (
        <div data-avoid="1" role="dialog" aria-label="Help" className="studio-pop studio-pop--keys">
          <span className="studio-key mono">Space</span>
          <span>Play or pause the loop</span>
          <span className="studio-key mono">R</span>
          <span>Next step: pulse, record, add layer</span>
          <span className="studio-key mono">1–4</span>
          <span>Choose an instrument</span>
          <span className="studio-key mono">C</span>
          <span>Audible click on or off</span>
          <span className="studio-key mono">X</span>
          <span>Reset</span>
          <span className="studio-key mono">↑ ↓ ← →</span>
          <span>Move the hand</span>
          <span className="studio-key mono">J</span>
          <span>Pinch or hit (hold to sustain)</span>
          <span className="studio-key mono">A</span>
          <span>Accent</span>
          <span className="studio-key mono">F</span>
          <span>Next Feel mode</span>
          <span className="studio-key mono">M</span>
          <span>Mute</span>
          <span className="studio-key mono">Esc</span>
          <span>Close</span>
        </div>
      )}

      {st.showBand && <WristbandPopover st={st} setState={setState} ctrl={ctrl} dot={bandDot} />}

      {heroOn && <MutedHero />}

      {guideOn && guide && (
        <div className="studio-guide">
          <div data-avoid="soft" aria-live="polite" className="studio-guide-inner">
            <span className="studio-guide-eyebrow mono shadow-soft" style={{ color: eyeC }}>
              {guide.eyebrow}
            </span>
            {guide.isCount && (
              <span className="studio-guide-count serif" style={{ color: guide.countC }}>
                {guide.count}
              </span>
            )}
            {!guide.isCount && (
              <p className="studio-guide-title serif shadow-hero">{guide.title}</p>
            )}
            <span className="studio-guide-sub shadow-soft">{guide.sub}</span>
            {guide.dots && (
              <div className="studio-guide-dots">
                <HitDots n={st.pulse.n} label={guide.dotsLabel || ''} />
              </div>
            )}
            {guide.retry && (
              <button onClick={() => ctrl.current?.findPulse()} className="studio-guide-retry">
                {guide.retryText}
              </button>
            )}
          </div>
        </div>
      )}

      {pickOn && (
        <div className="studio-pick-wrap">
          <div data-avoid="1" role="dialog" aria-label="Add a layer" className="studio-pick">
            <div className="studio-pick-head">
              <span className="studio-pick-title">Add a layer</span>
              <button onClick={() => setState({ pick: false })} className="studio-pick-cancel">
                Cancel
              </button>
            </div>
            <div className="studio-pick-grid">
              {availableInstruments(st.layers).map((k, i) => (
                <button
                  key={k}
                  onClick={() => ctrl.current?.armRecord(k)}
                  className="studio-pick-item hv-cyan"
                >
                  <span className="studio-pick-rule" />
                  <span className="studio-pick-name-row">
                    <span className="studio-pick-name serif">{INSTR[k].name}</span>
                    <span className="studio-pick-num mono">{i + 1}</span>
                  </span>
                  <span className="studio-pick-desc">{INSTR[k].desc}</span>
                </button>
              ))}
            </div>
            <span className="studio-pick-note">
              Your loop keeps playing. One bar count-in, then four bars.
            </span>
          </div>
        </div>
      )}

      {(!!st.bpm || hasLoop) && lpMode !== 'none' && (lpMode === 'inline' || st.loopPop) && (
        <div
          data-avoid="soft"
          aria-label="Your loop"
          className={'studio-loop studio-loop--' + lpMode}
        >
          <div className="studio-loop-head">
            <span className="studio-loop-title">Your loop</span>
            <span className="studio-loop-meta mono">
              {st.bpm ? st.bpm + ' BPM · 4 bars' : '4 bars'}
            </span>
          </div>
          {st.layers.map((l, i) => {
            const active = !!u.act[l.id] && !l.muted;
            const name = INSTR[l.inst].name;
            return (
              <div key={l.id} className="studio-layer-row">
                <span className="studio-loop-num mono">{String(i + 1).padStart(2, '0')}</span>
                <span
                  className="studio-loop-name"
                  style={{ color: l.muted ? 'rgba(236,230,216,.4)' : '#ece6d8' }}
                >
                  {name}
                </span>
                <span
                  className="studio-layer-dot"
                  style={{
                    borderColor: l.muted ? 'rgba(236,230,216,.3)' : '#7fe0ec',
                    background: l.muted
                      ? 'transparent'
                      : active
                        ? '#7fe0ec'
                        : 'rgba(127,224,236,.3)',
                    boxShadow: active ? '0 0 8px rgba(127,224,236,.9)' : 'none',
                  }}
                />
                <button
                  onClick={() => ctrl.current?.muteLayer(l.id)}
                  aria-pressed={l.muted}
                  disabled={busy}
                  className="studio-layer-mute hv-ink"
                  style={{
                    color: l.muted ? '#7fe0ec' : 'rgba(236,230,216,.6)',
                    opacity: busy ? 0.35 : 1,
                  }}
                >
                  {l.muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={() => ctrl.current?.deleteLayer(l.id)}
                  disabled={busy}
                  aria-label={'Delete ' + name}
                  className="studio-layer-del hv-amber"
                  style={{ opacity: busy ? 0.35 : 1 }}
                >
                  ×
                </button>
              </div>
            );
          })}
          {pend && (
            <div className="studio-loop-row">
              <span className="studio-loop-num mono">{pend.num}</span>
              <span className="studio-loop-name" style={{ color: pend.col }}>
                {pend.name}
              </span>
              <span className="studio-loop-state mono" style={{ color: pend.col }}>
                <span
                  className="studio-loop-dot"
                  style={{ borderColor: pend.col, background: pend.dot }}
                />
                {pend.text}
              </span>
            </div>
          )}
          {nL === 4 && !busy && (
            <span className="studio-loop-complete serif">Composition complete.</span>
          )}
        </div>
      )}

      <div className="studio-bottom">
        <div className="studio-bottom-row">
          {mob && <div ref={stageRef} aria-hidden="true" className="studio-stage" />}
          <div data-avoid="soft" className="studio-note">
            <div aria-hidden="true" className="studio-ladder">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  style={{
                    width: i === u.slot ? '18px' : '8px',
                    background: i === u.slot ? '#7fe0ec' : 'rgba(236,230,216,.28)',
                  }}
                />
              ))}
            </div>
            <span
              aria-live="polite"
              className="studio-note-name serif"
              style={{ color: u.flash > 0.35 ? '#7fe0ec' : '#ece6d8' }}
            >
              {u.name}
            </span>
            <div className="studio-note-info">
              <span className="studio-note-line">
                <span>
                  {inst === 'drums' ? 'Zone' : 'Degree'}{' '}
                  <span className="studio-note-deg mono">{u.deg}</span>
                </span>
                <span className="studio-energy">
                  Energy
                  <span className="studio-energy-track">
                    <span
                      className="studio-energy-fill"
                      style={{ width: (Math.min(1, u.energy) * 100).toFixed(0) + '%' }}
                    />
                  </span>
                </span>
              </span>
              <span className="studio-keyspec mono">
                {(INSTR[inst] ? INSTR[inst].name : '') + (st.bpm ? ' · ' + st.bpm + ' BPM' : '')}
              </span>
              <div className="studio-timing">
                <button
                  onClick={toggleChar}
                  disabled={busy}
                  aria-expanded={st.showChar}
                  className="studio-timing-btn"
                  style={{ opacity: busy ? 0.4 : 1 }}
                >
                  <span className="studio-timing-label">Timing</span>
                  <span
                    className="studio-chev"
                    style={{
                      transform: st.showChar
                        ? 'translateY(2px) rotate(-135deg)'
                        : 'translateY(-2px) rotate(45deg)',
                    }}
                  />
                </button>
                {st.showChar && (
                  <div
                    data-avoid="1"
                    role="dialog"
                    aria-label="Timing"
                    className="studio-timing-pop"
                  >
                    <div className="studio-timing-row">
                      <span>Tempo</span>
                      <span className="studio-timing-val mono">
                        {st.bpm ? st.bpm + ' BPM' + (st.viaPulse ? ' · your pulse' : '') : '—'}
                      </span>
                    </div>
                    <div className="studio-timing-row studio-timing-row--last">
                      <span>Tighten timing</span>
                      <span className="studio-quants">
                        {QUANTS.map(([k, l]) => {
                          const on = st.quant === k;
                          return (
                            <button
                              key={k}
                              onClick={() => setState({ quant: k })}
                              aria-pressed={on}
                              className="studio-quant"
                              style={{
                                borderBottomColor: on ? '#7fe0ec' : 'transparent',
                                color: on ? '#ece6d8' : 'rgba(236,230,216,.5)',
                              }}
                            >
                              {l}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <TactileModule st={st} ctrl={ctrl} tactile={tactile} />
        </div>
        <StudioTransport st={st} setState={setState} ctrl={ctrl} u={u} tactile={tactile} />
      </div>

      {/* Pending (mobile): tactile sheet, layers sheet. */}
      {mob && <StudioDock st={st} setState={setState} ctrl={ctrl} u={u} />}
    </div>
  );
}

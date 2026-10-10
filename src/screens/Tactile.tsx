import type { RefObject } from 'react';
import type { AppState, Feel, StatePatch } from '../resonance/appState';
import type { ResonanceController, TactileRefs } from '../resonance/controller';
import { INSTR } from '../resonance/engine';
import { LEGEND_SHAPE, scoreGeometry } from './scoreGeometry';
import './Tactile.css';

type Ctrl = RefObject<ResonanceController | null>;

const FEELS: [Feel, string][] = [
  ['full', 'Full'],
  ['rhythm', 'Pulse'],
  ['expression', 'Expression'],
  ['off', 'Off'],
];

/** Lane label opacity: dimmed when Feel mode excludes that motor. */
function laneOps(st: AppState) {
  const off = st.feel === 'off';
  return {
    pulse: !off && (st.feel === 'full' || st.feel === 'rhythm') ? 1 : 0.3,
    expr: !off && (st.feel === 'full' || st.feel === 'expression') ? 1 : 0.3,
  };
}

/** Desktop tactile module: simulated wristband, motor-edge glow, Feel modes (v7). */
export function TactileModule({
  st,
  ctrl,
  tactile: { box, edgeL, edgeR, wrist },
}: {
  st: AppState;
  ctrl: Ctrl;
  tactile: TactileRefs;
}) {
  const tr = st.transport;
  const busy = tr === 'countin' || tr === 'recording';
  const hasLoop = st.layers.length > 0;
  const role = busy
    ? ' · Keeping time'
    : (tr === 'playing' || tr === 'paused') && hasLoop
      ? ' · Composition'
      : '';
  const lanes = laneOps(st);

  return (
    <div ref={box} data-avoid="1" className="tact">
      <span ref={edgeL} aria-hidden="true" className="tact-edge tact-edge--pulse" />
      <span ref={edgeR} aria-hidden="true" className="tact-edge tact-edge--expr" />
      <span className="tact-title">
        Tactile<span style={{ color: busy ? '#f2bd72' : '#7fe0ec' }}>{role}</span>
      </span>
      <div className="tact-band">
        <canvas
          ref={wrist}
          aria-label="Simulated wristband: Pulse motor on the left, Expression motor on the right"
          className="tact-canvas"
        />
        <span className="tact-lane tact-lane--pulse" style={{ opacity: lanes.pulse }}>
          Pulse
        </span>
        <span className="tact-lane tact-lane--expr" style={{ opacity: lanes.expr }}>
          Expression
        </span>
      </div>
      <div role="radiogroup" aria-label="Tactile mode" className="tact-feels">
        {FEELS.map(([k, label]) => {
          const on = st.feel === k;
          return (
            <button
              key={k}
              role="radio"
              aria-checked={on}
              onClick={() => ctrl.current?.setFeel(k)}
              className="tact-feel hv-ink"
              style={{ color: on ? '#ece6d8' : 'rgba(236,230,216,.4)' }}
            >
              {label}
              <span className="tact-feel-mark" style={{ width: on ? '100%' : '0px' }} />
            </button>
          );
        })}
      </div>
      <span aria-live="polite" className="tact-msg" style={{ opacity: st.feelMsgOn ? 1 : 0 }}>
        {st.feelMsg}
      </span>
    </div>
  );
}

/** Tactile score: Pulse and Expression lanes across the four bars, with legend and playhead. */
export function TactileScore({
  st,
  tactile: { score, playhead },
}: {
  st: AppState;
  tactile: TactileRefs;
}) {
  const g = scoreGeometry(st.score, st);
  const lanes = laneOps(st);
  return (
    <div className="ts-wrap">
      <div
        aria-label="Tactile score: Pulse lane and Expression lane across four bars"
        className="ts"
      >
        <span className="ts-title">Tactile score</span>
        <div className="ts-bars">
          {g.bars.map((b) => (
            <span key={b.n} className="ts-bar-n mono" style={{ left: b.left }}>
              {b.n}
            </span>
          ))}
          {/* Pending: Tactile memory (not part of this milestone). */}
        </div>
        <div className="ts-lanes">
          <span style={{ opacity: lanes.pulse }}>Pulse</span>
          <span className="ts-lane-expr" style={{ opacity: lanes.expr }}>
            Expression
          </span>
        </div>
        <div ref={score} className="ts-field">
          <span className="ts-rule ts-rule--pulse" />
          <span className="ts-rule ts-rule--expr" />
          {g.bars.map((b) => (
            <span key={b.n} className="ts-bar-line" style={{ left: b.left }} />
          ))}
          {g.pulse.map((p) => (
            <span
              key={p.id}
              data-ev={p.id}
              className="ts-pulse"
              style={{
                left: p.left,
                width: p.size,
                height: p.size,
                marginLeft: p.margin,
                marginTop: p.margin,
                background: p.bg,
                opacity: p.op,
              }}
            />
          ))}
          {g.expr.map((x) => (
            <span
              key={x.id}
              data-ev={x.id}
              className={'ts-expr' + (x.glow ? ' ts-expr--glow' : '')}
              style={{
                top: x.top,
                left: x.left,
                width: x.w,
                height: x.h,
                marginLeft: x.ml,
                marginTop: x.mt,
                borderRadius: x.r,
                clipPath: x.clip,
                opacity: x.op,
              }}
            />
          ))}
          {g.hits.map((h) => (
            <span
              key={h.id}
              data-ev={h.id}
              className="ts-hit"
              style={{ left: h.left, opacity: h.op }}
            >
              <span className="ts-hit-dot ts-hit-dot--top" />
              <span className="ts-hit-dot ts-hit-dot--bottom" />
            </span>
          ))}
          <span ref={playhead} className="ts-playhead" />
        </div>
        <span />
        <div className="ts-legend">
          {st.score.legend.map((l, i) => {
            const sh = LEGEND_SHAPE[l.inst];
            return (
              <span
                key={l.inst + i}
                className="ts-legend-item"
                style={{ opacity: l.muted ? 0.35 : l.rec ? 0.7 : 1 }}
              >
                <span
                  style={{
                    width: sh.w,
                    height: sh.h,
                    borderRadius: sh.r,
                    clipPath: sh.clip,
                    background: sh.bg,
                  }}
                />
                {INSTR[l.inst].name}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const PLAY_LABELS: [AppState['playMode'], string][] = [
  ['both', 'Hear + Feel'],
  ['feel', 'Feel only'],
  ['hear', 'Hear only'],
];

/** Hear + Feel / Feel only / Hear only (shown once a loop exists and nothing is recording). */
export function PlaybackModes({ st, ctrl }: { st: AppState; ctrl: Ctrl }) {
  const tr = st.transport;
  const busy = tr === 'countin' || tr === 'recording';
  const hasLoop = st.layers.length > 0;
  if (!hasLoop || busy) {
    return null;
  }
  return (
    <div role="radiogroup" aria-label="Playback" className="pm">
      {PLAY_LABELS.map(([k, label]) => {
        const on = st.playMode === k;
        return (
          <button
            key={k}
            role="radio"
            aria-checked={on}
            onClick={() => ctrl.current?.setPlayMode(k)}
            className="pm-btn"
            style={{
              background: on ? (k === 'feel' ? '#7fe0ec' : '#ece6d8') : 'transparent',
              color: on ? '#0a0b0d' : 'rgba(236,230,216,.78)',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Shown while a loop plays in Feel only mode. */
export function MutedHero() {
  return (
    <div className="studio-guide">
      <p data-avoid="soft" className="muted-hero serif shadow-hero">
        The sound is muted. <em>The musical structure remains.</em>
      </p>
    </div>
  );
}

type Dot = { bs: string; bc: string; bg: string; text: string };

const BAND_NOTE: Record<AppState['bandHw'], string> = {
  'not-connected':
    'Optional. The on-screen wristband shows both motors without hardware. Connect to feel Pulse and Expression on your wrist.',
  searching: 'Choose Resonance Wristband in the browser dialog.',
  connecting: 'Connecting to Resonance Wristband.',
  connected: 'Pulse and Expression are playing on your wrist. Feel modes filter what is sent.',
  lost: 'The connection dropped. Both motors stopped.',
  unavailable:
    'Bluetooth wristband unavailable in this browser. The on-screen wristband, tactile score and everything else keep working.',
};

/** Wristband popover: Bluetooth connect / disconnect and the hardware test (v7). */
export function WristbandPopover({
  st,
  setState,
  ctrl,
  dot,
}: {
  st: AppState;
  setState: (patch: StatePatch) => void;
  ctrl: Ctrl;
  dot: Dot;
}) {
  const hw = st.bandHw;
  const busy = hw === 'searching' || hw === 'connecting';
  const connected = hw === 'connected';
  const btnText =
    {
      connected: 'Disconnect',
      lost: 'Reconnect',
      searching: 'Searching…',
      connecting: 'Connecting…',
    }[hw as string] || 'Connect wristband';
  const act = () => {
    const c = ctrl.current;
    if (!c) {
      return;
    }
    if (connected) {
      c.disconnectBand();
    } else if (hw === 'not-connected' || hw === 'lost') {
      c.connectBand();
    }
  };

  return (
    <div data-avoid="1" role="dialog" aria-label="Wristband" className="studio-pop band-pop">
      <div className="band-head">
        <span className="band-title serif">Wristband</span>
        <span className="band-state">
          <span
            className="studio-dot"
            style={{ border: '1.5px ' + dot.bs + ' ' + dot.bc, background: dot.bg }}
          />
          {dot.text}
        </span>
      </div>
      <p className="band-note">{BAND_NOTE[hw] || ''}</p>
      {hw !== 'unavailable' && (
        <button
          onClick={act}
          disabled={busy}
          className="band-btn"
          style={{
            borderColor: connected ? 'rgba(236,230,216,.3)' : '#ece6d8',
            background: connected ? 'transparent' : '#ece6d8',
            color: connected ? '#ece6d8' : '#0a0b0d',
            opacity: busy ? 0.5 : 1,
          }}
        >
          {btnText}
        </button>
      )}
      <button
        onClick={() => setState((x) => ({ hwTest: !x.hwTest }))}
        aria-expanded={st.hwTest}
        className="band-test-toggle"
      >
        {st.hwTest ? 'Hide hardware test' : 'Hardware test'}
      </button>
      {st.hwTest && (
        <div className="band-test">
          <div className="band-levels">
            <span>Intensity</span>
            <span className="band-level-group">
              {(
                [
                  ['low', 'Low'],
                  ['med', 'Medium'],
                  ['high', 'High'],
                ] as const
              ).map(([k, label]) => {
                const on = st.hwLevel === k;
                return (
                  <button
                    key={k}
                    onClick={() => setState({ hwLevel: k })}
                    aria-pressed={on}
                    className="band-level"
                    style={{
                      color: on ? '#ece6d8' : 'rgba(236,230,216,.5)',
                      borderBottomColor: on ? '#7fe0ec' : 'transparent',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </span>
          </div>
          <div className="band-fire">
            <button onClick={() => ctrl.current?.hwTestFire(['rhythm'])} className="band-fire-btn">
              Pulse
            </button>
            <button
              onClick={() => ctrl.current?.hwTestFire(['expression'])}
              className="band-fire-btn band-fire-btn--expr"
            >
              Expression
            </button>
            <button
              onClick={() => ctrl.current?.hwTestFire(['rhythm', 'expression'])}
              className="band-fire-btn"
            >
              Both
            </button>
          </div>
          <span className="band-last mono">{st.hwLast}</span>
        </div>
      )}
    </div>
  );
}

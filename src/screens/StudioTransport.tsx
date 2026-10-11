import type { RefObject } from 'react';
import type { AppState, StatePatch, Ui } from '../core/appState';
import type { ResonanceController, TactileRefs } from '../core/controller';
import { beatDot } from '../ui/beats';
import { PlaybackModes, TactileScore } from './Tactile';
import { transportView, type StatusLook } from './transportView';
import './StudioTransport.css';

interface TransportProps {
  st: AppState;
  setState: (patch: StatePatch) => void;
  ctrl: RefObject<ResonanceController | null>;
  u: Ui;
  /** Present on desktop, where the tactile score sits under the transport. */
  tactile?: TactileRefs;
}

const DIM = 'rgba(236,230,216,.62)';

function StatusIcon({ status, size }: { status: StatusLook; size: number }) {
  return (
    <span
      className="tp-status-icon"
      style={{
        width: size,
        height: size,
        borderRadius: status.radius,
        background: status.bg,
        border: status.border,
        clipPath: status.clip,
      }}
    />
  );
}

/** Desktop transport row: status, beats 1–4, Record / Play / Click / Loop / Reset. */
export function StudioTransport({ st, setState, ctrl, u, tactile }: TransportProps) {
  const v = transportView(st, u);
  const loopPopMode = st.vh < 760;

  return (
    <div data-avoid="soft" className="tp">
      <div className="tp-row">
        <div className="tp-main">
          <div aria-live="polite" className="tp-status">
            <span className="tp-status-label" style={{ color: v.status.col }}>
              <StatusIcon status={v.status} size={9} />
              {v.status.label}
            </span>
            <span className="tp-status-bar mono">
              {v.status.bar}
              <span className="tp-timer">{u.timer}</span>
            </span>
          </div>

          {v.beatsOn && (
            <div aria-hidden="true" className="tp-beats">
              {[0, 1, 2, 3].map((i) => {
                const b = beatDot(i, u.beat);
                return (
                  <span key={i} className="tp-beat">
                    <span
                      className="tp-beat-dot"
                      style={{ width: b.size, height: b.size, background: b.bg, boxShadow: b.glow }}
                    />
                    <span className="tp-beat-num mono" style={{ color: b.col }}>
                      {b.n}
                    </span>
                  </span>
                );
              })}
            </div>
          )}

          <div role="group" aria-label="Transport" className="tp-group">
            <RecordButton v={v} ctrl={ctrl} className="tp-rec" />
            <PlayButton v={v} ctrl={ctrl} className="tp-play" />
            <button
              onClick={() => ctrl.current?.toggleClick()}
              disabled={!st.bpm}
              aria-pressed={st.clickOn}
              title="Audible metronome during count-in and recording"
              className="tp-click hv-ink"
              style={{ color: st.clickOn ? '#ece6d8' : DIM, opacity: st.bpm ? 1 : 0.38 }}
            >
              <span
                className="tp-click-dot"
                style={{ background: st.clickOn ? '#7fe0ec' : 'rgba(236,230,216,.3)' }}
              />
              {st.clickOn ? 'Click on' : 'Click off'}
            </button>
            {loopPopMode && (
              <button
                onClick={() =>
                  setState((x) => ({
                    loopPop: !x.loopPop,
                    showBand: false,
                    showKeys: false,
                    showA11y: false,
                  }))
                }
                disabled={!st.bpm}
                aria-expanded={st.loopPop}
                className="tp-loop"
                style={{ opacity: st.bpm ? 1 : 0.38 }}
              >
                Loop · {v.nL}
              </button>
            )}
            <button
              onClick={() => ctrl.current?.reset()}
              disabled={v.resetDis}
              className="tp-reset"
              style={{ opacity: v.resetDis ? 0.38 : 1 }}
            >
              Reset
            </button>
          </div>
        </div>
        <PlaybackModes st={st} ctrl={ctrl} />
      </div>
      {tactile && <TactileScore st={st} setState={setState} tactile={tactile} />}
    </div>
  );
}

/** Mobile performance dock: status, beats, Record / Play / Reset. */
export function StudioDock({ st, ctrl, u }: TransportProps) {
  const v = transportView(st, u);
  return (
    <div data-avoid="1" className="tp-dock">
      <div className="tp-dock-top">
        <div aria-live="polite" className="tp-dock-status">
          <span className="tp-dock-label" style={{ color: v.status.col }}>
            <StatusIcon status={v.status} size={8} />
            {v.status.label}
          </span>
          <span className="tp-dock-bar mono">
            {v.status.bar}
            {v.beatsOn && (
              <span aria-hidden="true" className="tp-dock-beats">
                {[0, 1, 2, 3].map((i) => {
                  const b = beatDot(i, u.beat);
                  return (
                    <span
                      key={i}
                      className="tp-beat-dot"
                      style={{ width: b.size, height: b.size, background: b.bg, boxShadow: b.glow }}
                    />
                  );
                })}
              </span>
            )}
          </span>
        </div>
        {/* Pending (Milestone 3+): Tactile button that opens the tactile sheet. */}
      </div>
      <div role="group" aria-label="Transport" className="tp-dock-group">
        <RecordButton v={v} ctrl={ctrl} className="tp-dock-rec" />
        <PlayButton v={v} ctrl={ctrl} className="tp-dock-play" />
        {/* Pending: "Loop · n" button that opens the layers sheet. */}
        <button
          onClick={() => ctrl.current?.reset()}
          disabled={v.resetDis}
          aria-label="Reset"
          className="tp-dock-reset"
          style={{ opacity: v.resetDis ? 0.38 : 1 }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

type View = ReturnType<typeof transportView>;
type Ctrl = RefObject<ResonanceController | null>;

function RecordButton({ v, ctrl, className }: { v: View; ctrl: Ctrl; className: string }) {
  return (
    <button
      onClick={() => ctrl.current?.primary()}
      disabled={v.primDis}
      className={className}
      style={{
        background: v.busy ? '#f2bd72' : 'rgba(242,189,114,.08)',
        color: v.busy ? '#0a0b0d' : '#ece6d8',
        opacity: v.primDis ? 0.38 : 1,
      }}
    >
      <span className="tp-rec-dot" style={{ background: v.busy ? '#0a0b0d' : '#f2bd72' }} />
      {v.primText}
    </button>
  );
}

function PlayButton({ v, ctrl, className }: { v: View; ctrl: Ctrl; className: string }) {
  return (
    <button
      onClick={() => ctrl.current?.togglePlay()}
      disabled={!v.canPlay}
      className={className}
      style={{ opacity: v.canPlay ? 1 : 0.38 }}
    >
      <span
        className="tp-play-icon"
        style={{
          borderRadius: v.running ? '1px' : '0',
          clipPath: v.running ? 'none' : 'polygon(0 0,100% 50%,0 100%)',
        }}
      />
      {v.running ? 'Pause' : 'Play'}
    </button>
  );
}

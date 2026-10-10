import { useSyncExternalStore } from 'react';
import type { ScreenProps } from './types';
import './Tutorial.css';

const TUT = [
  'Raise your hand to change notes.',
  'Pinch to play.',
  'Move more to play stronger.',
  'Flick down for an accent.',
];
const TUT_HINT = [
  'Move the cursor up and down the field. Six heights give six notes of the scale, so every note fits.',
  'Click and hold anywhere in the field. A quick click plays a short note; holding sustains it.',
  'Fast, wide movement makes the sound brighter, the sand wilder and the expression pulses stronger. Slow movement keeps it soft.',
  'Flick the cursor sharply downward, or press A. It sends a big wave and fires Pulse and Expression together.',
];
const TUT_HINT_CAM = [
  'Raise and lower your open hand in front of the camera. Six heights give six notes of the scale.',
  'Touch your thumb to your index finger. A quick pinch plays a short note; holding it sustains the note.',
  'Move your hand faster and wider to play stronger. Hold up both hands and spread them apart to open up the sound.',
  'Flick your hand down quickly. It sends a big wave and fires Pulse and Expression together.',
];

/**
 * Four-step gesture tutorial.
 * The ghost hand on the canvas demonstrates each step (controller.step).
 */
export function Tutorial({ st, setState, ui }: ScreenProps) {
  const u = useSyncExternalStore(ui.subscribe, ui.get);
  const step = st.step;
  const hints = st.track === 'on' && st.cam === 'live' ? TUT_HINT_CAM : TUT_HINT;
  const pinchGap = u.pinch ? '1px' : '10px';

  return (
    <div className="tut-wrap">
      <div data-avoid="1" role="dialog" aria-label="Gesture tutorial" className="tut">
        <div className="tut-head">
          <span className="tut-count mono">Gesture {step + 1} of 4</span>
          <div className="tut-segs">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="tut-seg"
                style={{ background: i <= step ? '#ece6d8' : 'rgba(236,230,216,.2)' }}
              />
            ))}
          </div>
        </div>
        <div className="tut-body">
          <div className="tut-icon">
            {step === 0 && (
              <>
                <span className="tut-rail" />
                <span className="tut-rail-dot" style={{ top: 14 + (1 - u.slot / 5) * 40 + 'px' }} />
              </>
            )}
            {step === 1 && (
              <div className="tut-pinch" style={{ gap: pinchGap }}>
                <span className="tut-pinch-dot" />
                <span className="tut-pinch-dot tut-pinch-dot--cyan" />
              </div>
            )}
            {step === 2 && (
              <div className="tut-bars">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="tut-bar"
                    style={{
                      height: 6 + i * 5 + 'px',
                      background: u.energy > i / 5 + 0.02 ? '#7fe0ec' : 'rgba(236,230,216,.2)',
                    }}
                  />
                ))}
              </div>
            )}
            {step === 3 && (
              <>
                <span
                  className="tut-hap-ring"
                  style={{
                    opacity: Math.min(1, u.hap).toFixed(3),
                    transform: 'scale(' + (1 + u.hap * 0.55).toFixed(3) + ')',
                  }}
                />
                <span className="tut-hap-dot" />
              </>
            )}
          </div>
          <div className="tut-text">
            <h2 className="tut-title serif">{TUT[step]}</h2>
            <p className="tut-hint">{hints[step]}</p>
            {step === 0 && (
              <p className="tut-now mono">
                Now · {u.name} · degree {u.deg}
              </p>
            )}
          </div>
        </div>
        <div className="tut-foot">
          <button onClick={() => setState({ screen: 'tempo' })} className="tut-skip">
            Skip tutorial
          </button>
          <div className="tut-nav">
            <button
              onClick={() => setState({ step: Math.max(0, step - 1) })}
              disabled={step === 0}
              className="tut-back"
              style={{ opacity: step === 0 ? 0.35 : 1 }}
            >
              Back
            </button>
            <button
              onClick={() =>
                step === 3 ? setState({ screen: 'tempo' }) : setState({ step: step + 1 })
              }
              className="tut-next"
            >
              {step === 3 ? 'Set your tempo' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

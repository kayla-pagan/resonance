import { useSyncExternalStore } from 'react';
import type { ScreenProps } from './types';
import './Tutorial.css';

const TUT = [
  'Height chooses the sound.',
  'Pinch to play.',
  'Move more to play stronger.',
  'Feel the beat, then the music.',
];
/** The tactile step reads the same for cursor and camera. */
const TACTILE_HINT =
  'While you count in and record, both motors pulse the beat together to keep you in time. On playback, one motor carries the Drums and the other the Bass.';
const TUT_HINT = [
  'Move the cursor up and down the field. Six heights give six notes of the scale, so every note fits. On drums, height picks kick, snare or hat.',
  'Click and hold anywhere in the field. A quick click plays a short note; holding sustains it.',
  'Fast, wide movement makes the sound brighter, the sand wilder and the touch stronger. Slow movement keeps it soft.',
  TACTILE_HINT,
];
const TUT_HINT_CAM = [
  'Raise and lower your open hand in front of the camera. Six heights give six notes of the scale. On drums, height picks kick, snare or hat.',
  'Touch your thumb to your index finger. A quick pinch plays a short note; holding it sustains the note.',
  'Move your hand faster and wider to play stronger. Hold up both hands and spread them apart to open up the sound.',
  TACTILE_HINT,
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
          <span className="tut-count mono">Step {step + 1} of 4</span>
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
              <div className="tut-motors" aria-hidden="true">
                <span className="tut-motor" />
                <span className="tut-motor tut-motor--r" />
              </div>
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
            {step === 3 && (
              <p className="tut-note">
                This prototype uses two tactile channels. Future wristbands could use additional
                motors to separate more musical layers.
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

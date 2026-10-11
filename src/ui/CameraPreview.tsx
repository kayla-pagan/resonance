import type { RefObject } from 'react';
import type { AppState, Ui } from '../core/appState';
import './CameraPreview.css';

/**
 * Camera preview: the mirrored camera image with the tracked hand skeleton drawn over it (thumb
 * and index tips highlighted), or the cursor "hand" when the camera isn't tracking, plus a
 * status caption. Shared by the Tutorial and the Studio. The controller feeds the <video> and
 * draws the overlay; tracking runs whether or not this preview is mounted.
 */
export function CameraPreview({
  st,
  u,
  videoRef,
  overlayRef,
  className = '',
}: {
  st: AppState;
  u: Ui;
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  className?: string;
}) {
  const camHit = st.cam === 'live' && st.track === 'on';
  const caption =
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
  return (
    <div data-avoid="1" className={'cam-preview ' + className}>
      {st.cam === 'live' && (
        <>
          <video ref={videoRef} autoPlay muted playsInline className="cam-preview-video" />
          <canvas ref={overlayRef} className="cam-preview-overlay" />
        </>
      )}
      {st.cam === 'unavailable' && <span className="cam-preview-none">No camera</span>}
      {!camHit && (
        <div
          className="cam-preview-sim"
          style={{
            left: (u.nx * 100).toFixed(1) + '%',
            top: (u.ny * 100).toFixed(1) + '%',
            opacity: u.active ? 1 : 0.35,
            gap: u.pinch ? '1px' : '10px',
          }}
        >
          <span className="cam-preview-sim-dot" />
          <span className="cam-preview-sim-dot cam-preview-sim-dot--cyan" />
        </div>
      )}
      <span className="cam-preview-caption">{caption}</span>
    </div>
  );
}

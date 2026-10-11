import { createRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  initialState,
  PROTOTYPE_PROPS,
  UiStore,
  type AppState,
  type StatePatch,
} from './core/appState';
import { ResonanceController, type ControllerHost, type TactileRefs } from './core/controller';
import { Landing } from './screens/Landing';
import { Tutorial } from './screens/Tutorial';
import { TempoSetup } from './screens/TempoSetup';
import { Studio } from './screens/Studio';
import './App.css';

/**
 * React owns screens, UI and application state. The ResonanceController owns the canvas,
 * the frame loop and everything per-frame; it reads state through a ref and writes back
 * through setState, mirroring the prototype's class component.
 */
export default function App() {
  const [st, setSt] = useState<AppState>(initialState);
  const [ui] = useState(() => new UiStore());
  const stateRef = useRef(st);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const ctrl = useRef<ResonanceController | null>(null);
  // DOM the controller updates every frame: wristband canvas, module edges, score playhead/marks.
  const [tactile] = useState<TactileRefs>(() => ({
    wrist: createRef<HTMLCanvasElement>(),
    box: createRef<HTMLDivElement>(),
    edgeL: createRef<HTMLSpanElement>(),
    edgeR: createRef<HTMLSpanElement>(),
    playhead: createRef<HTMLSpanElement>(),
    score: createRef<HTMLDivElement>(),
  }));
  // Camera preview: mirrored video + hand skeleton overlay (tracking runs without them).
  const [cam] = useState<ControllerHost['cam']>(() => ({
    video: createRef<HTMLVideoElement>(),
    overlay: createRef<HTMLCanvasElement>(),
  }));

  // Class-style merge, like the prototype's this.setState.
  const setState = useCallback((patch: StatePatch) => {
    setSt((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  }, []);

  useLayoutEffect(() => {
    stateRef.current = st;
  });

  useEffect(() => {
    const c = new ResonanceController({
      getState: () => stateRef.current,
      setState,
      ui,
      props: PROTOTYPE_PROPS,
      rootRef,
      canvasRef,
      stageRef,
      tactile,
      cam,
    });
    ctrl.current = c;
    return () => {
      c.destroy();
      ctrl.current = null;
    };
  }, [setState, ui, tactile, cam]);

  useEffect(() => {
    ctrl.current?.didUpdate(st);
  }, [st]);

  // "Enter the studio" asks for the camera (this click is the permission gesture); if it is
  // refused or unavailable, cursor control simply continues. Demo mode never asks.
  const enterStudio = () => {
    setState({ mode: 'live', screen: 'tutorial', step: 0, cam: 'pending', showPreview: true });
    ctrl.current?.requestCamera();
  };
  const enterDemo = () => setState({ mode: 'demo', screen: 'tutorial', step: 0, cam: 'simulated' });

  const screenProps = { st, setState, ctrl, ui };
  return (
    <div ref={rootRef} className="app" onPointerMove={(e) => ctrl.current?.onMove(e)}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => ctrl.current?.onDown(e)}
        aria-label="Particle field. Move to shape the current; press and hold to pinch."
        className="app-field"
      />
      <div data-avoid="1" className="app-brand">
        <span>Resonance</span>
      </div>
      {st.screen === 'welcome' && <Landing onEnterStudio={enterStudio} onEnterDemo={enterDemo} />}
      {st.screen === 'tutorial' && <Tutorial {...screenProps} cam={cam} />}
      {st.screen === 'tempo' && <TempoSetup {...screenProps} cam={cam} />}
      {st.screen === 'studio' && (
        <Studio {...screenProps} stageRef={stageRef} tactile={tactile} cam={cam} />
      )}
    </div>
  );
}

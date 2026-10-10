import type { RefObject } from 'react';
import type { AppState, StatePatch, UiStore } from '../resonance/appState';
import type { ResonanceController } from '../resonance/controller';

export interface ScreenProps {
  st: AppState;
  setState: (patch: StatePatch) => void;
  ctrl: RefObject<ResonanceController | null>;
  ui: UiStore;
}

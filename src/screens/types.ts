import type { RefObject } from 'react';
import type { AppState, StatePatch, UiStore } from '../core/appState';
import type { ResonanceController } from '../core/controller';

export interface ScreenProps {
  st: AppState;
  setState: (patch: StatePatch) => void;
  ctrl: RefObject<ResonanceController | null>;
  ui: UiStore;
}

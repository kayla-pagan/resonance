import * as Tone from 'tone';
import type { MusicEvent, Score } from './engine';

/** Sixteenth-note steps in the 4-bar master loop (4 bars × 16). */
export const LOOP_STEPS = 64;
/** Sixteenth-note steps in one bar of 4/4. */
export const BAR_STEPS = 16;

export interface TransportHandlers {
  /**
   * Called once per sixteenth, before that step's events are dispatched.
   * `abs` is the absolute step since the transport started; recording boundaries live here.
   */
  onStep(abs: number, time: number): void;
  /** Called for every loop event that falls in the step, at its exact audio time. */
  onEvent(ev: MusicEvent, time: number): void;
}

/**
 * The one musical clock.
 *
 * Tone's Transport is the authoritative timeline. A single `scheduleRepeat` at 16th-note
 * resolution reads the transport position at each step and dispatches the loop events whose
 * loop-relative time falls in that step, scheduled at `stepTime + offset`. Everything —
 * metronome, recording boundaries, drums, bass, visuals — derives from transport ticks, so
 * nothing can drift relative to anything else.
 *
 * The transport itself does not loop. Loop position is derived:
 *   loopStep = (absStep − origin) mod 64
 * where `origin` is the absolute step on which loop bar 1 begins.
 */
export class MasterTransport {
  /** Absolute step on which loop bar 1 begins. */
  origin = 0;
  bpm = 100;
  /** Increments on every start(); a run is one continuous stretch of transport time. */
  run = 0;

  private readonly T = Tone.getTransport();
  private readonly handlers: TransportHandlers;
  private repeatId: number | null = null;
  private isRunning = false;
  /** Audio time at which the current run's step 0 sounds. */
  private startTime = 0;
  /** Dev diagnostics: ticks from an aborted run that were ignored. */
  staleTicks = 0;
  private buckets: MusicEvent[][] = emptyBuckets();

  constructor(handlers: TransportHandlers) {
    this.handlers = handlers;
    this.repeatId = this.T.scheduleRepeat(this.tick, '16n', 0);
  }

  /** Seconds per sixteenth at the current BPM. */
  get s16() {
    return 60 / this.bpm / 4;
  }

  /** Length of the 4-bar loop in seconds. */
  get len() {
    return this.s16 * LOOP_STEPS;
  }

  get running() {
    return this.isRunning;
  }

  /** Restarts the transport from step 0 at `bpm`, with loop bar 1 at absolute step `origin`. */
  start(bpm: number, origin = 0) {
    const t = Tone.now();
    this.T.stop(t);
    this.bpm = bpm;
    this.T.bpm.value = bpm;
    this.origin = origin;
    this.startTime = t + 0.01;
    this.T.start(this.startTime);
    this.isRunning = true;
    this.run++;
  }

  stop() {
    this.T.stop();
    Tone.getDraw().cancel(0);
    this.isRunning = false;
  }

  /** Replace the loop's events. Takes effect from the next step; nothing is added to Tone's timeline. */
  setScore(score: Score) {
    const b = emptyBuckets();
    const s16 = 60 / score.bpm / 4;
    for (const e of score.events) {
      const step = Math.min(LOOP_STEPS - 1, Math.max(0, Math.floor(e.t / s16 + 1e-6)));
      b[step].push(e);
    }
    this.buckets = b;
  }

  /** Current absolute position in sixteenths (fractional), as heard now. -1 when stopped. */
  nowStep() {
    if (!this.running) {
      return -1;
    }
    return this.T.getTicksAtTime(Tone.immediate()) / this.ticks16();
  }

  /** Loop-relative position in seconds for an absolute step. */
  loopSeconds(abs: number) {
    return mod(abs - this.origin, LOOP_STEPS) * this.s16;
  }

  /** 0..1 position in the loop, or -1 when stopped. */
  phase() {
    const now = this.nowStep();
    return now < 0 ? -1 : mod(now - this.origin, LOOP_STEPS) / LOOP_STEPS;
  }

  /** Run a visual / UI callback in sync with an audio time. */
  draw(cb: () => void, time: number) {
    Tone.getDraw().schedule(cb, time);
  }

  /** Number of repeating callbacks on Tone's transport (dev diagnostics: should stay 1). */
  scheduledCount() {
    const repeats = (this.T as unknown as { _repeatedEvents?: { length: number } })._repeatedEvents;
    return repeats ? repeats.length : -1;
  }

  dispose() {
    this.stop();
    if (this.repeatId != null) {
      this.T.clear(this.repeatId);
      this.repeatId = null;
    }
  }

  private ticks16() {
    return this.T.PPQ / 4;
  }

  private tick = (time: number) => {
    // A restart can land after Tone has already queued the previous start's next tick (the
    // scheduler works ~100 ms ahead). That tick belongs to the aborted run: never dispatch it.
    if (time < this.startTime - 1e-6) {
      this.staleTicks++;
      return;
    }
    const abs = Math.round(this.T.getTicksAtTime(time) / this.ticks16());
    this.handlers.onStep(abs, time);

    // Read buckets after onStep: finishing a recording swaps in the new score for this very step.
    const step = mod(abs - this.origin, LOOP_STEPS);
    const s16 = this.s16;
    for (const e of this.buckets[step]) {
      this.handlers.onEvent(e, time + Math.max(0, e.t - step * s16));
    }
  };
}

function emptyBuckets(): MusicEvent[][] {
  return Array.from({ length: LOOP_STEPS }, () => []);
}

export function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

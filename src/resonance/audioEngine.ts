import * as Tone from 'tone';
import type { DrumKey } from './engine';

/** Shared mix bus and the metronome click. */
interface Bus {
  out: Tone.Gain;
  comp: Tone.Compressor;
  rev: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  filt: Tone.Filter;
  click: Tone.Synth;
}

/** The instrument voices. One set plays the scheduled loop, an identical set plays live gestures. */
interface Players {
  kick: Tone.MembraneSynth;
  hat: Tone.NoiseSynth;
  hit: Tone.NoiseSynth;
  bass: Tone.MonoSynth;
  snare: Tone.NoiseSynth;
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Where a trigger came from (dev diagnostics). */
export interface TriggerMeta {
  source?: 'live' | 'playback' | 'metronome' | 'flick-live' | 'flick-playback';
  id?: string;
  step?: number;
  loopTime?: number;
  transport?: string;
  iteration?: number;
}

/** One sound trigger as it reached Tone (dev diagnostics). */
export interface AudioTrigger extends TriggerMeta {
  voice: string;
  requested: number;
  time: number;
  nudged: boolean;
  /** True when the trigger was an exact duplicate of the previous one and was not played. */
  dropped?: boolean;
  ctxNow: number;
}

/**
 * Tone.js voices, ported from the v7 prototype (initTone, drumSound, clickSound, hitSound,
 * noteStart / noteEnd). Same signal graph and settings.
 *
 * Scheduled loop events and live gestures play on separate (identical) voices. The loop is
 * scheduled ~100 ms ahead, so sharing a voice would let a live hit cut an already-scheduled
 * envelope, or force the live hit to wait behind it.
 *
 * Tone rejects a voice start at or before that voice's previous start. Within one voice set,
 * two *distinct* events at the same instant (e.g. a flick accent on a kick) are separated by
 * 2 ms; an exact repeat of the same drum at the same instant is the same hit and is dropped.
 *
 * Keys and Lead voices are not part of this milestone.
 */
export class AudioEngine {
  private bus: Bus | null = null;
  private sched: Players | null = null;
  private live: Players | null = null;
  private nodes: Tone.ToneAudioNode[] = [];
  private last: Record<string, number> = {};
  private lastDrum: Record<string, number> = {};
  private readonly worldBase = 2000;
  private muted = false;
  /** Dev builds only: every trigger that reached Tone, with its source. */
  triggerLog: AudioTrigger[] = [];

  get ready() {
    return !!this.bus;
  }

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  start() {
    void Tone.start();
    if (this.bus) {
      return;
    }
    const out = this.keep(new Tone.Gain(this.muted ? 0 : 0.8).toDestination());
    const comp = this.keep(new Tone.Compressor(-18, 3).connect(out));
    const rev = this.keep(new Tone.Reverb({ decay: 3.2, wet: 0.28 }).connect(comp));
    const delay = this.keep(new Tone.FeedbackDelay('8n', 0.25).connect(rev));
    delay.wet.value = 0.18;
    const filt = this.keep(new Tone.Filter(2400, 'lowpass').connect(delay));

    const click = this.keep(
      new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 },
      }).connect(out),
    );
    click.volume.value = -22;

    this.bus = { out, comp, rev, delay, filt, click };
    this.sched = this.makePlayers(comp, rev);
    this.live = this.makePlayers(comp, rev);

    // applyWorld: fixed tonal base.
    rev.wet.rampTo(0.28, 0.4);
    delay.wet.rampTo(0.18, 0.4);
  }

  dispose() {
    for (const n of this.nodes) {
      try {
        n.dispose();
      } catch {
        // already disposed
      }
    }
    this.nodes = [];
    this.bus = null;
    this.sched = null;
    this.live = null;
    this.last = {};
    this.lastDrum = {};
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.bus?.out.gain.rampTo(muted ? 0 : 0.8, 0.15);
  }

  /** The live filter follows movement energy and two-hand spread. */
  setEnergy(energy: number, spread: number) {
    this.bus?.filt.frequency.rampTo(
      this.worldBase * 0.35 + 5200 * Math.pow(energy, 1.2) + 2600 * spread,
      0.1,
    );
  }

  /** `time` omitted = live gesture, played immediately on the live voices. */
  drum(d: DrumKey, vel: number, time?: number, meta?: TriggerMeta) {
    const p = time == null ? this.live : this.sched;
    if (!p) {
      return;
    }
    const set = time == null ? 'live' : 'sched';
    // The same drum requested again for the exact same instant is the same hit, not a new one.
    if (time != null && this.lastDrum[d] === time) {
      this.log(set + ':' + d, time, time, meta, true);
      return;
    }
    if (time != null) {
      this.lastDrum[d] = time;
    }
    const g = Math.min(1, 0.6 + 0.4 * (vel || 0.7));
    this.safely('drum', () => {
      if (d === 'kick') {
        p.kick.triggerAttackRelease('C1', '8n', this.at(set + ':kick', time, meta), g);
      } else if (d === 'snare') {
        p.snare.triggerAttackRelease('16n', this.at(set + ':snare', time, meta), g);
      } else {
        p.hat.triggerAttackRelease('32n', this.at(set + ':hat', time, meta), Math.min(1, g + 0.2));
      }
    });
  }

  click(accent: boolean, time: number, meta?: TriggerMeta) {
    const b = this.bus;
    if (!b) {
      return;
    }
    this.safely('click', () => {
      b.click.triggerAttackRelease(
        accent ? 'C6' : 'G5',
        '32n',
        this.at('click', time, meta),
        accent ? 0.9 : 0.5,
      );
    });
  }

  /** Flick accent. `time` omitted = live gesture. */
  hit(time?: number, meta?: TriggerMeta) {
    const p = time == null ? this.live : this.sched;
    if (!p) {
      return;
    }
    const set = time == null ? 'live' : 'sched';
    this.safely('hit', () => {
      p.kick.triggerAttackRelease('G0', '8n', this.at(set + ':kick', time, meta), 1);
      p.hit.triggerAttackRelease('8n', this.at(set + ':hit', time, meta), 1);
    });
  }

  /** A bass note from the loop, at its transport time. */
  bassNote(midi: number, dur: number, vel: number, time: number, meta?: TriggerMeta) {
    const p = this.sched;
    if (!p) {
      return;
    }
    this.safely('bass', () => {
      p.bass.triggerAttackRelease(
        hz(midi),
        Math.max(0.1, dur * 0.95),
        this.at('sched:bass', time, meta),
        vel,
      );
    });
  }

  /** Live held note start. Only the bass voice exists in this milestone. */
  noteStart(midi: number, vel: number, inst: string, meta?: TriggerMeta) {
    const p = this.live;
    if (!p || inst !== 'bass') {
      return;
    }
    this.safely('noteStart', () =>
      p.bass.triggerAttack(hz(midi), this.at('live:bass', undefined, meta), vel),
    );
  }

  noteEnd(_midi: number, inst: string) {
    const p = this.live;
    if (!p || inst !== 'bass') {
      return;
    }
    this.safely('noteEnd', () => p.bass.triggerRelease(this.at('live:bassRelease')));
  }

  /** Silence anything sustaining (pause / reset). */
  releaseAll() {
    const now = Tone.immediate();
    for (const p of [this.sched, this.live]) {
      this.safely('releaseAll', () => p?.bass.triggerRelease(now));
    }
  }

  private makePlayers(comp: Tone.Compressor, rev: Tone.Reverb): Players {
    const kick = this.keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.03,
        octaves: 5,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
      }).connect(comp),
    );
    kick.volume.value = -8;

    const hatF = this.keep(new Tone.Filter(7000, 'highpass').connect(comp));
    const hat = this.keep(
      new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
      }).connect(hatF),
    );
    hat.volume.value = -24;

    const hitF = this.keep(new Tone.Filter(1800, 'bandpass').connect(rev));
    const hit = this.keep(
      new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.002, decay: 0.35, sustain: 0 },
      }).connect(hitF),
    );
    hit.volume.value = -8;

    const bass = this.keep(
      new Tone.MonoSynth({
        oscillator: { type: 'triangle' },
        filter: { Q: 1, type: 'lowpass' },
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.3 },
        filterEnvelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.4,
          baseFrequency: 120,
          octaves: 2.5,
        },
      }).connect(comp),
    );
    bass.volume.value = -11;

    const snF = this.keep(new Tone.Filter(1900, 'bandpass').connect(comp));
    const snare = this.keep(
      new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
      }).connect(snF),
    );
    snare.volume.value = -10;

    return { kick, hat, hit, bass, snare };
  }

  private keep<T extends Tone.ToneAudioNode>(n: T) {
    this.nodes.push(n);
    return n;
  }

  /**
   * Keeps one voice's start times strictly increasing (Tone rejects a start at or before the
   * previous one). Only distinct events ever reach this with an equal time.
   */
  private at(voice: string, time?: number, meta?: TriggerMeta) {
    const requested = time ?? Tone.immediate();
    let t = requested;
    const prev = this.last[voice];
    if (prev != null && t <= prev) {
      t = prev + 0.002;
    }
    this.last[voice] = t;
    this.log(voice, requested, t, meta, false);
    return t;
  }

  private log(
    voice: string,
    requested: number,
    time: number,
    meta: TriggerMeta | undefined,
    dropped: boolean,
  ) {
    if (!import.meta.env.DEV) {
      return;
    }
    this.triggerLog.push({
      voice,
      requested,
      time,
      nudged: time !== requested,
      dropped,
      ctxNow: Tone.immediate(),
      ...meta,
    });
    if (this.triggerLog.length > 20000) {
      this.triggerLog.splice(0, 5000);
    }
  }

  private safely(what: string, fn: () => void) {
    try {
      fn();
    } catch (e) {
      console.warn('Resonance audio:', what, e);
    }
  }
}

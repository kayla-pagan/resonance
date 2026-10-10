import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Pinned to the version the v7 prototype loads. */
const MP_VERSION = '0.10.14';
/** MediaPipe's WebAssembly runtime and the hand model, fetched from the same places v7 uses. */
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** Minimum time between detections (~30 fps), as in v7. */
const DETECT_INTERVAL_MS = 30;

/** Hand skeleton connections for the preview overlay (v7 BONES). */
const BONES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

/** Landmarks for each detected hand (21 points, normalised to the video frame). */
export type Hands = NormalizedLandmark[][];

export type CamState = 'live' | 'unavailable';
export type TrackState = 'loading' | 'on' | 'failed';

export interface TrackerEvents {
  onCamera(state: CamState, blocked: boolean): void;
  onTracking(state: TrackState): void;
}

/**
 * Camera + MediaPipe Hand Landmarker (v7 requestCamera / startTracking / detect / drawHand).
 *
 * Detection runs on a hidden <video>, so tracking works whether or not the preview is shown.
 * Landmarks never enter React state: the controller polls once per animation frame and this
 * class only runs inference when ~30 ms have passed and a new video frame is available.
 */
export class HandTracker {
  stream: MediaStream | null = null;
  private readonly events: TrackerEvents;
  private video: HTMLVideoElement | null = null;
  private tracker: HandLandmarker | null = null;
  private loading = false;
  private lastDet = 0;
  private lastVT = -1;
  private disposed = false;
  /** Dev diagnostics: which delegate loaded, and detection count / total inference time. */
  stats = { delegate: '', detections: 0, inferMs: 0 };

  constructor(events: TrackerEvents) {
    this.events = events;
  }

  get tracking() {
    return !!this.tracker;
  }

  /** Ask for the camera (from a user gesture) and start hand tracking. Safe to retry. */
  async requestCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('no camera');
      }
      const stream =
        this.stream ||
        (await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        }));
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.events.onCamera('live', false);
      const v = this.video || (this.video = document.createElement('video'));
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.srcObject = stream;
      v.play().catch(() => {});
      void this.startTracking();
    } catch {
      // An embedding page (e.g. a design preview iframe) may block the camera outright.
      let blocked = false;
      try {
        const fp = (
          document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } }
        ).featurePolicy;
        blocked = window !== window.top && !!fp && !fp.allowsFeature('camera');
      } catch {
        // ignore
      }
      if (!this.disposed) {
        this.events.onCamera('unavailable', blocked);
      }
    }
  }

  /** Load the Hand Landmarker: up to 2 hands, VIDEO mode, GPU first with CPU fallback. */
  private async startTracking() {
    if (this.tracker || this.loading) {
      return;
    }
    this.loading = true;
    this.events.onTracking('loading');
    try {
      const mp = await import('@mediapipe/tasks-vision');
      const files = await mp.FilesetResolver.forVisionTasks(WASM_URL);
      const opts = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      let t: HandLandmarker;
      try {
        t = await mp.HandLandmarker.createFromOptions(files, opts('GPU'));
        this.stats.delegate = 'GPU';
      } catch {
        t = await mp.HandLandmarker.createFromOptions(files, opts('CPU'));
        this.stats.delegate = 'CPU';
      }
      if (this.disposed) {
        t.close();
        return;
      }
      this.tracker = t;
      this.events.onTracking('on');
    } catch (e) {
      console.warn('Hand tracking unavailable', e);
      if (!this.disposed) {
        this.events.onTracking('failed');
      }
    } finally {
      this.loading = false;
    }
  }

  /**
   * Run detection if it is due (~30 fps) and a new video frame is ready.
   * Returns the detected hands (possibly none), or null when nothing new was processed.
   */
  poll(): Hands | null {
    const v = this.video;
    const tk = this.tracker;
    if (!tk || !v || v.readyState < 2) {
      return null;
    }
    const now = performance.now();
    if (now - this.lastDet < DETECT_INTERVAL_MS || v.currentTime === this.lastVT) {
      return null;
    }
    this.lastDet = now;
    this.lastVT = v.currentTime;
    try {
      const hands = tk.detectForVideo(v, now).landmarks ?? [];
      if (import.meta.env.DEV) {
        this.stats.detections++;
        this.stats.inferMs += performance.now() - now;
      }
      return hands;
    } catch {
      return null;
    }
  }

  /** Mirror the stream into a visible preview <video>, if one is mounted. */
  attachPreview(el: HTMLVideoElement | null) {
    if (el && this.stream && el.srcObject !== this.stream) {
      el.srcObject = this.stream;
      el.play().catch(() => {});
    }
  }

  /** Bones and joints over the mirrored preview; thumb and index tips highlighted (v7). */
  drawHands(c: HTMLCanvasElement | null, all: Hands) {
    if (!c) {
      return;
    }
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (!w) {
      return;
    }
    if (c.width !== w * 2) {
      c.width = w * 2;
      c.height = hh * 2;
    }
    const g = c.getContext('2d');
    if (!g) {
      return;
    }
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, w, hh);
    const v = this.video;
    const vw = (v && v.videoWidth) || 640;
    const vh = (v && v.videoHeight) || 480;
    // Match the preview's object-fit: cover, then mirror horizontally.
    const sc = Math.max(w / vw, hh / vh);
    const ox = (w - vw * sc) / 2;
    const oy = (hh - vh * sc) / 2;
    const P = (p: NormalizedLandmark) => [w - (ox + p.x * vw * sc), oy + p.y * vh * sc];
    for (const lm of all) {
      g.strokeStyle = 'rgba(236,230,216,.55)';
      g.lineWidth = 1;
      g.beginPath();
      for (const [a, b] of BONES) {
        const A = P(lm[a]);
        const B = P(lm[b]);
        g.moveTo(A[0], A[1]);
        g.lineTo(B[0], B[1]);
      }
      g.stroke();
      lm.forEach((p, i) => {
        const q = P(p);
        g.fillStyle = i === 4 || i === 8 ? '#7fe0ec' : '#ece6d8';
        g.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3);
      });
    }
  }

  dispose() {
    this.disposed = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try {
      this.tracker?.close();
    } catch {
      // already closed
    }
    this.tracker = null;
    if (this.video) {
      this.video.srcObject = null;
    }
  }
}

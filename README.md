# Resonance

**Compose music with your hands, and feel it on your wrist.**

Resonance is a gesture-based music studio designed with Deaf and hard-of-hearing performers in
mind. You play by moving your hands in front of a camera (or with a cursor). You build a four-bar
loop one instrument at a time. Every layer is shown as visual notation and felt through a
two-motor haptic wristband. Sound is optional: in **Feel only** mode the music plays entirely
through sight and touch.

**Live demo:** <https://resonance-five-chi.vercel.app> (best in Chrome or Edge on desktop)

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Using Resonance](#using-resonance)
- [Haptic model](#haptic-model)
- [Project structure](#project-structure)
- [Hardware](#hardware)
- [Browser support](#browser-support)
- [Development](#development)

---

## Features

- **Hand-tracked performance.** MediaPipe Hand Landmarker tracks up to two hands from the webcam.
  Height chooses the note (or kick / snare / hat), a thumb-to-index pinch plays, and movement
  energy sets how strongly you play.
- **Two-hand play.** Both hands play the selected instrument independently. Each hand has its own
  pinch, pitch, strength and held note, and keeps its identity from frame to frame.
- **Layered four-bar loops.** Record Drums, Bass, Keys and Lead in any order, starting with any
  instrument. Every take gets a one-bar count-in and records exactly bars 1–4 of the shared loop
  while the existing layers keep playing.
- **One master clock.** A single Tone.js transport drives audio, recording, notation and haptics,
  so nothing drifts.
- **Visual music notation.** Rhythm becomes waves, pitch becomes height, duration becomes
  ribbons and dynamics become size, with a distinct shape per instrument. A Music view shows each
  instrument; a Tactile view shows each motor.
- **Tactile wristband.** An on-screen wristband always shows what you would feel. An ESP32
  wristband connects over Web Bluetooth.
- **Hear + Feel / Feel only / Hear only** playback modes, plus Feel filters (Both / Drums / Bass /
  Off).
- **Cursor and keyboard fallback.** Everything works without a camera.
- **Accessibility.** Respects reduced motion, with a calmer visual mode.

## How it works

The app is split into two halves, kept strictly apart:

| Layer                               | Responsibility                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **React** (`src/screens`, `src/ui`) | Screens, controls, panels and app state. Nothing that changes every frame.                             |
| **Imperative core** (`src/core`)    | Canvas particle field, Tone.js audio and transport, MediaPipe tracking, recording, haptics, Bluetooth. |

The `ResonanceController` owns the frame loop and the master transport. React renders from a
small app state and a low-rate UI snapshot. Per-frame data (hand positions, particles, motor
levels) never enters React state.

Each loop event is a single `MusicEvent` that feeds four outputs at the same transport time:
audio, notation, the tactile score and the wristband.

## Tech stack

| Area           | Technology                                                                               |
| -------------- | ---------------------------------------------------------------------------------------- |
| UI             | [React 19](https://react.dev), TypeScript 6                                              |
| Build          | [Vite 8](https://vite.dev)                                                               |
| Audio & timing | [Tone.js 15](https://tonejs.github.io) (Web Audio)                                       |
| Hand tracking  | [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe) Hand Landmarker (0.10.14) |
| Graphics       | HTML Canvas 2D (custom particle field and notation)                                      |
| Haptics        | Web Bluetooth (Nordic UART service), ESP32 + two vibration motors                        |
| Firmware       | Arduino (ESP32 core 2.x / 3.x)                                                           |
| Code quality   | ESLint (typescript-eslint, react-hooks), Prettier                                        |
| Styling        | Plain CSS, one stylesheet per component                                                  |

## Getting started

### Prerequisites

- **Node.js** 20.19+ or 22.12+ (required by Vite 8)
- **Chrome or Edge on desktop** for camera tracking and the Bluetooth wristband (see
  [Browser support](#browser-support))
- A webcam (optional; the cursor works without one)

### Install and run

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Choose **Enter the studio** to use the camera, or **Try demo mode**
to play with the cursor.

The hand-tracking model and its WebAssembly runtime load from a CDN the first time the camera
starts, so camera tracking needs an internet connection.

## Using Resonance

1. **Tutorial.** Four short steps: height chooses the sound, pinch to play, move more to play
   stronger, and what the wristband does.
2. **Set the tempo.** Use − / + or **Find my pulse** (tap 4–8 steady hits).
3. **Record a layer.** Choose any instrument. After a one-bar count-in, play four bars. The take
   joins the loop at the next bar 1.
4. **Add layers.** Add the remaining instruments in any order while the loop keeps playing.
5. **Play back.** Switch between Hear + Feel, Feel only and Hear only, and between the Music and
   Tactile score views.

### Gestures

| Gesture                 | Effect                                   |
| ----------------------- | ---------------------------------------- |
| Raise / lower your hand | Chooses the note (or kick / snare / hat) |
| Pinch (thumb to index)  | Plays; hold the pinch to sustain         |
| Faster, wider movement  | Plays stronger                           |
| Two hands apart         | Opens up the sound                       |
| Either hand, or both    | Plays the selected instrument            |

### Keyboard

| Key       | Action                                     |
| --------- | ------------------------------------------ |
| `Space`   | Play / pause the loop                      |
| `R`       | Next step: find pulse, record, add layer   |
| `1`–`4`   | Choose an instrument (in the layer picker) |
| `J`       | Pinch or hit (hold to sustain)             |
| `↑ ↓ ← →` | Move the hand                              |
| `F`       | Next Feel mode                             |
| `C`       | Audible click on / off                     |
| `M`       | Mute                                       |
| `X`       | Reset                                      |
| `?`       | Help                                       |
| `Esc`     | Close panels                               |

## Haptic model

The prototype wristband has two motors. What they carry depends on the phase:

| Phase                              | Left motor     | Right motor   | On screen                         |
| ---------------------------------- | -------------- | ------------- | --------------------------------- |
| Count-in                           | Metronome      | Metronome     | Amber · _Keeping time_            |
| Take, no recorded Drums / Bass yet | Metronome      | Metronome     | Amber · _Keeping time_            |
| Take over recorded Drums / Bass    | Recorded Drums | Recorded Bass | Cream / cyan · _Feeling the loop_ |
| Playback                           | Drums          | Bass          | Cream / cyan · _Composition_      |

- The metronome is beat 1 at full strength for 140 ms, then beats 2–4 lighter for 45 ms.
- The layer being recorded never vibrates live.
- Keys and Lead are heard and shown in the notation but have no motor. Future wristbands with more
  motors could separate more layers.
- Playback never adds a metronome or invented beats: the motors only play what was recorded.

## Project structure

```
resonance/
├─ firmware/                    ESP32 wristband firmware and wiring guide
│  ├─ ResonanceWristband/
│  │  └─ ResonanceWristband.ino
│  └─ README.md
├─ public/                      Static assets (favicon, icons)
├─ src/
│  ├─ core/                     Imperative engine (no React)
│  │  ├─ controller.ts          Frame loop, input, hands, recording, haptic routing
│  │  ├─ masterTransport.ts     The single Tone.js clock and loop scheduler
│  │  ├─ audioEngine.ts         Tone.js voices: drums, bass, keys, lead, click
│  │  ├─ engine.ts              Music model, scales, quantization, haptic grammar, BLE transport
│  │  ├─ handTracker.ts         Camera + MediaPipe Hand Landmarker
│  │  ├─ particleField.ts       Canvas particle field
│  │  ├─ notation.ts            Visual music notation drawn on the field
│  │  ├─ tactileView.ts         On-screen wristband drawing
│  │  ├─ sim.ts                 Mutable per-frame state (hands, ripples, notation)
│  │  └─ appState.ts            React-owned app state and the UI snapshot store
│  ├─ screens/                  React screens and their styles
│  │  ├─ Landing.tsx            Welcome screen
│  │  ├─ Tutorial.tsx           Four-step tutorial
│  │  ├─ TempoSetup.tsx         Tempo and pulse finding
│  │  ├─ Studio.tsx             Studio layout, guide, loop panel, layer picker
│  │  ├─ StudioTransport.tsx    Record / play / status bar
│  │  ├─ Tactile.tsx            Wristband module, score views, playback modes
│  │  ├─ scoreGeometry.ts       Music / Tactile score layout
│  │  └─ transportView.ts       Transport status and button state
│  ├─ ui/                       Small shared UI helpers
│  ├─ App.tsx                   Screen routing, controller lifecycle
│  └─ main.tsx                  Entry point
├─ index.html
├─ package.json
├─ vite.config.ts
└─ eslint.config.js
```

## Hardware

The wristband is an ESP32 driving two vibration motors (GPIO 25 = left / Drums, GPIO 26 = right /
Bass) through transistors. Flash the firmware, then in the Studio choose **Wristband → Connect
wristband**. The popover also has a hardware test that fires each motor.

See [`firmware/README.md`](firmware/README.md) for wiring, flashing, the command protocol and
tuning.

## Browser support

| Capability                  | Chrome / Edge (desktop) | Safari | Firefox |
| --------------------------- | :---------------------: | :----: | :-----: |
| Cursor play, audio, visuals |            ✓            |   ✓    |    ✓    |
| Camera hand tracking        |            ✓            |   ✓    |    ✓    |
| Bluetooth wristband         |            ✓            |   —    |    —    |

Web Bluetooth and the camera both need a secure context (`localhost` or HTTPS). Without
Bluetooth, the on-screen wristband and the tactile score still show everything.

## Development

| Command                | Purpose                              |
| ---------------------- | ------------------------------------ |
| `npm run dev`          | Start the dev server with hot reload |
| `npm run build`        | Type-check and build for production  |
| `npm run preview`      | Serve the production build locally   |
| `npm run lint`         | ESLint                               |
| `npm run format`       | Format with Prettier                 |
| `npm run format:check` | Check formatting                     |

In development builds the controller is exposed as `window.__resonance` for debugging. It also
records dispatch and trigger logs used for timing verification.

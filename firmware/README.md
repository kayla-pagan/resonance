# Resonance wristband firmware

ESP32 firmware for the two-motor wristband. The web app connects to it over Bluetooth Low Energy
and sends every haptic event: the count-in metronome, and the Drums / Bass groove.

| Motor | ESP32 pin | App channel | Carries                   |
| ----- | --------- | ----------- | ------------------------- |
| Left  | GPIO 25   | `R`         | Drums (and the metronome) |
| Right | GPIO 26   | `E`         | Bass (and the metronome)  |

These are the same pins as the bench test (`motor1 = 25`, `motor2 = 26`).

## Wiring

Drive each motor through a transistor or MOSFET (or a small motor driver), never straight from
the GPIO pin. Put a flyback diode across each motor. The firmware uses PWM on both pins to set
vibration strength, so the driver must be able to switch at 20 kHz. Logic-level MOSFETs and
small NPN transistors both can.

## Flash it

1. Arduino IDE → **Boards Manager** → install **esp32 by Espressif** (2.x or 3.x both work).
2. Open `ResonanceWristband/ResonanceWristband.ino`.
3. Select your ESP32 board and port, then **Upload**.
4. On power-up the band buzzes left, then right. That confirms the wiring.

## Connect from the app

1. Use **Chrome or Edge on desktop**. Web Bluetooth isn't available in Safari or Firefox.
2. Open the app on `http://localhost:5173` (or any HTTPS address).
3. In the Studio, click **Wristband → Connect wristband**, then choose **Resonance Wristband**.
4. Use **Hardware test** in the same popover to fire Drums, Bass or Both at Low / Medium / High.
   Each button sends a 150 ms pulse.

The on-screen wristband keeps working whether or not hardware is connected, and the Feel modes
(Both / Drums / Bass / Off) filter what is sent to the band.

## Protocol

One text line per command, written to the Nordic UART RX characteristic
(`6e400002-b5a3-f393-e0a9-e50e24dcca9e`):

```
R,<intensity 0-255>,<duration ms>\n    left motor
E,<intensity 0-255>,<duration ms>\n    right motor
```

- `duration` 0 means hold until the next command for that motor (held bass notes).
- `intensity` 0 means off.

The app's patterns:

| When                            | Command                         |
| ------------------------------- | ------------------------------- |
| Count-in beat 1, both motors    | `R,255,140` + `E,255,140`       |
| Count-in beats 2–4, both motors | `R,140,45` + `E,140,45`         |
| Kick / snare / hat              | `R,…,100` / `R,…,60` / `R,…,35` |
| Bass note / held note           | `E,…,110` / `E,…,<note length>` |

## Tuning (top of the sketch)

| Setting                  | Default | Change it when                                                                  |
| ------------------------ | ------- | ------------------------------------------------------------------------------- |
| `LEFT_PIN` / `RIGHT_PIN` | 25 / 26 | Drums vibrate on the wrong side: swap them                                      |
| `MIN_DUTY`               | 110     | Light beats aren't felt: raise it. Everything feels the same strength: lower it |
| `KICK_MS`                | 12      | Short beats feel mushy: try 15–20                                               |
| `MAX_HOLD_MS`            | 8000    | Safety cut-off for a hold whose release was lost                                |
| `DEBUG`                  | false   | `true` prints every received command on Serial at 115200                        |

## Troubleshooting

- **Not in the browser's device list:** make sure the board is powered and not already connected
  to another tab or phone. Reset it.
- **Connects but never vibrates:** set `DEBUG = true`. If no commands print, the app isn't
  sending; check that Feel isn't Off and that the playback mode isn't Hear only. If commands print
  but nothing moves, check the transistor wiring.
- **The band disconnects:** the app shows "The connection dropped" and offers Reconnect. Both
  motors switch off automatically when the connection drops.

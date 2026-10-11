/*
  Resonance wristband — ESP32 firmware (two vibration motors over BLE).
  See ../README.md for setup, wiring and tuning.

  The web app sends one text line per motor command:

      R,<intensity 0-255>,<duration ms>\n   left motor  (Drums, and the metronome)
      E,<intensity 0-255>,<duration ms>\n   right motor (Bass, and the metronome)

    duration 0  -> hold until the next command for that motor (held bass notes)
    intensity 0 -> motor off (release)
*/

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <esp_arduino_version.h>

// ---- pins (from the bench test: motor1 = 25, motor2 = 26)
// If the motors sit on the opposite sides of the wrist, swap these two.
const int LEFT_PIN = 25;   // 'R' = Drums (left)
const int RIGHT_PIN = 26;  // 'E' = Bass (right)

// ---- feel tuning
// Vibration motors stall below a certain duty, so app intensities 1-255 are mapped onto
// MIN_DUTY..255 and a light 0.55 metronome beat is still felt.
const int MIN_DUTY = 110;
// A short full-power kick when a motor starts from rest, so 45 ms beats spin up in time.
const unsigned long KICK_MS = 12;
// Safety: a held motor (duration 0) never runs longer than this if its release is lost.
const unsigned long MAX_HOLD_MS = 8000;
const bool DEBUG = false;  // true: print every command on Serial (115200)

// ---- BLE: Nordic UART service, which is what the app looks for
#define SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define RX_UUID "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // the app writes here
#define DEVICE_NAME "Resonance Wristband"               // the app filters on "Resonance..."

const int PWM_FREQ = 20000;  // above hearing, so the motors do not whine
const int PWM_BITS = 8;

struct Motor {
  int pin;
  int channel;              // LEDC channel (Arduino-ESP32 core 2.x only)
  int duty;                 // target duty while on
  bool on;
  unsigned long offAt;      // millis() when the pulse ends
  unsigned long kickUntil;  // millis() when the start-up kick ends
};

Motor motors[2] = {
  { LEFT_PIN, 0, 0, false, 0, 0 },
  { RIGHT_PIN, 1, 0, false, 0, 0 },
};

String lineBuf;

// ---- PWM, for both Arduino-ESP32 core generations
void pwmSetup(Motor &m) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(m.pin, PWM_FREQ, PWM_BITS);
#else
  ledcSetup(m.channel, PWM_FREQ, PWM_BITS);
  ledcAttachPin(m.pin, m.channel);
#endif
}

void pwmWrite(Motor &m, int duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(m.pin, duty);
#else
  ledcWrite(m.channel, duty);
#endif
}

void motorOff(Motor &m) {
  m.on = false;
  m.kickUntil = 0;
  pwmWrite(m, 0);
}

// intensity 0-255 from the app; durationMs 0 = hold.
void motorCommand(Motor &m, int intensity, unsigned long durationMs) {
  if (intensity <= 0) {
    motorOff(m);
    return;
  }
  unsigned long now = millis();
  int duty = MIN_DUTY + (long)(255 - MIN_DUTY) * min(intensity, 255) / 255;
  bool fromRest = !m.on;
  m.duty = duty;
  m.on = true;
  m.offAt = now + (durationMs > 0 ? durationMs : MAX_HOLD_MS);
  if (fromRest && duty < 255) {
    m.kickUntil = now + KICK_MS;
    pwmWrite(m, 255);
  } else {
    m.kickUntil = 0;
    pwmWrite(m, duty);
  }
}

// One line, e.g. "R,140,45"
void handleLine(const String &line) {
  int c1 = line.indexOf(',');
  int c2 = line.indexOf(',', c1 + 1);
  if (line.length() < 5 || c1 != 1 || c2 < 0) {
    return;
  }
  int intensity = line.substring(c1 + 1, c2).toInt();
  unsigned long ms = (unsigned long)line.substring(c2 + 1).toInt();
  char ch = line.charAt(0);
  if (ch == 'R') {
    motorCommand(motors[0], intensity, ms);
  } else if (ch == 'E') {
    motorCommand(motors[1], intensity, ms);
  } else {
    return;
  }
  if (DEBUG) {
    Serial.println(line);
  }
}

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    // String on core 3.x, std::string on 2.x: both index the same way.
    auto v = c->getValue();
    for (size_t i = 0; i < v.length(); i++) {
      char ch = v[i];
      if (ch == '\n' || ch == '\r') {
        if (lineBuf.length()) {
          handleLine(lineBuf);
        }
        lineBuf = "";
      } else if (lineBuf.length() < 32) {
        lineBuf += ch;
      }
    }
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    if (DEBUG) {
      Serial.println("connected");
    }
  }
  void onDisconnect(BLEServer *) override {
    // Never leave a motor running when the app goes away; advertise again for a reconnect.
    motorOff(motors[0]);
    motorOff(motors[1]);
    lineBuf = "";
    BLEDevice::startAdvertising();
    if (DEBUG) {
      Serial.println("disconnected");
    }
  }
};

void setup() {
  if (DEBUG) {
    Serial.begin(115200);
  }
  for (Motor &m : motors) {
    pinMode(m.pin, OUTPUT);
    digitalWrite(m.pin, LOW);
    pwmSetup(m);
    motorOff(m);
  }

  BLEDevice::init(DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);
  // WRITE_NR is required: Chrome sends with "write without response".
  BLECharacteristic *rx = service->createCharacteristic(
    RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  service->start();

  // The name goes in the advertisement and the 128-bit service UUID in the scan response, so
  // both fit in their 31-byte packets and the browser's device picker can match either.
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  BLEAdvertisementData advData;
  advData.setFlags(0x06);  // general discoverable, BLE only
  advData.setName(DEVICE_NAME);
  adv->setAdvertisementData(advData);
  BLEAdvertisementData scanData;
  scanData.setCompleteServices(BLEUUID(SERVICE_UUID));
  adv->setScanResponseData(scanData);
  BLEDevice::startAdvertising();

  // Power-up check: left buzz, then right buzz (like the bench test, but short). Each pulse is
  // switched off here, since loop() (which ends timed pulses) is not running yet.
  for (Motor &m : motors) {
    motorCommand(m, 255, 200);
    delay(200);
    motorOff(m);
    delay(150);
  }
}

void loop() {
  unsigned long now = millis();
  for (Motor &m : motors) {
    if (!m.on) {
      continue;
    }
    if (m.kickUntil && (long)(now - m.kickUntil) >= 0) {
      m.kickUntil = 0;
      pwmWrite(m, m.duty);
    }
    if ((long)(now - m.offAt) >= 0) {
      motorOff(m);
    }
  }
  delay(1);
}
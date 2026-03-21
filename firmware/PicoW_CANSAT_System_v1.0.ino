/*
CANSAT リアルタイム操縦システム
渡邉
コメント適当でごめん
*/
#include <Arduino.h>
#include <WiFi.h>
#include "hardware/pwm.h"

// =====================================================
// Wi-Fi
// =====================================================
const char* WIFI_SSID = "TP-Link_CCFE";
const char* WIFI_PASS = "13468194";

WiFiServer server(80);

// =====================================================
// 走行系ピン（前回確定）
// =====================================================
const int L_IN1 = 1;
const int L_IN2 = 0;
const int R_IN1 = 3;
const int R_IN2 = 2;

// 走行設定
int PWM_FWD  = 180;
int PWM_TURN = 170;
bool invertL = false;
bool invertR = false;
bool brakeInStop = true;

// 走行状態
String lastCommand  = "NONE";
String lastResponse = "BOOT_OK";

// =====================================================
// 充電系設定（添付コードベース）
// =====================================================
const int   CELLS   = 4;
const float RS      = 0.1f;
const float VREF    = 3.3f;
const int   ADC_MAX = 4095;

// ★ ここを UI から変更できるように変数化
float TARGET_CURRENT = 0.30f;   // 最初は安全のため低め推奨
float MAX_CURRENT    = 1.00f;
float CRIT_CURRENT   = 1.50f;
float OCP_STEP       = 0.005f;

float P_GAIN   = 0.005f;
float DUTY_MIN = 0.02f;
float DUTY_MAX = 0.95f;

float TEMP_LIMIT = 45.0f;

unsigned long DTDT_ARM_MS = 10000UL;
int   DTDT_CONSEC_HITS = 3;
float T_ALPHA = 0.6f;
float DTDT_WINDOW_SEC = 10.0f;
inline float dtdtThresholdForWindow(float sec) { return sec * 0.0167f; }

unsigned long CHARGE_TIMEOUT_MS = 60UL * 60UL * 1000UL;
unsigned long SAMPLE_INTERVAL = 500;

const float VOLTAGE_GAIN = 3.0f;
const float V_FULL_PER_CELL   = 1.45f;
const float BAT_START_VOLTAGE = CELLS * V_FULL_PER_CELL;
const float DELTA_V_PER_CELL  = -0.015f;
const int   DELTA_V_WINDOW    = 20;
const float DELTA_V_THRESHOLD = CELLS * DELTA_V_PER_CELL;

const float V_CV_PER_CELL = 1.47f;
const float V_CV_TARGET   = CELLS * V_CV_PER_CELL;
const float V_GAIN_CV     = 0.02f;
const float V_CV_HYST     = 0.01f * CELLS;

float TRICKLE_CURRENT  = 0.05f;
float TRICKLE_DUTY_MIN = 0.0f;
float TRICKLE_DUTY_MAX = 0.20f;

// 充電系ピン
const uint PWM_PIN       = 22;
const uint ADC0_PIN      = 26;
const uint ADC1_PIN      = 27;
const uint ADC_THERM_PIN = 28;

// PWM設定
const uint16_t PWM_WRAP = 6249;

// =====================================================
// 充電状態
// =====================================================
/*enum ChargeState : uint8_t { IDLE=0, CC=1, CV=2, TRICKLE=3, MONITOR=4 };
ChargeState chargeState = IDLE;
*/
typedef uint8_t ChargeState;

static const ChargeState IDLE    = 0;
static const ChargeState CC      = 1;
static const ChargeState CV      = 2;
static const ChargeState TRICKLE = 3;
static const ChargeState MONITOR = 4;

ChargeState chargeState = IDLE;


unsigned long chargeStartMillis = 0;
float chargeDuty = 0.0f;

float batvBuffer[DELTA_V_WINDOW] = {0.0f};
int   batvIndex = 0;
bool  batvFilled = false;

bool  tempInit = false;
float T_filt   = 0.0f;

const int TEMP_HISTORY_MAX = 120;
float tempHistory[TEMP_HISTORY_MAX];
int   tempHistIndex = 0;
bool  tempHistFilled = false;
int   dtdt_hit_count = 0;

// UI/HTTP返却用の最新値
float g_vHigh = 0.0f;
float g_vLow  = 0.0f;
float g_vbat  = 0.0f;
float g_curr  = 0.0f;
float g_temp  = 0.0f;

// =====================================================
// 走行制御
// =====================================================
inline void motorL_forward_pwm(int pwm) { analogWrite(L_IN1, pwm); digitalWrite(L_IN2, LOW); }
inline void motorL_reverse_pwm(int pwm) { analogWrite(L_IN2, pwm); digitalWrite(L_IN1, LOW); }
inline void motorL_brake()              { digitalWrite(L_IN1, HIGH); digitalWrite(L_IN2, HIGH); }
inline void motorL_stop()               { digitalWrite(L_IN1, LOW);  digitalWrite(L_IN2, LOW);  }

inline void motorR_forward_pwm(int pwm) { analogWrite(R_IN1, pwm); digitalWrite(R_IN2, LOW); }
inline void motorR_reverse_pwm(int pwm) { analogWrite(R_IN2, pwm); digitalWrite(R_IN1, LOW); }
inline void motorR_brake()              { digitalWrite(R_IN1, HIGH); digitalWrite(R_IN2, HIGH); }
inline void motorR_stop()               { digitalWrite(R_IN1, LOW);  digitalWrite(R_IN2, LOW);  }

void motorBrakeBoth() { motorL_brake(); motorR_brake(); }
void motorStopBoth()  { motorL_stop();  motorR_stop();  }

void driveLeft(bool forward, int pwm) {
  bool dir = forward ^ invertL;
  if (dir) motorL_forward_pwm(pwm);
  else     motorL_reverse_pwm(pwm);
}

void driveRight(bool forward, int pwm) {
  bool dir = forward ^ invertR;
  if (dir) motorR_forward_pwm(pwm);
  else     motorR_reverse_pwm(pwm);
}

void moveForward() {
  driveLeft(true, PWM_FWD);
  driveRight(true, PWM_FWD);
}

void moveBack() {
  driveLeft(false, PWM_FWD);
  driveRight(false, PWM_FWD);
}

void moveLeft() {
  driveLeft(false, PWM_TURN);
  driveRight(true, PWM_TURN);
}

void moveRight() {
  driveLeft(true, PWM_TURN);
  driveRight(false, PWM_TURN);
}

void stopAllDrive() {
  if (brakeInStop) motorBrakeBoth();
  else motorStopBoth();
}

String executeDriveCommand(const String& cmd) {
  lastCommand = cmd;

  if (cmd == "PING") {
    lastResponse = "ACK:PONG";
  } else if (cmd == "MOVE:FORWARD") {
    moveForward();
    lastResponse = "ACK:MOVE:FORWARD";
  } else if (cmd == "MOVE:BACK") {
    moveBack();
    lastResponse = "ACK:MOVE:BACK";
  } else if (cmd == "MOVE:LEFT") {
    moveLeft();
    lastResponse = "ACK:MOVE:LEFT";
  } else if (cmd == "MOVE:RIGHT") {
    moveRight();
    lastResponse = "ACK:MOVE:RIGHT";
  } else if (cmd == "MOVE:STOP" || cmd == "STOP") {
    stopAllDrive();
    lastResponse = "ACK:STOP";
  } else {
    lastResponse = "ERR:UNKNOWN_CMD";
  }

  Serial.print("RX = ");
  Serial.println(cmd);
  Serial.print("TX = ");
  Serial.println(lastResponse);

  return lastResponse;
}

// =====================================================
// 充電制御
// =====================================================
void setupPwm20k(uint pin) {
  gpio_set_function(pin, GPIO_FUNC_PWM);
  uint slice = pwm_gpio_to_slice_num(pin);
  pwm_config cfg = pwm_get_default_config();
  pwm_config_set_clkdiv(&cfg, 1.0f);
  pwm_config_set_wrap(&cfg, PWM_WRAP);
  pwm_init(slice, &cfg, true);
  pwm_set_gpio_level(pin, 0);
}

void setChargePwmDuty(float duty) {
  float inverted = 1.0f - constrain(duty, 0.0f, 1.0f);
  uint16_t level = (uint16_t)((PWM_WRAP + 1) * inverted);
  pwm_set_gpio_level(PWM_PIN, level);
}

inline float adcToVolt(uint16_t raw) { return (float)raw * VREF / (float)ADC_MAX; }
float readVoltage(uint adcPin) { return adcToVolt(analogRead(adcPin)); }

float calcCurrent(float& vHigh, float& vLow) {
  vHigh = readVoltage(ADC0_PIN) * VOLTAGE_GAIN;
  vLow  = readVoltage(ADC1_PIN) * VOLTAGE_GAIN;
  return (vHigh - vLow) / RS;
}

float readBatteryVoltage() {
  return readVoltage(ADC1_PIN) * VOLTAGE_GAIN;
}

float readBatteryVoltage_quiet(float currentDuty) {
  setChargePwmDuty(0.0f);
  delay(5);
  float v = readVoltage(ADC1_PIN) * VOLTAGE_GAIN;
  setChargePwmDuty(currentDuty);
  return v;
}

float calcTemperature() {
  float vNTC = readVoltage(ADC_THERM_PIN);
  vNTC = constrain(vNTC, 0.05f, VREF - 0.05f);
  float rNTC = 10000.0f * vNTC / (VREF - vNTC);
  return 25.0f - (rNTC - 10000.0f) / 400.0f;
}

const char* chargeStateToString(uint8_t s) {
  switch (s) {
    case IDLE:    return "IDLE";
    case CC:      return "CC";
    case CV:      return "CV";
    case TRICKLE: return "TRICKLE";
    case MONITOR: return "MONITOR";
    default:      return "UNKNOWN";
  }
}

void stopCharging(const char* reason) {
  chargeState = IDLE;
  chargeDuty = 0.0f;
  setChargePwmDuty(0.0f);
  Serial.print("Charging Stopped: ");
  Serial.println(reason);
}

void startCharging() {
  chargeState = CC;
  chargeStartMillis = millis();
  chargeDuty = DUTY_MIN;
  setChargePwmDuty(chargeDuty);
  tempInit = false;
  dtdt_hit_count = 0;
  Serial.println("Charging Started (CC mode)");
}

void startMonitorMode() {
  chargeState = MONITOR;
  chargeDuty = 0.0f;
  setChargePwmDuty(0.0f);
  Serial.println("Monitoring Mode");
}

void updateChargeControl() {
  static unsigned long lastSample = 0;
  if (millis() - lastSample < SAMPLE_INTERVAL) return;
  lastSample = millis();

  g_curr = calcCurrent(g_vHigh, g_vLow);
  float T_raw = calcTemperature();

  if (!tempInit) {
    T_filt = T_raw;
    tempInit = true;
  } else {
    T_filt = T_ALPHA * T_filt + (1.0f - T_ALPHA) * T_raw;
  }
  g_temp = T_filt;

  tempHistory[tempHistIndex] = T_filt;
  tempHistIndex = (tempHistIndex + 1) % TEMP_HISTORY_MAX;
  if (tempHistIndex == 0) tempHistFilled = true;

  if (chargeState == CC || chargeState == CV || chargeState == TRICKLE) {
    g_vbat = readBatteryVoltage_quiet(chargeDuty);
  } else {
    g_vbat = readBatteryVoltage();
  }

  if (chargeState == CC || chargeState == CV || chargeState == TRICKLE) {
    if (g_curr > CRIT_CURRENT) { stopCharging("Over Current Critical"); return; }
    if (g_temp > TEMP_LIMIT)   { stopCharging("Over Temp"); return; }

    if (millis() - chargeStartMillis > DTDT_ARM_MS) {
      int samplesBack = (int)round((DTDT_WINDOW_SEC * 1000.0f) / (float)SAMPLE_INTERVAL);
      samplesBack = constrain(samplesBack, 1, TEMP_HISTORY_MAX - 1);

      bool havePast = tempHistFilled || (tempHistIndex >= samplesBack);
      if (havePast) {
        int pastIndex = (tempHistIndex - samplesBack + TEMP_HISTORY_MAX) % TEMP_HISTORY_MAX;
        float T_past = tempHistory[pastIndex];
        float deltaT = g_temp - T_past;
        float thres  = dtdtThresholdForWindow(DTDT_WINDOW_SEC);

        if (deltaT > thres) {
          dtdt_hit_count++;
          if (dtdt_hit_count >= DTDT_CONSEC_HITS) {
            stopCharging("Over dT/dt");
            return;
          }
        } else {
          dtdt_hit_count = 0;
        }
      }
    }

    if (millis() - chargeStartMillis > CHARGE_TIMEOUT_MS) {
      chargeState = TRICKLE;
      chargeDuty = TRICKLE_DUTY_MIN;
      setChargePwmDuty(chargeDuty);
      Serial.println("Timeout -> TRICKLE");
    }
  }

  if (chargeState == CC) {
    float errorI = TARGET_CURRENT - g_curr;
    chargeDuty += errorI * P_GAIN;

    if (g_curr > MAX_CURRENT) chargeDuty -= OCP_STEP;

    chargeDuty = constrain(chargeDuty, DUTY_MIN, DUTY_MAX);
    setChargePwmDuty(chargeDuty);

    batvBuffer[batvIndex] = g_vbat;
    batvIndex = (batvIndex + 1) % DELTA_V_WINDOW;
    if (batvIndex == 0) batvFilled = true;

    if (g_vbat >= V_CV_TARGET) {
      chargeState = CV;
      Serial.println("Enter CV mode");
    }

    if (batvFilled) {
      float avgNow = 0.0f;
      for (int i = 0; i < DELTA_V_WINDOW; ++i) avgNow += batvBuffer[i];
      avgNow /= DELTA_V_WINDOW;
      float past = batvBuffer[batvIndex];
      float dV = avgNow - past;

      if (dV < DELTA_V_THRESHOLD) {
        chargeState = TRICKLE;
        chargeDuty = TRICKLE_DUTY_MIN;
        setChargePwmDuty(chargeDuty);
        Serial.println("-ΔV detected -> TRICKLE");
      }
    }
  }
  else if (chargeState == CV) {
    float errorV = V_CV_TARGET - g_vbat;
    chargeDuty += errorV * V_GAIN_CV;
    chargeDuty = constrain(chargeDuty, DUTY_MIN, DUTY_MAX);

    if (g_curr > MAX_CURRENT) {
      chargeDuty -= OCP_STEP;
      chargeDuty = max(chargeDuty, DUTY_MIN);
    }

    setChargePwmDuty(chargeDuty);
  }
  else if (chargeState == TRICKLE) {
    float errorI = TRICKLE_CURRENT - g_curr;
    chargeDuty += errorI * (P_GAIN * 0.5f);
    chargeDuty = constrain(chargeDuty, TRICKLE_DUTY_MIN, TRICKLE_DUTY_MAX);

    if (g_vbat > V_CV_TARGET) {
      chargeDuty -= 0.01f;
      chargeDuty = max(chargeDuty, TRICKLE_DUTY_MIN);
    }

    setChargePwmDuty(chargeDuty);
  }
  else {
    chargeDuty = 0.0f;
    setChargePwmDuty(0.0f);
  }
}

// =====================================================
// HTTP補助
// =====================================================
String urlDecode(String s) {
  s.replace("%20", " ");
  return s;
}

String getQueryValue(const String& req, const String& key) {
  int qStart = req.indexOf("GET ");
  if (qStart < 0) return "";

  int pathStart = req.indexOf(' ', qStart) + 1;
  int pathEnd = req.indexOf(' ', pathStart);
  if (pathStart <= 0 || pathEnd <= 0) return "";

  String path = req.substring(pathStart, pathEnd);
  int qMark = path.indexOf('?');
  if (qMark < 0) return "";

  String query = path.substring(qMark + 1);
  String pattern = key + "=";
  int k = query.indexOf(pattern);
  if (k < 0) return "";

  int vStart = k + pattern.length();
  int amp = query.indexOf('&', vStart);
  String value = (amp >= 0) ? query.substring(vStart, amp) : query.substring(vStart);
  return urlDecode(value);
}

String normalizeMoveToCommand(String move) {
  move.toLowerCase();

  if (move == "forward") return "MOVE:FORWARD";
  if (move == "back")    return "MOVE:BACK";
  if (move == "left")    return "MOVE:LEFT";
  if (move == "right")   return "MOVE:RIGHT";
  if (move == "stop")    return "MOVE:STOP";
  if (move == "ping")    return "PING";

  return "";
}

void sendHttpResponse(
  WiFiClient& client,
  int statusCode,
  const char* statusText,
  const String& body,
  const char* contentType = "text/plain; charset=utf-8"
) {
  client.print("HTTP/1.1 ");
  client.print(statusCode);
  client.print(" ");
  client.println(statusText);

  client.println("Access-Control-Allow-Origin: *");
  client.println("Access-Control-Allow-Methods: GET, OPTIONS");
  client.println("Access-Control-Allow-Headers: Content-Type");
  client.println("Cache-Control: no-store");
  client.print("Content-Type: ");
  client.println(contentType);
  client.print("Content-Length: ");
  client.println(body.length());
  client.println("Connection: close");
  client.println();
  client.print(body);
}

String makeBatteryJson() {
  String body = "{";
  body += "\"state\":\"" + String(chargeStateToString(chargeState)) + "\",";
  body += "\"vbat\":" + String(g_vbat, 3) + ",";
  body += "\"current\":" + String(g_curr, 3) + ",";
  body += "\"temp\":" + String(g_temp, 2) + ",";
  body += "\"duty\":" + String(chargeDuty * 100.0f, 1) + ",";
  body += "\"target_current\":" + String(TARGET_CURRENT, 3) + ",";
  body += "\"max_current\":" + String(MAX_CURRENT, 3) + ",";
  body += "\"crit_current\":" + String(CRIT_CURRENT, 3) + ",";
  body += "\"dtwin_sec\":" + String(DTDT_WINDOW_SEC, 1);
  body += "}";
  return body;
}

void handleClient(WiFiClient& client) {
  String req;
  unsigned long start = millis();

  while (client.connected() && millis() - start < 1000) {
    while (client.available()) {
      char c = client.read();
      req += c;
      if (req.endsWith("\r\n\r\n")) goto REQUEST_DONE;
    }
  }

REQUEST_DONE:
  if (req.length() == 0) return;

  Serial.println("---- HTTP REQUEST ----");
  Serial.println(req);

  if (req.startsWith("OPTIONS ")) {
    sendHttpResponse(client, 204, "No Content", "");
    return;
  }

  if (req.startsWith("GET /ping ")) {
    sendHttpResponse(client, 200, "OK", "ACK:PONG");
    return;
  }

  if (req.startsWith("GET /status ")) {
    String body;
    body += "lastCommand=" + lastCommand + "\n";
    body += "lastResponse=" + lastResponse + "\n";
    body += "ip=" + WiFi.localIP().toString() + "\n";
    body += "chargeState=" + String(chargeStateToString(chargeState)) + "\n";
    body += "vbat=" + String(g_vbat, 3) + "\n";
    body += "current=" + String(g_curr, 3) + "\n";
    body += "temp=" + String(g_temp, 2) + "\n";
    sendHttpResponse(client, 200, "OK", body);
    return;
  }

  if (req.startsWith("GET /cmd?move=")) {
    String move = getQueryValue(req, "move");
    String cmd = normalizeMoveToCommand(move);

    if (cmd.length() == 0) {
      sendHttpResponse(client, 400, "Bad Request", "ERR:BAD_MOVE");
      return;
    }

    String result = executeDriveCommand(cmd);
    sendHttpResponse(client, 200, "OK", result);
    return;
  }

  if (req.startsWith("GET /battery/status ")) {
    sendHttpResponse(client, 200, "OK", makeBatteryJson(), "application/json; charset=utf-8");
    return;
  }

  if (req.startsWith("GET /battery/start ")) {
    startCharging();
    sendHttpResponse(client, 200, "OK", "ACK:BATTERY:START");
    return;
  }

  if (req.startsWith("GET /battery/stop ")) {
    stopCharging("HTTP Command");
    sendHttpResponse(client, 200, "OK", "ACK:BATTERY:STOP");
    return;
  }

  if (req.startsWith("GET /battery/monitor ")) {
    startMonitorMode();
    sendHttpResponse(client, 200, "OK", "ACK:BATTERY:MONITOR");
    return;
  }

  if (req.startsWith("GET /battery/set?")) {
    String tc = getQueryValue(req, "target_current");
    String dt = getQueryValue(req, "dtwin_sec");

    if (tc.length() > 0) {
      float val = tc.toFloat();
      if (val >= 0.05f && val <= 1.0f) {
        TARGET_CURRENT = val;
      }
    }

    if (dt.length() > 0) {
      float val = dt.toFloat();
      if (val >= 1.0f && val <= 60.0f) {
        DTDT_WINDOW_SEC = val;
      }
    }

    sendHttpResponse(client, 200, "OK", makeBatteryJson(), "application/json; charset=utf-8");
    return;
  }

  if (req.startsWith("GET / ")) {
    String body;
    body += "PicoW Robot + Charger Server\n";
    body += "IP: " + WiFi.localIP().toString() + "\n";
    body += "/ping\n";
    body += "/status\n";
    body += "/cmd?move=forward|back|left|right|stop\n";
    body += "/battery/status\n";
    body += "/battery/start\n";
    body += "/battery/stop\n";
    body += "/battery/monitor\n";
    body += "/battery/set?target_current=0.30&dtwin_sec=10\n";
    sendHttpResponse(client, 200, "OK", body);
    return;
  }

  sendHttpResponse(client, 404, "Not Found", "ERR:NOT_FOUND");
}

// =====================================================
// Wi-Fi
// =====================================================
void connectWiFi() {
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - start > 20000) {
      Serial.println("\nWi-Fi connect timeout, retry...");
      Serial.println(WIFI_SSID);
      Serial.println(WIFI_PASS);
      WiFi.disconnect();
      delay(1000);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      start = millis();
    }
  }

  Serial.println();
  Serial.println("Wi-Fi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

// =====================================================
// setup / loop
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  // 走行ピン
  pinMode(L_IN1, OUTPUT);
  pinMode(L_IN2, OUTPUT);
  pinMode(R_IN1, OUTPUT);
  pinMode(R_IN2, OUTPUT);

  analogWriteFreq(20000);
  analogWriteRange(255);
  stopAllDrive();

  // 充電系
  analogReadResolution(12);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  setupPwm20k(PWM_PIN);
  setChargePwmDuty(0.0f);

  float vbat0 = readBatteryVoltage();
  for (int i = 0; i < DELTA_V_WINDOW; ++i) batvBuffer[i] = vbat0;
  batvIndex = 0;
  batvFilled = false;

  float t0 = calcTemperature();
  T_filt = t0;
  g_temp = t0;
  g_vbat = vbat0;
  for (int i = 0; i < TEMP_HISTORY_MAX; ++i) tempHistory[i] = T_filt;
  tempHistIndex = 0;
  tempHistFilled = false;

  if (vbat0 > BAT_START_VOLTAGE) {
    stopCharging("Over Voltage at Start");
  }

  connectWiFi();
  server.begin();

  Serial.println("HTTP server started");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi disconnected. Reconnecting...");
    connectWiFi();
  }

  updateChargeControl();

  WiFiClient client = server.available();
  if (client) {
    handleClient(client);
    delay(1);
    client.stop();
  }
}
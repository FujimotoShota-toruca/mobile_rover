import { normalizeGpsPosition, round } from "./protocol.js";

export class VehicleMedia {
  constructor({ onStatus = () => {} } = {}) {
    this.onStatus = onStatus;
    this.stream = null;
    this.geoWatchId = null;
    this.latestGps = null;
    this.latestImu = null;
    this.motionHandler = null;
  }

  async requestPermissions() {
    if (!window.isSecureContext) {
      throw new Error("HTTPS で開いてください");
    }

    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        this.onStatus(`DeviceMotion permission: ${result}`);
      } catch (error) {
        this.onStatus(`DeviceMotion permission failed: ${error.message}`);
      }
    }
  }

  async startCamera(videoElement = null) {
    if (this.stream) {
      if (videoElement) videoElement.srcObject = this.stream;
      return this.stream;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 }
      },
      audio: false
    });

    if (videoElement) videoElement.srcObject = this.stream;
    return this.stream;
  }

  startSensors() {
    if (navigator.geolocation && this.geoWatchId == null) {
      this.geoWatchId = navigator.geolocation.watchPosition(
        (position) => {
          this.latestGps = normalizeGpsPosition(position);
        },
        (error) => {
          this.onStatus(`GPS watch error: ${error.message}`);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 1000
        }
      );
    }

    if (!this.motionHandler) {
      this.motionHandler = (event) => {
        const accel = event.accelerationIncludingGravity || {};
        const rot = event.rotationRate || {};
        this.latestImu = {
          ax: round(accel.x ?? 0, 3),
          ay: round(accel.y ?? 0, 3),
          az: round(accel.z ?? 0, 3),
          alpha: round(rot.alpha ?? 0, 3),
          beta: round(rot.beta ?? 0, 3),
          gamma: round(rot.gamma ?? 0, 3)
        };
      };
      window.addEventListener("devicemotion", this.motionHandler);
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    if (this.motionHandler) {
      window.removeEventListener("devicemotion", this.motionHandler);
      this.motionHandler = null;
    }
  }

  snapshot() {
    return {
      gps: this.latestGps,
      imu: this.latestImu,
      ts: Date.now()
    };
  }
}

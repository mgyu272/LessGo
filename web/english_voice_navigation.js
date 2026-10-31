(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LessGoEnglishNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EARTH_RADIUS_M = 6_371_000;
  const METERS_PER_DEGREE = 111_320;
  const MANEUVER_TEXT = {
    straight: "continue straight",
    left: "turn left",
    right: "turn right",
    sharp_left: "turn sharp left",
    sharp_right: "turn sharp right",
    slight_left: "turn slightly left",
    slight_right: "turn slightly right",
    keep_left: "keep left",
    keep_right: "keep right",
    u_turn: "make a U-turn",
    roundabout_enter: "enter the roundabout",
    roundabout_exit: "exit the roundabout",
  };

  function distanceMeters(a, b) {
    const lat1 = Number(a[1]) * Math.PI / 180;
    const lat2 = Number(b[1]) * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLon = (Number(b[0]) - Number(a[0])) * Math.PI / 180;
    const hav = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(Math.max(0, 1 - hav)));
  }

  function projectToSegment(point, left, right) {
    const latRef = (Number(left[1]) + Number(right[1]) + Number(point[1])) / 3 * Math.PI / 180;
    const xScale = METERS_PER_DEGREE * Math.cos(latRef);
    const yScale = METERS_PER_DEGREE;
    const px = (Number(point[0]) - Number(left[0])) * xScale;
    const py = (Number(point[1]) - Number(left[1])) * yScale;
    const bx = (Number(right[0]) - Number(left[0])) * xScale;
    const by = (Number(right[1]) - Number(left[1])) * yScale;
    const denom = bx * bx + by * by;
    const t = denom === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / denom));
    const x = bx * t;
    const y = by * t;
    return {
      t,
      distanceM: Math.hypot(px - x, py - y),
      coordinate: [Number(left[0]) + (Number(right[0]) - Number(left[0])) * t,
        Number(left[1]) + (Number(right[1]) - Number(left[1])) * t],
    };
  }

  class RouteGuidanceEngine {
    constructor(routeData, options = {}) {
      this.options = { maxUsableAccuracyM: 80, arrivalRadiusM: 30, ...options };
      this.setRoute(routeData);
    }

    setRoute(routeData) {
      this.route = routeData || null;
      this.coordinates = Array.isArray(routeData?.coordinates) ? routeData.coordinates : [];
      this.cumulativeM = [0];
      for (let i = 1; i < this.coordinates.length; i += 1) {
        this.cumulativeM.push(this.cumulativeM[i - 1] + distanceMeters(this.coordinates[i - 1], this.coordinates[i]));
      }
      this.totalDistanceM = this.cumulativeM.at(-1) || 0;
      this.maneuvers = Array.isArray(routeData?.maneuvers)
        ? routeData.maneuvers.filter(item => Number.isFinite(Number(item.chainage_m))
          && MANEUVER_TEXT[item.turn]).map(item => ({ ...item, chainage_m: Number(item.chainage_m) }))
          .sort((a, b) => a.chainage_m - b.chainage_m)
        : [];
      this.reset();
    }

    reset() {
      this.progressM = 0;
      this.hasPosition = false;
      this.previousManeuverDistances = new Map();
      this.announced = new Set();
      this.offRouteFixes = 0;
      this.backOnRouteFixes = 0;
      this.offRouteAlerted = false;
      this.arrivalFixes = 0;
      this.arrivalAnnounced = false;
    }

    get supported() {
      return Boolean(this.route?.supported && this.coordinates.length >= 2 && this.maneuvers.length);
    }

    _nearestProjection(point, accuracyM) {
      const backwardWindow = this.hasPosition ? 18 : 0;
      const forwardWindow = this.hasPosition ? Math.max(150, accuracyM * 3) : Math.max(220, accuracyM * 3);
      const minChainage = Math.max(0, this.progressM - backwardWindow);
      const maxChainage = Math.min(this.totalDistanceM, this.progressM + forwardWindow);
      let best = null;
      for (let i = 0; i < this.coordinates.length - 1; i += 1) {
        const startM = this.cumulativeM[i];
        const endM = this.cumulativeM[i + 1];
        if (endM < minChainage || startM > maxChainage) continue;
        const projected = projectToSegment(point, this.coordinates[i], this.coordinates[i + 1]);
        const chainageM = startM + (endM - startM) * projected.t;
        if (chainageM < minChainage || chainageM > maxChainage) continue;
        if (!best || projected.distanceM < best.distanceM
            || (Math.abs(projected.distanceM - best.distanceM) < 1.5 && chainageM > best.chainageM)) {
          best = { ...projected, chainageM };
        }
      }
      return best;
    }

    _nextManeuver() {
      return this.maneuvers.find(item => item.chainage_m > this.progressM + 1
        && !this.announced.has(`${item.id}:now`)) || null;
    }

    _phrase(maneuver) {
      return MANEUVER_TEXT[maneuver.turn] || null;
    }

    _maneuverEvent(maneuver, remainingM) {
      const key = `${maneuver.id}:`;
      const phrase = this._phrase(maneuver);
      if (!phrase) return null;
      if (maneuver.turn === "straight") {
        const nextTurn = this.maneuvers.find(item => item.chainage_m > maneuver.chainage_m
          && item.turn !== "straight");
        if (nextTurn && nextTurn.chainage_m - maneuver.chainage_m < 60) return null;
        if (remainingM <= 40 && !this.announced.has(`${key}straight`)) {
          this.announced.add(`${key}straight`);
          return { id: `${maneuver.id}:straight`, text: "Continue straight." };
        }
        return null;
      }
      if (remainingM <= 12 && !this.announced.has(`${key}now`)) {
        this.announced.add(`${key}now`);
        return { id: `${maneuver.id}:now`, text: `${phrase[0].toUpperCase()}${phrase.slice(1)} now.` };
      }
      if (remainingM <= 40 && !this.announced.has(`${key}40`)) {
        this.announced.add(`${key}40`);
          return { id: `${maneuver.id}:40`, text: `In forty meters, ${phrase}.` };
      }
      if (remainingM <= 100 && remainingM > 40 && !this.announced.has(`${key}100`)) {
        this.announced.add(`${key}100`);
        return { id: `${maneuver.id}:100`, text: `In one hundred meters, ${phrase}.` };
      }
      return null;
    }

    updatePosition(latitude, longitude, accuracyM) {
      const lat = Number(latitude);
      const lon = Number(longitude);
      const accuracy = Number(accuracyM);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(accuracy)
          || lat < -90 || lat > 90 || lon < -180 || lon > 180 || accuracy < 0) {
        return { accepted: false, status: "Waiting for a valid GPS position.", events: [] };
      }
      if (!this.supported) {
        return { accepted: false, status: this.route?.reason || "Turn-by-turn directions are not available for this route.", events: [] };
      }
      if (accuracy > this.options.maxUsableAccuracyM) {
        return { accepted: false, status: "GPS accuracy is too low; waiting for a clearer position.", accuracyM: accuracy, events: [] };
      }

      const point = [lon, lat];
      const projection = this._nearestProjection(point, accuracy);
      if (!projection) {
        return { accepted: false, status: "Unable to match this position to the route yet.", accuracyM: accuracy, events: [] };
      }
      const progressBefore = this.progressM;
      this.progressM = Math.max(this.progressM, projection.chainageM);
      this.hasPosition = true;

      const offRouteThresholdM = Math.max(30, Math.min(80, accuracy * 1.5));
      let events = [];
      if (projection.distanceM > offRouteThresholdM) {
        this.offRouteFixes += 1;
        this.backOnRouteFixes = 0;
        if (this.offRouteFixes >= 3 && !this.offRouteAlerted) {
          this.offRouteAlerted = true;
          events.push({ id: "off-route", text: "You are off the route." });
        }
      } else {
        this.offRouteFixes = 0;
        if (this.offRouteAlerted) {
          this.backOnRouteFixes += 1;
          if (this.backOnRouteFixes >= 2) {
            this.offRouteAlerted = false;
            this.backOnRouteFixes = 0;
          }
        }
      }

      const end = this.coordinates[this.coordinates.length - 1];
      const distanceToEndM = distanceMeters(point, end);
      const remainingRouteM = Math.max(0, this.totalDistanceM - this.progressM);
      const arrivalThresholdM = Math.max(this.options.arrivalRadiusM, Math.min(50, accuracy * 1.5));
      if (remainingRouteM <= 25 && distanceToEndM <= arrivalThresholdM) this.arrivalFixes += 1;
      else this.arrivalFixes = 0;

      if (this.arrivalFixes >= 3 && !this.arrivalAnnounced) {
        this.arrivalAnnounced = true;
        events = [{ id: "arrived", text: "You have arrived at your destination." }];
      } else if (projection.distanceM <= offRouteThresholdM && !this.offRouteAlerted) {
        const next = this._nextManeuver();
        if (next) {
          const remaining = Math.max(0, next.chainage_m - this.progressM);
          const event = this._maneuverEvent(next, remaining);
          if (event) events.push(event);
        }
      }

      const next = this._nextManeuver();
      const remainingToManeuverM = next ? Math.max(0, next.chainage_m - this.progressM) : null;
      return {
        accepted: true,
        status: this.arrivalAnnounced ? "Destination reached." : this.offRouteAlerted ? "Off route." : "On route.",
        position: { latitude: lat, longitude: lon },
        accuracyM: accuracy,
        distanceFromRouteM: Math.round(projection.distanceM),
        progressM: Math.round(this.progressM),
        progressDeltaM: Math.round(this.progressM - progressBefore),
        remainingRouteM: Math.round(remainingRouteM),
        nextManeuver: next,
        remainingToManeuverM: remainingToManeuverM == null ? null : Math.round(remainingToManeuverM),
        events,
      };
    }
  }

  class EnglishVoiceNavigation {
    constructor(options = {}) {
      this.onUpdate = options.onUpdate || function () {};
      this.onError = options.onError || function () {};
      this.geolocation = options.geolocation || (typeof navigator !== "undefined" ? navigator.geolocation : null);
      this.speechSynthesis = options.speechSynthesis || (typeof window !== "undefined" ? window.speechSynthesis : null);
      this.Utterance = options.Utterance || (typeof window !== "undefined" ? window.SpeechSynthesisUtterance : null);
      this.setIntervalFn = options.setIntervalFn || ((callback, delay) => setInterval(callback, delay));
      this.clearIntervalFn = options.clearIntervalFn || (timerId => clearInterval(timerId));
      this.engine = null;
      this.route = null;
      this.watchId = null;
      this.simulationTimer = null;
      this.simulationDistanceM = 0;
      this.simulationSpeedMultiplier = 1;
      this.running = false;
      this.voiceEnabled = true;
      this.lastUpdate = null;
    }

    setRoute(routeData) {
      this.stop();
      this.route = routeData || null;
      this.engine = routeData ? new RouteGuidanceEngine(routeData) : null;
      this.simulationDistanceM = 0;
      this.lastUpdate = null;
      this.onUpdate({ status: routeData?.supported ? "Route ready." : routeData?.reason || "No supported directions for this route.",
        supported: Boolean(this.engine?.supported), running: false, reset: true });
      return Boolean(this.engine?.supported);
    }

    setVoiceEnabled(enabled) {
      this.voiceEnabled = Boolean(enabled);
      if (!this.voiceEnabled) this._cancelSpeech();
      this.onUpdate({ status: this.voiceEnabled ? "English voice on." : "English voice off.", voiceEnabled: this.voiceEnabled });
    }

    start(options = {}) {
      if (!this.engine?.supported) {
        const error = this.route?.reason || "Saved ORS turn instructions are not available for this route.";
        this.onError(error);
        return false;
      }
      this.stop();
      this.running = true;
      this.voiceEnabled = options.voiceEnabled !== false;
      if (options.mode === "simulation") {
        this.simulationDistanceM = 0;
        this.simulationSpeedMultiplier = Math.max(0.5, Number(options.speedMultiplier) || 1);
        this.simulationTimer = this.setIntervalFn(() => this._simulationTick(), 1000);
        this.onUpdate({ status: "Simulation running.", running: true, mode: "simulation" });
        this._simulationTick();
        return true;
      }
      if (!this.geolocation?.watchPosition) {
        this.running = false;
        this.onError("GPS is unavailable in this browser. Use localhost or HTTPS, or select simulation mode.");
        return false;
      }
      try {
        this.watchId = this.geolocation.watchPosition(
          position => this._handlePosition(position.coords.latitude, position.coords.longitude, position.coords.accuracy),
          error => {
            const explanation = error?.code === 1 ? "Location permission was denied. Allow location access or use simulation mode."
              : error?.code === 2 ? "The device could not determine its location."
                : "GPS location timed out.";
            this.onError(explanation);
            this.onUpdate({ status: explanation, running: this.running, mode: "gps" });
          },
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
        );
        this.onUpdate({ status: "Waiting for GPS location.", running: true, mode: "gps" });
        return true;
      } catch (error) {
        this.running = false;
        this.onError(error?.message || "Could not start GPS.");
        return false;
      }
    }

    stop() {
      this.running = false;
      if (this.watchId != null) {
        try { this.geolocation?.clearWatch?.(this.watchId); } catch (_) {}
        this.watchId = null;
      }
      if (this.simulationTimer != null) {
        this.clearIntervalFn(this.simulationTimer);
        this.simulationTimer = null;
      }
      this._cancelSpeech();
      if (this.engine) this.engine.reset();
      this.simulationDistanceM = 0;
      this.lastUpdate = null;
      this.onUpdate({ status: "Navigation stopped.", running: false, stopped: true });
    }

    _cancelSpeech() {
      try { this.speechSynthesis?.cancel?.(); } catch (_) {}
    }

    _speak(text) {
      if (!this.voiceEnabled || !this.speechSynthesis?.speak || !this.Utterance || !this.running) return false;
      this._cancelSpeech(); // Replace any unfinished speech rather than queueing stale directions.
      const utterance = new this.Utterance(String(text));
      utterance.lang = "en-US";
      utterance.rate = 1;
      utterance.pitch = 1;
      this.speechSynthesis.speak(utterance);
      return true;
    }

    _handlePosition(latitude, longitude, accuracyM) {
      if (!this.running || !this.engine) return;
      const state = this.engine.updatePosition(latitude, longitude, accuracyM);
      this.lastUpdate = state;
      for (const event of state.events || []) this._speak(event.text);
      this.onUpdate({ ...state, running: this.running });
      if (state.status === "Destination reached.") {
        this.running = false;
        if (this.watchId != null) this.geolocation?.clearWatch?.(this.watchId);
        this.watchId = null;
        if (this.simulationTimer != null) this.clearIntervalFn(this.simulationTimer);
        this.simulationTimer = null;
        this.onUpdate({ ...state, status: "Destination reached.", running: false });
      }
    }

    _simulationTick() {
      if (!this.running || !this.engine?.supported) return;
      this.simulationDistanceM = Math.min(this.engine.totalDistanceM,
        this.simulationDistanceM + 2.8 * this.simulationSpeedMultiplier);
      const target = this.simulationDistanceM;
      let index = 0;
      while (index < this.engine.cumulativeM.length - 2 && this.engine.cumulativeM[index + 1] < target) index += 1;
      const startM = this.engine.cumulativeM[index];
      const endM = this.engine.cumulativeM[index + 1];
      const t = endM === startM ? 0 : Math.max(0, Math.min(1, (target - startM) / (endM - startM)));
      const left = this.engine.coordinates[index];
      const right = this.engine.coordinates[index + 1];
      const lon = Number(left[0]) + (Number(right[0]) - Number(left[0])) * t;
      const lat = Number(left[1]) + (Number(right[1]) - Number(left[1])) * t;
      this._handlePosition(lat, lon, 4);
    }
  }

  return { RouteGuidanceEngine, EnglishVoiceNavigation, distanceMeters };
});

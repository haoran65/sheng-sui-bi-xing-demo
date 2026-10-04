(function (global) {
  'use strict';

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
  const smootherstep = (value) => {
    const x = clamp(value);
    return 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3;
  };
  const median = (values, fallback) => {
    if (!values.length) return fallback;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const logisticRatio = (value, baseline) => {
    const epsilon = 0.001;
    const ratio = Math.log((Math.max(0, value) + epsilon) / (Math.max(epsilon, baseline) + epsilon));
    return 1 / (1 + Math.exp(-2.2 * ratio));
  };

  const DEFAULT_BASELINE = Object.freeze({
    textRate: 55,
    keyRate: 180,
    flightMs: 170,
    dwellMs: 100,
  });
  const BASELINE_KEY = 'sonata-typing-baseline-v2';

  class PredictiveConductor {
    constructor({ clock = () => Date.now(), storage = global.localStorage,
      baselineKey = BASELINE_KEY, baseline = {} } = {}) {
      this.clock = clock;
      this.storage = storage;
      this.baselineKey = baselineKey;
      this.baseline = { ...DEFAULT_BASELINE, ...baseline };
      this.baselineSamples = 0;
      this.loadBaseline();

      this.textEvents = [];
      this.keyEvents = [];
      this.flightEvents = [];
      this.dwellEvents = [];
      this.activeDownTimes = [];
      this.lastKeyUpAt = null;
      this.activeSeconds = new Set();
      this.calibrationActiveSeconds = new Set();
      this.totalValidKeys = 0;
      this.learningSamples = [];

      this.firstEditAt = null;
      this.lastEditAt = null;
      this.lastSampleAt = clock();
      this.lastBaselineUpdateAt = this.lastSampleAt;
      this.hidden = false;
      this.demoMode = null;
      this.demoPauseSeconds = 0;

      this.level = 0.5;
      this.trend = 0;
      this.forecast = 0.5;
      this.energy = 0.5;
      this.velocity = 0;
      this.pauseHoldForecast = null;
      this.pauseProtectedEnergy = null;
      this.snapshot = this.makeSnapshot(this.emptyMetrics(), 0, 0);
    }

    get charge() { return this.energy; }
    set charge(value) { this.energy = clamp(value); }

    loadBaseline() {
      try {
        const parsed = JSON.parse(this.storage?.getItem(this.baselineKey) || 'null');
        if (!parsed || parsed.format !== 'typing-baseline/1') return;
        for (const key of Object.keys(DEFAULT_BASELINE)) {
          if (Number.isFinite(Number(parsed.values?.[key]))) this.baseline[key] = Number(parsed.values[key]);
        }
        this.baselineSamples = Math.max(0, Number(parsed.samples) || 0);
      } catch { /* Local calibration is optional. */ }
    }

    saveBaseline() {
      try {
        this.storage?.setItem(this.baselineKey, JSON.stringify({
          format: 'typing-baseline/1',
          values: { ...this.baseline },
          samples: this.baselineSamples,
          updatedAt: new Date(this.clock()).toISOString(),
        }));
        return true;
      } catch { return false; }
    }

    resetBaseline() {
      this.baseline = { ...DEFAULT_BASELINE };
      this.baselineSamples = 0;
      this.learningSamples = [];
      this.calibrationActiveSeconds = new Set();
      this.totalValidKeys = 0;
      this.lastBaselineUpdateAt = this.clock();
      try { this.storage?.removeItem(this.baselineKey); } catch { /* Optional storage. */ }
      return { ...this.baseline };
    }

    noteActivity(now) {
      if (this.demoMode) this.setDemoMode(null);
      this.firstEditAt ??= now;
      this.lastEditAt = now;
      this.activeSeconds.add(Math.floor(now / 1000));
      this.calibrationActiveSeconds.add(Math.floor(now / 1000));
    }

    record({ characters = 0, pasted = false, deleted = false } = {}) {
      const now = this.clock();
      if (pasted) {
        this.textEvents.push({ time: now, units: 0, kind: 'paste' });
        this.trimEvents(now);
        return;
      }
      const count = Math.max(1, Math.min(Math.abs(Number(characters) || 0), 32));
      this.noteActivity(now);
      this.textEvents.push({
        time: now,
        units: deleted ? 0.35 * count : count,
        kind: deleted ? 'delete' : 'insert',
      });
      this.trimEvents(now);
    }

    recordKeyDown({ repeat = false, ignored = false } = {}) {
      if (repeat || ignored) return false;
      const now = this.clock();
      this.noteActivity(now);
      this.keyEvents.push({ time: now });
      this.activeDownTimes.push(now);
      if (this.lastKeyUpAt !== null) {
        const flightMs = now - this.lastKeyUpAt;
        if (flightMs >= 0 && flightMs <= 2500) this.flightEvents.push({ time: now, value: flightMs });
      }
      this.totalValidKeys += 1;
      this.trimEvents(now);
      return true;
    }

    recordKeyUp({ ignored = false } = {}) {
      if (ignored || !this.activeDownTimes.length) return false;
      const now = this.clock();
      const downAt = this.activeDownTimes.shift();
      const dwellMs = now - downAt;
      if (dwellMs >= 12 && dwellMs <= 2500) this.dwellEvents.push({ time: now, value: dwellMs });
      this.lastKeyUpAt = now;
      this.trimEvents(now);
      return true;
    }

    trimEvents(now) {
      const cutoff = now - 60000;
      for (const name of ['textEvents', 'keyEvents', 'flightEvents', 'dwellEvents']) {
        this[name] = this[name].filter((event) => event.time >= cutoff);
      }
      const activeCutoff = Math.floor(cutoff / 1000);
      for (const second of this.activeSeconds) if (second < activeCutoff) this.activeSeconds.delete(second);
      this.activeDownTimes = this.activeDownTimes.filter((time) => time >= now - 2500);
    }

    emptyMetrics() {
      return {
        textRate: 0,
        keyRate: 0,
        flightMs: this.baseline.flightMs,
        dwellMs: this.baseline.dwellMs,
        continuity: 0,
        deleteRatio: 0,
        validKeys: 0,
        normalized: { textRate: 0.5, keyRate: 0.5, flightMs: 0.5, dwellMs: 0.5,
          speed: 0.5, continuity: 0, observation: 0.5 },
      };
    }

    metricsAt(now) {
      this.trimEvents(now);
      const recentText = this.textEvents.filter((event) => now - event.time <= 15000);
      const recentKeys = this.keyEvents.filter((event) => now - event.time <= 8000);
      const recentFlight = this.flightEvents.filter((event) => now - event.time <= 12000);
      const recentDwell = this.dwellEvents.filter((event) => now - event.time <= 12000);
      const recentActivity = this.keyEvents.filter((event) => now - event.time <= 30000);
      const recentEdits = this.textEvents.filter((event) => now - event.time <= 30000
        && event.kind !== 'paste');
      const textRate = recentText.reduce((sum, event) => sum + event.units, 0) * 4;
      const keyRate = recentKeys.length * 7.5;
      const flightMs = median(recentFlight.map((event) => event.value), this.baseline.flightMs);
      const dwellMs = median(recentDwell.map((event) => event.value), this.baseline.dwellMs);
      const activeBins = new Set(recentActivity.map((event) => Math.floor(event.time / 1000)));
      for (const event of this.textEvents) {
        if (now - event.time <= 30000 && event.kind !== 'paste') activeBins.add(Math.floor(event.time / 1000));
      }
      const continuity = clamp(activeBins.size / 30);
      const deletions = recentEdits.filter((event) => event.kind === 'delete').length;
      const deleteRatio = recentEdits.length ? deletions / recentEdits.length : 0;

      const normalized = {
        textRate: logisticRatio(textRate, this.baseline.textRate),
        keyRate: logisticRatio(keyRate, this.baseline.keyRate),
        flightMs: 1 - logisticRatio(flightMs, this.baseline.flightMs),
        dwellMs: 1 - logisticRatio(dwellMs, this.baseline.dwellMs),
        continuity,
      };
      normalized.speed = 0.55 * normalized.textRate + 0.45 * normalized.keyRate;
      normalized.observation = clamp(0.50 * normalized.speed
        + 0.20 * normalized.flightMs
        + 0.08 * normalized.dwellMs
        + 0.22 * continuity);
      return { textRate, keyRate, flightMs, dwellMs, continuity, deleteRatio,
        validKeys: recentKeys.length, normalized };
    }

    confidenceFor(metrics, now) {
      const keys30 = this.keyEvents.filter((event) => now - event.time <= 30000).length;
      const textUnits30 = this.textEvents.filter((event) => now - event.time <= 30000)
        .reduce((sum, event) => sum + (event.kind === 'insert' ? event.units : 0), 0);
      const keyEvidence = clamp((keys30 + Math.min(12, textUnits30) * 0.25) / 24);
      const coverage = clamp(metrics.continuity / 0.20);
      const deletePenalty = 1 - 0.15 * smootherstep((metrics.deleteRatio - 0.45) / 0.45);
      return clamp((0.65 * keyEvidence + 0.35 * coverage) * deletePenalty);
    }

    updateHolt(observation, confidence, elapsedSeconds) {
      if (confidence < 0.05) {
        this.trend *= Math.exp(-elapsedSeconds / 4);
        this.forecast = clamp(this.level + 6 * this.trend);
        return;
      }
      const dt = Math.max(0.001, elapsedSeconds);
      const alpha = 1 - (1 - 0.22 * confidence) ** dt;
      const beta = 1 - (1 - 0.08 * confidence) ** dt;
      const previousLevel = this.level;
      const nextLevel = alpha * observation + (1 - alpha) * (this.level + this.trend * dt);
      const observedTrend = (nextLevel - previousLevel) / dt;
      this.level = clamp(nextLevel);
      this.trend = clamp(beta * observedTrend + (1 - beta) * this.trend, -0.035, 0.035);
      this.forecast = clamp(this.level + 6 * this.trend);
    }

    advanceSecondOrder(target, elapsedSeconds) {
      if (!(elapsedSeconds > 0)) return;
      const q0 = this.energy;
      const v0 = this.velocity;
      const u = clamp(target);
      const t90 = u >= q0 ? 18 : 30;
      const omega = 3.89 / t90;
      const x0 = q0 - u;
      const c = v0 + omega * x0;
      const decay = Math.exp(-omega * elapsedSeconds);
      const x1 = (x0 + c * elapsedSeconds) * decay;
      let v1 = (v0 - omega * c * elapsedSeconds) * decay;
      let q1 = u + x1;
      if ((x0 < 0 && x1 > 0) || (x0 > 0 && x1 < 0)) {
        q1 = u;
        v1 = 0;
      }
      if (q1 <= 0 || q1 >= 1) v1 = 0;
      this.energy = clamp(q1);
      this.velocity = Number.isFinite(v1) ? v1 : 0;
    }

    updateBaseline(metrics, now) {
      if (this.firstEditAt === null || this.totalValidKeys < 120
        || this.calibrationActiveSeconds.size < 180) return;
      this.learningSamples.push({
        textRate: metrics.textRate,
        keyRate: metrics.keyRate,
        flightMs: metrics.flightMs,
        dwellMs: metrics.dwellMs,
      });
      this.learningSamples = this.learningSamples.slice(-30);
      if (now - this.lastBaselineUpdateAt < 30000 || this.learningSamples.length < 5) return;
      const bounds = {
        textRate: [15, 240], keyRate: [45, 720], flightMs: [25, 900], dwellMs: [35, 420],
      };
      for (const key of Object.keys(DEFAULT_BASELINE)) {
        const robust = median(this.learningSamples.map((sample) => sample[key]), this.baseline[key]);
        const bounded = Math.max(bounds[key][0], Math.min(bounds[key][1], robust));
        this.baseline[key] = this.baseline[key] * 0.95 + bounded * 0.05;
      }
      this.baselineSamples += 1;
      this.lastBaselineUpdateAt = now;
      this.saveBaseline();
    }

    setVisibility(hidden) {
      this.hidden = Boolean(hidden);
      this.lastSampleAt = this.clock();
      if (this.hidden) this.velocity = 0;
    }

    setDemoMode(mode) {
      if (mode !== null && mode !== 'flow' && mode !== 'pause') throw new Error('Unknown demo mode');
      this.demoMode = mode;
      this.demoPauseSeconds = 0;
      this.pauseHoldForecast = null;
      this.pauseProtectedEnergy = null;
      this.lastSampleAt = this.clock();
    }

    makeSnapshot(metrics, confidence, pauseSeconds) {
      const tempoScale = 0.9 + 0.2 * smootherstep(this.energy);
      return {
        format: 'typing-dynamics/2',
        raw: {
          textRate: metrics.textRate,
          keyRate: metrics.keyRate,
          flightMs: metrics.flightMs,
          dwellMs: metrics.dwellMs,
          continuity: metrics.continuity,
          deleteRatio: metrics.deleteRatio,
          validKeys: metrics.validKeys,
        },
        normalized: { ...metrics.normalized },
        level: this.level,
        trend: this.trend,
        forecast: this.forecast,
        confidence,
        energy: this.energy,
        charge: this.energy,
        pauseSeconds,
        targetBpm: 72 * tempoScale,
        baseline: { ...this.baseline },
        calibration: {
          ready: this.totalValidKeys >= 120 && this.calibrationActiveSeconds.size >= 180,
          activeSeconds: this.calibrationActiveSeconds.size,
          validKeys: this.totalValidKeys,
          samples: this.baselineSamples,
        },
      };
    }

    applyPausePolicy(pauseSeconds, elapsedSeconds) {
      if (this.pauseHoldForecast === null) this.pauseHoldForecast = this.forecast;
      if (this.pauseProtectedEnergy === null) {
        this.pauseProtectedEnergy = this.energy;
        this.velocity = 0;
      }
      this.trend *= Math.exp(-Math.max(0, elapsedSeconds) / 4);
      if (pauseSeconds <= 12) {
        this.forecast = this.pauseHoldForecast;
      } else if (pauseSeconds < 40) {
        const amount = smootherstep((pauseSeconds - 12) / 28);
        this.forecast = this.pauseHoldForecast + (0.05 - this.pauseHoldForecast) * amount;
      } else {
        this.forecast = 0.05;
      }
    }

    sample() {
      const now = this.clock();
      const elapsedSeconds = Math.max(0, (now - this.lastSampleAt) / 1000);
      this.lastSampleAt = now;
      if (this.hidden) return this.snapshot;
      const stepSeconds = Math.min(2, elapsedSeconds);

      if (this.demoMode) {
        const virtualSeconds = Math.max(1, stepSeconds * 4);
        const metrics = this.emptyMetrics();
        metrics.normalized.observation = this.demoMode === 'flow' ? 0.88 : 0.12;
        metrics.continuity = this.demoMode === 'flow' ? 0.9 : 0;
        metrics.normalized.continuity = metrics.continuity;
        if (this.demoMode === 'flow') {
          this.pauseHoldForecast = null;
          this.pauseProtectedEnergy = null;
          this.updateHolt(0.88, 1, virtualSeconds);
        } else {
          this.demoPauseSeconds += virtualSeconds;
          this.applyPausePolicy(this.demoPauseSeconds, virtualSeconds);
        }
        const target = this.demoMode === 'pause' && this.demoPauseSeconds <= 12
          ? (this.pauseProtectedEnergy ?? this.energy) : this.forecast;
        this.advanceSecondOrder(target, virtualSeconds);
        if (this.demoMode === 'pause' && this.demoPauseSeconds > 12
          && this.pauseProtectedEnergy !== null) {
          const release = smootherstep((this.demoPauseSeconds - 12) / 28);
          this.energy = Math.min(this.energy, this.pauseProtectedEnergy
            + (0.05 - this.pauseProtectedEnergy) * release);
        }
        this.snapshot = this.makeSnapshot(metrics, 1, this.demoPauseSeconds);
        return this.snapshot;
      }

      const metrics = this.metricsAt(now);
      if (this.firstEditAt === null) {
        this.snapshot = this.makeSnapshot(metrics, 0, 0);
        return this.snapshot;
      }
      const pauseSeconds = this.lastEditAt === null ? Infinity : Math.max(0, (now - this.lastEditAt) / 1000);
      const confidence = this.confidenceFor(metrics, now);
      let target;
      if (pauseSeconds <= 2) {
        this.pauseHoldForecast = null;
        this.pauseProtectedEnergy = null;
        this.updateHolt(metrics.normalized.observation, confidence, Math.max(0.001, stepSeconds));
        target = this.forecast;
      } else {
        this.applyPausePolicy(pauseSeconds, stepSeconds);
        target = pauseSeconds <= 12 ? this.pauseProtectedEnergy : this.forecast;
      }
      this.advanceSecondOrder(target ?? this.forecast, stepSeconds);
      if (pauseSeconds > 12 && this.pauseProtectedEnergy !== null) {
        const release = smootherstep((pauseSeconds - 12) / 28);
        const releaseCeiling = this.pauseProtectedEnergy
          + (0.05 - this.pauseProtectedEnergy) * release;
        if (this.energy > releaseCeiling) {
          this.energy = releaseCeiling;
          this.velocity = Math.min(0, this.velocity);
        }
      }
      this.updateBaseline(metrics, now);
      this.snapshot = this.makeSnapshot(metrics, confidence, pauseSeconds);
      return this.snapshot;
    }

    static smootherstep(value) { return smootherstep(value); }
    static logisticRatio(value, baseline) { return logisticRatio(value, baseline); }
    static get DEFAULT_BASELINE() { return { ...DEFAULT_BASELINE }; }
  }

  global.PredictiveConductor = PredictiveConductor;
})(typeof window !== 'undefined' ? window : globalThis);

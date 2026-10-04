(function (global) {
  'use strict';
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const smooth = (value) => global.PredictiveConductor.smootherstep(value);
  const anchor = (energy, low, middle, high) => energy <= .5
    ? low + (middle - low) * smooth(energy * 2)
    : middle + (high - middle) * smooth((energy - .5) * 2);
  const ranges = {
    upperStrings: [-6, 0, 1.5], lowerStrings: [-3, 0, 2],
    woodwinds: [-8, 0, 1], brass: [-15, 0, 4.5],
    percussion: [-18, 0, 5], color: [-10, 0, 2.5],
  };
  function performanceMapping(energy) {
    const value = clamp(Number(energy) || 0);
    const familyGainsDb = {};
    const levels = {};
    for (const [family, points] of Object.entries(ranges)) {
      const db = anchor(value, ...points);
      familyGainsDb[family] = db;
      const low = 10 ** (points[0] / 20);
      const high = 10 ** (points[2] / 20);
      levels[family] = clamp((10 ** (db / 20) - low) / (high - low));
    }
    levels.strings = .7 * levels.upperStrings + .3 * levels.lowerStrings;
    return { familyGainsDb, levels };
  }
  function textDifference(previous, next) {
    const before = Array.from(previous);
    const after = Array.from(next);
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start
      && before[before.length - end - 1] === after[after.length - end - 1]) end++;
    return { inserted: after.length - start - end, deleted: before.length - start - end };
  }
  function acceptsKey(event) {
    return !event.ctrlKey && !event.metaKey && !event.altKey
      && (event.key?.length === 1 || ['Backspace', 'Delete', 'Enter', 'Process', 'Unidentified'].includes(event.key));
  }
  class ShowcaseTrial {
    constructor({ clock = () => global.performance.now() } = {}) {
      this.wallClock = clock;
      this.hiddenAt = null;
      this.hiddenOffset = 0;
      this.reset();
    }
    now() { return (this.hiddenAt ?? this.wallClock()) - this.hiddenOffset; }
    reset() {
      this.text = '';
      this.trace = [];
      this.conductor = new global.PredictiveConductor({ clock: () => this.now(), storage: null });
    }
    keyDown(event) {
      return this.conductor.recordKeyDown({ repeat: event.repeat, ignored: !acceptsKey(event) });
    }
    keyUp(event) { return this.conductor.recordKeyUp({ ignored: !acceptsKey(event) }); }
    updateText(next, { pasted = false } = {}) {
      const change = textDifference(this.text, next);
      this.text = next;
      if (!change.inserted && !change.deleted) return change;
      if (pasted) this.conductor.record({ characters: change.inserted, pasted: true });
      else {
        if (change.deleted) this.conductor.record({ characters: change.deleted, deleted: true });
        if (change.inserted) this.conductor.record({ characters: change.inserted });
      }
      this.trace.push({ at: this.now(), units: change.inserted + change.deleted, pasted });
      this.trimTrace();
      return change;
    }
    trimTrace() { this.trace = this.trace.filter(event => this.now() - event.at <= 12000).slice(-80); }
    setHidden(hidden) {
      if (hidden && this.hiddenAt === null) this.hiddenAt = this.wallClock();
      else if (!hidden && this.hiddenAt !== null) {
        this.hiddenOffset += this.wallClock() - this.hiddenAt;
        this.hiddenAt = null;
      }
      this.conductor.setVisibility(hidden);
    }
    sample() {
      this.trimTrace();
      const snapshot = this.conductor.sample();
      const active = this.conductor.firstEditAt !== null && this.text.trim().length > 0;
      let phase = 'idle';
      if (!active && this.text.length) phase = 'pasted';
      else if (active) {
        if (snapshot.pauseSeconds >= 40) phase = 'quiet';
        else if (snapshot.pauseSeconds > 12) phase = 'release';
        else if (snapshot.pauseSeconds >= 2) phase = 'pause';
        else if (snapshot.confidence < .25) phase = 'begin';
        else phase = snapshot.energy > .61 ? 'flow' : 'writing';
      }
      return { snapshot, active, phase, characters: Array.from(this.text).length,
        trace: this.trace.map(event => ({ ...event })), ...performanceMapping(snapshot.energy) };
    }
  }
  global.ShowcaseTrial = ShowcaseTrial;
  global.SHOWCASE_MODEL = { performanceMapping, textDifference, acceptsKey };
})(typeof window !== 'undefined' ? window : globalThis);

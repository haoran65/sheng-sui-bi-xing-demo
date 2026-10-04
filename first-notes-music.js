(function (global) {
  'use strict';
  const motif = [72, 76, 79, 74, 72];
  const patches = [
    { instrument: 'harp', rootMidi: 72, path: './assets/audio/samples/harp-c5.wav' },
    { instrument: 'violin2', rootMidi: 60, path: './assets/audio/samples/violin-pizz-c4.wav' },
    { instrument: 'flute', rootMidi: 72, path: './assets/audio/samples/flute-c5.wav' },
  ];
  function cuePlan(stage) {
    const slow = stage === 'slow-reward';
    const fast = stage === 'fast-reward';
    const duration = slow ? 4 : fast ? 2 : 2.5;
    const lead = slow ? .15 : fast ? .12 : .45;
    const step = slow ? .65 : fast ? .2 : .35;
    const notes = motif.map((midi, index) => ({ midi, instrument: slow ? 'flute' : fast ? 'violin2' : 'harp',
      offset: lead + index * step, duration: slow ? .9 : fast ? .28 : index === 4 ? .65 : .4,
      peak: slow ? .22 : fast ? .48 : .32 }));
    if (fast) motif.forEach((midi, index) => notes.push({ midi: midi + 12, instrument: 'flute',
      offset: lead + .1 + index * step, duration: .22, peak: .28 }));
    return { duration, notes, energy: slow ? .22 : fast ? .85 : .5 };
  }

  class FirstNotesMusic {
    constructor({ onFrame = () => {}, onState = () => {}, clock = () => performance.now() / 1000 } = {}) {
      Object.assign(this, { onFrame, onState, wallClock: clock });
      this.context = null;
      this.sources = new Set();
      this.buffers = new Map();
      this.raw = new Map();
      this.volume = .62;
      this.generation = 0;
      this.state = 'idle';
      this.audible = false;
    }
    setState(state) { if (state !== this.state) { this.state = state; this.onState(state); } }
    preload() {
      if (this.loading) return this.loading;
      this.loading = Promise.allSettled(patches.map(async (patch) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        try {
          const response = await global.fetch(patch.path, { signal: controller.signal });
          if (!response.ok) throw new Error('Sample unavailable');
          this.raw.set(patch.instrument, await response.arrayBuffer());
          await this.decode(patch);
        } finally { clearTimeout(timer); }
      }));
      return this.loading;
    }
    async decode(patch) {
      const context = this.context;
      if (!context || this.buffers.has(patch.instrument) || !this.raw.has(patch.instrument)) return;
      try {
        const audio = await context.decodeAudioData(this.raw.get(patch.instrument).slice(0));
        if (context === this.context) this.buffers.set(patch.instrument, { audio, rootMidi: patch.rootMidi });
      } catch { /* Each missing patch falls back to a quiet synthesized note. */ }
    }
    unlock() {
      const AudioContextType = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextType) { this.setState('unavailable'); return Promise.resolve(false); }
      try {
        if (!this.context || this.context.state === 'closed') {
          this.context = new AudioContextType();
          this.master = this.context.createGain();
          this.master.gain.value = this.volume * .4;
          const compressor = this.context.createDynamicsCompressor();
          compressor.threshold.value = -15;
          compressor.ratio.value = 3;
          this.master.connect(compressor);
          compressor.connect(this.context.destination);
          for (const patch of patches) void this.decode(patch);
        }
        // resume() is invoked synchronously inside the trusted key/pointer handler.
        const context = this.context;
        let timer;
        const resumed = context.resume().then(() => {
          const ready = context.state === 'running';
          this.setState(ready ? 'ready' : 'blocked');
          return ready;
        }).catch(() => { this.setState('blocked'); return false; });
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            const ready = context.state === 'running';
            this.setState(ready ? 'ready' : 'blocked');
            resolve(ready);
          }, 300);
        });
        return Promise.race([resumed, timeout]).finally(() => clearTimeout(timer));
      } catch { this.setState('unavailable'); return Promise.resolve(false); }
    }
    setVolume(value) {
      this.volume = Math.max(0, Math.min(2, Number(value) || 0));
      if (this.master) this.master.gain.value = this.volume * .4;
    }
    clock() { return this.useAudioClock ? this.context.currentTime : this.wallClock(); }
    sound(note, when) {
      const context = this.context;
      const sample = this.buffers.get(note.instrument);
      const source = sample ? context.createBufferSource() : context.createOscillator();
      if (sample) {
        source.buffer = sample.audio;
        source.playbackRate.value = 2 ** ((note.midi - sample.rootMidi) / 12);
      } else {
        source.type = 'triangle';
        source.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
      }
      const envelope = context.createGain();
      const end = when + note.duration;
      envelope.gain.setValueAtTime(.0001, when);
      envelope.gain.linearRampToValueAtTime(note.peak * (sample ? 1 : .42), when + .015);
      envelope.gain.exponentialRampToValueAtTime(.0001, end);
      source.connect(envelope);
      envelope.connect(this.master);
      source.onended = () => { this.sources.delete(source); source.disconnect(); envelope.disconnect(); };
      this.sources.add(source);
      source.start(when);
      source.stop(end + .02);
    }
    play(stage, done) {
      this.stop();
      const generation = ++this.generation;
      const plan = cuePlan(stage);
      this.audible = this.context?.state === 'running';
      this.useAudioClock = this.audible;
      const start = this.clock() + .03;
      const frame = { absoluteBar: -generation, audioStartTime: start, durationSeconds: plan.duration,
        timing: 'scheduled', notes: plan.notes.map((note, index) => ({
          id: `first-notes:${generation}:${index}`, midi: note.midi, instrument: note.instrument,
          offsetSeconds: note.offset, arrivalTime: start + note.offset,
          durationSeconds: note.duration, durationBeats: note.duration * 2, peak: note.peak,
        })) };
      if (this.audible) for (const note of plan.notes) this.sound(note, start + note.offset);
      this.onFrame(frame, plan.energy);
      this.cue = { stage, generation, end: start + plan.duration };
      this.timer = setInterval(() => {
        if (generation !== this.generation || this.clock() < this.cue.end) return;
        clearInterval(this.timer);
        this.timer = null;
        this.cue = null;
        done();
      }, 25);
      return () => { if (generation === this.generation) this.stop(); };
    }
    stop() {
      this.generation++;
      clearInterval(this.timer);
      this.timer = null;
      this.cue = null;
      for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } }
      this.sources.clear();
      this.audible = false;
    }
  }
  global.FirstNotesMusic = FirstNotesMusic;
  global.FirstNotesCuePlan = cuePlan;
})(typeof window !== 'undefined' ? window : globalThis);

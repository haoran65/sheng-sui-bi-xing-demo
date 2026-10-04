(function (global) {
  'use strict';
  class InstrumentAudition {
    constructor({ onState = () => {}, loadSamples = () => global.loadOrchestraSamples(),
      contextFactory = () => new (global.AudioContext || global.webkitAudioContext)() } = {}) {
      this.onState = onState;
      this.loadSamples = loadSamples;
      this.contextFactory = contextFactory;
      this.context = null;
      this.cache = new Map();
      this.generation = 0;
      this.volume = .62;
      this.muted = false;
      this.enabled = true;
      this.voice = null;
    }
    configure({ volume = this.volume, muted = this.muted, enabled = this.enabled } = {}) {
      const wasEnabled = this.enabled;
      this.volume = Math.max(0, Math.min(2, Number(volume) || 0));
      this.muted = Boolean(muted);
      this.enabled = Boolean(enabled);
      if (!this.enabled) { if (wasEnabled) this.stop(); }
      else if (this.muted || !this.volume) this.stop();
      else this.output?.gain.setTargetAtTime(this.volume, this.context.currentTime, .06);
    }
    stop() {
      this.generation++;
      const voice = this.voice;
      this.voice = null;
      if (voice) {
        voice.source.onended = () => { voice.source.disconnect(); voice.envelope.disconnect(); };
        const at = this.context.currentTime;
        voice.envelope.gain.cancelScheduledValues(at);
        voice.envelope.gain.setTargetAtTime(0, at, .012);
        try { voice.source.stop(at + .045); } catch { /* The voice already ended. */ }
      }
      this.onState('idle');
    }
    async play(instrument) {
      this.stop();
      const token = this.generation;
      if (!instrument || !this.enabled) return false;
      if (this.muted || !this.volume) { this.onState('muted'); return false; }
      this.onState('loading');
      try {
        // Unlock synchronously inside the click. This context never resumes the ensemble.
        if (!this.context || this.context.state === 'closed') {
          this.context = this.contextFactory();
          this.output = this.context.createGain();
          this.output.gain.value = this.volume;
          const compressor = this.context.createDynamicsCompressor();
          compressor.threshold.value = -10;
          compressor.knee.value = 6;
          compressor.ratio.value = 4;
          compressor.attack.value = .005;
          compressor.release.value = .15;
          this.output.connect(compressor);
          compressor.connect(this.context.destination);
        }
        await this.context.resume();
        if (token !== this.generation) return false;
        if (this.context.state !== 'running') throw new Error('blocked');
        await this.loadSamples();
        if (token !== this.generation) return false;
        const sampleInstrument = instrument.id === 'violin2' ? 'violin1' : instrument.id;
        const choices = (global.ORCHESTRA_SAMPLES || []).filter((item) => item.instrument === sampleInstrument
          && item.articulation === instrument.articulation);
        const sample = choices.reduce((best, item) => !best ||
          Math.abs(item.rootMidi - instrument.midi) < Math.abs(best.rootMidi - instrument.midi) ? item : best, null);
        if (!sample) throw new Error('missing sample');
        if (!this.cache.has(sample.id)) {
          const bytes = Uint8Array.from(atob(sample.data), (letter) => letter.charCodeAt(0));
          const pending = this.context.decodeAudioData(bytes.buffer)
            .catch((error) => { this.cache.delete(sample.id); throw error; });
          this.cache.set(sample.id, pending);
        }
        const audio = await this.cache.get(sample.id);
        if (token !== this.generation || this.muted || !this.volume) return false;
        const source = this.context.createBufferSource();
        const envelope = this.context.createGain();
        source.buffer = audio;
        source.playbackRate.value = ['bassDrum', 'cymbal', 'tamTam'].includes(instrument.id)
          ? 1 : 2 ** ((instrument.midi - sample.rootMidi) / 12);
        const duration = Math.max(.1, Math.min(1.8, audio.duration / source.playbackRate.value - .025));
        const at = this.context.currentTime + .02;
        const attack = Math.min(duration * .15, instrument.articulation === 'sustain' ? .1 : .006);
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(.68, at + attack);
        envelope.gain.setValueAtTime(.68, at + duration * .7);
        envelope.gain.linearRampToValueAtTime(0, at + duration);
        source.connect(envelope); envelope.connect(this.output);
        this.voice = { source, envelope };
        source.onended = () => {
          source.disconnect(); envelope.disconnect();
          if (token === this.generation) { this.voice = null; this.onState('idle'); }
        };
        this.onState('playing');
        source.start(at); source.stop(at + duration + .01);
        return true;
      } catch (error) {
        if (token === this.generation) {
          this.stop();
          this.onState(error.message === 'blocked' || error.name === 'NotAllowedError' ? 'blocked' : 'unavailable');
        }
        return false;
      }
    }
    dispose() {
      this.stop();
      this.cache.clear();
      return this.context?.close().catch(() => {});
    }
  }
  global.InstrumentAudition = InstrumentAudition;
})(typeof window !== 'undefined' ? window : globalThis);

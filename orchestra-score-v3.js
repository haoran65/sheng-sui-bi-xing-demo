(function (global) {
  'use strict';

  // AudioBuffers can be reused by different contexts. Cache the promise as well
  // as the buffer so simultaneous prepares decode each immutable sample once.
  const decodedSamples = new WeakMap();
  function decodeSample(context, item) {
    if (!decodedSamples.has(item)) {
      const pending = context.decodeAudioData(decodeBase64(item.data))
        .catch((error) => { decodedSamples.delete(item); throw error; });
      decodedSamples.set(item, pending);
    }
    return decodedSamples.get(item);
  }

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smootherstep = (value) => {
    const x = clamp(value, 0, 1);
    return 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3;
  };
  const defaultPlan = global.ORCHESTRA_PERFORMANCE;
  const PAN = { violin1: -0.56, violin2: -0.28, viola: 0.1, cello: 0.36,
    doubleBass: 0.48, flute: -0.2, oboe: -0.06, clarinet: 0.1, bassoon: 0.25,
    horn: 0.44, trumpet: 0.18, trombone: 0.04, tuba: 0.3, timpani: 0.12,
    bassDrum: 0.18, cymbal: -0.02, tamTam: 0.08, harp: -0.46 };
  const LEVEL = { violin1: 0.46, violin2: 0.4, viola: 0.41, cello: 0.46,
    doubleBass: 0.39, flute: 0.31, oboe: 0.25, clarinet: 0.28, bassoon: 0.3,
    horn: 0.27, trumpet: 0.2, trombone: 0.21, tuba: 0.23, timpani: 0.28,
    bassDrum: 0.3, cymbal: 0.25, tamTam: 0.27, harp: 0.34 };
  const SECTION_NAMES = { introduction: '序奏', exposition: '呈示', development: '展开',
    transition: '过渡', secondary: '副部', return: '回归', coda: '尾声' };
  const FAMILY_BY_INSTRUMENT = {
    violin1: 'upperStrings', violin2: 'upperStrings',
    viola: 'lowerStrings', cello: 'lowerStrings', doubleBass: 'lowerStrings',
    flute: 'woodwinds', oboe: 'woodwinds', clarinet: 'woodwinds', bassoon: 'woodwinds',
    horn: 'brass', trumpet: 'brass', trombone: 'brass', tuba: 'brass',
    timpani: 'percussion', bassDrum: 'percussion', cymbal: 'percussion', tamTam: 'percussion',
    harp: 'color',
  };
  const ROUNDED_TONE = {
    violin1: { frequency: 3500, gain: -2.5 },
    violin2: { frequency: 3500, gain: -2.5 },
    viola: { frequency: 3600, gain: -2 },
    horn: { frequency: 3000, gain: -2.5 },
    trumpet: { frequency: 3000, gain: -3 },
    trombone: { frequency: 3000, gain: -2.5 },
    tuba: { frequency: 3000, gain: -1.5 },
    timpani: { frequency: 5500, gain: -1.5 },
    bassDrum: { frequency: 5500, gain: -1.5 },
    cymbal: { frequency: 6000, gain: -2 },
    tamTam: { frequency: 6000, gain: -2 },
  };

  function positiveModulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
  }
  function normalizePlan(input) {
    if (!input?.events?.length || !input?.phrases?.length) throw new Error('交响乐谱未加载');
    const totalBars = input.totalBars || input.bars?.length;
    if (!Number.isInteger(totalBars) || totalBars < 1) throw new Error('交响乐谱缺少有效小节');
    const bars = input.bars?.length === totalBars
      ? input.bars.map((bar, index) => ({
        number: bar.number ?? index + 1,
        startBeat: Number(bar.startBeat),
        durationBeats: Number(bar.durationBeats),
      }))
      : Array.from({ length: totalBars }, (_, index) => ({
        number: index + 1, startBeat: index * 4, durationBeats: 4,
      }));
    for (const bar of bars) {
      if (!Number.isFinite(bar.startBeat) || !(bar.durationBeats > 0)) {
        throw new Error(`小节 ${bar.number} 的时间信息无效`);
      }
      bar.endBeat = bar.startBeat + bar.durationBeats;
    }
    const totalBeats = Number(input.totalBeats) || bars.at(-1).endBeat;
    const phrases = input.phrases.map((phrase, index) => {
      const firstBar = phrase.bars?.[0] ?? phrase.startBar ?? index * 4 + 1;
      const lastBar = phrase.bars?.[1] ?? phrase.endBar ?? Math.min(totalBars, firstBar + 3);
      return {
        ...phrase,
        startBeat: Number.isFinite(phrase.startBeat) ? phrase.startBeat : bars[firstBar - 1]?.startBeat ?? 0,
        endBeat: Number.isFinite(phrase.endBeat) ? phrase.endBeat : bars[lastBar - 1]?.endBeat ?? totalBeats,
        dynamicArc: phrase.dynamicArc?.length ? phrase.dynamicArc : [[0, 0.42], [1, 0.42]],
        tempoArc: phrase.tempoArc?.length ? phrase.tempoArc : [[0, 1], [1, 1]],
        accents: phrase.accents || [],
      };
    }).sort((a, b) => a.startBeat - b.startBeat);
    return {
      ...input,
      totalBars,
      totalBeats,
      bars,
      phrases,
      baseTempoBpm: Number(input.baseTempoBpm) || 72,
      tempoMap: (input.tempoMap || []).map((point) => ({
        beat: Number(point.beat), bpm: Number(point.bpm), transitionBeats: Number(point.transitionBeats) || 0,
      })).filter((point) => Number.isFinite(point.beat) && point.bpm > 0).sort((a, b) => a.beat - b.beat),
      interactionPolicy: {
        maxDynamicOffsetDb: 4,
        maxTempoOffsetBpm: 6,
        ...(input.interactionPolicy || {}),
      },
    };
  }

  function curveAt(points, position) {
    for (let index = 1; index < points.length; index++) {
      if (position <= points[index][0]) {
        const [x0, y0] = points[index - 1];
        const [x1, y1] = points[index];
        return y0 + (y1 - y0) * smootherstep((position - x0) / (x1 - x0));
      }
    }
    return points.at(-1)[1];
  }
  function decodeBase64(base64) {
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) data[index] = binary.charCodeAt(index);
    return data.buffer;
  }
  function samplePatch(instrument, articulation) {
    const section = instrument === 'violin2' && articulation !== 'pizzicato' ? 'violin1' : instrument;
    if (articulation === 'tremolo' || articulation === 'pizzicato'
      || articulation === 'pluck' || articulation === 'strike') {
      return `${section}:${articulation}`;
    }
    return `${section}:sustain`;
  }
  function normalizeAdaptation(input = {}) {
    const normalizeStage = (stage, index) => ({
      at: clamp(Number(stage?.at) || 0, 0, 1),
      label: stage?.label || `阶段 ${index + 1}`,
      tempoOffset: clamp(Number(stage?.tempoOffset) || 0, -0.02, 0.02),
      densityOffset: clamp(Number(stage?.densityOffset) || 0, -0.12, 0.12),
      dynamicDb: clamp(Number(stage?.dynamicDb) || 0, -6, 4),
      familyGainsDb: { ...(stage?.familyGainsDb || {}) },
      instrumentGainsDb: { ...(stage?.instrumentGainsDb || {}) },
      roleGainsDb: { ...(stage?.roleGainsDb || {}) },
      articulationGainsDb: { ...(stage?.articulationGainsDb || {}) },
    });
    const stages = (input.motion?.stages || []).map(normalizeStage).sort((a, b) => a.at - b.at);
    return {
      schemaVersion: '1.0',
      mode: input.mode || 'neutral',
      label: input.label || '中性叙事',
      fingerprint: input.fingerprint || '全乐团均衡呼吸',
      calmMode: Boolean(input.calmMode),
      confidence: clamp(Number(input.confidence) || 0, 0, 1),
      tempoScale: clamp(Number(input.tempoScale) || 1, 0.96, 1.04),
      densityBias: clamp(Number(input.densityBias) || 0, -0.12, 0.12),
      familyGainsDb: { ...(input.familyGainsDb || {}) },
      instrumentGainsDb: { ...(input.instrumentGainsDb || {}) },
      roleGainsDb: { ...(input.roleGainsDb || {}) },
      articulationGainsDb: { ...(input.articulationGainsDb || {}) },
      motion: {
        cycleBars: clamp(Number(input.motion?.cycleBars) || 16, 8, 32),
        stages: stages.length >= 2 ? stages : [
          normalizeStage({ at: 0, label: '保持' }, 0),
          normalizeStage({ at: 1, label: '保持' }, 1),
        ],
      },
      transitionBeats: clamp(Number(input.transitionBeats) || 24, 16, 32),
      emotion: { ...(input.emotion || {}) },
    };
  }

  function addMaps(...maps) {
    const output = {};
    for (const map of maps) {
      for (const [key, value] of Object.entries(map || {})) {
        output[key] = (output[key] || 0) + (Number(value) || 0);
      }
    }
    return output;
  }

  function interpolateMaps(left = {}, right = {}, position = 0) {
    const output = {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const from = Number(left[key]) || 0;
      const to = Number(right[key]) || 0;
      output[key] = from + (to - from) * position;
    }
    return output;
  }

  function energyAnchor(energy, low, middle, high) {
    const value = clamp(Number(energy) || 0, 0, 1);
    if (value <= 0.5) return low + (middle - low) * smootherstep(value * 2);
    return middle + (high - middle) * smootherstep((value - 0.5) * 2);
  }

  function performanceFromEnergy(energy, calmMode = false) {
    const value = clamp(Number(energy) || 0, 0, 1);
    let tempoScale = energyAnchor(value, 0.90, 1, 1.10);
    let dynamicDb = energyAnchor(value, -8, 0, 4);
    const familyGainsDb = {
      upperStrings: energyAnchor(value, -6, 0, 1.5),
      lowerStrings: energyAnchor(value, -3, 0, 2),
      woodwinds: energyAnchor(value, -8, 0, 1),
      brass: energyAnchor(value, -15, 0, 4.5),
      percussion: energyAnchor(value, -18, 0, 5),
      color: energyAnchor(value, -10, 0, 2.5),
    };
    if (calmMode) {
      tempoScale = Math.min(1.03, tempoScale);
      dynamicDb = Math.min(1.5, dynamicDb);
      familyGainsDb.brass = Math.min(0.8, familyGainsDb.brass);
      familyGainsDb.percussion = Math.min(0.8, familyGainsDb.percussion);
    }
    return {
      energy: value,
      tempoScale,
      dynamicDb,
      densityBias: energyAnchor(value, -0.18, 0, 0.18),
      familyGainsDb,
    };
  }

  class OrchestraScore {
    constructor({ plan = defaultPlan, onProgress = () => {}, onSection = () => {},
      onLoading = () => {}, onComplete = () => {}, onAdaptation = () => {},
      onVisualBar = () => {}, onVisualWindow = () => {}, mixProfile = 'rounded-v1' } = {}) {
      this.mixProfile = mixProfile === 'legacy' ? 'legacy' : 'rounded-v1';
      this.onProgress = onProgress;
      this.onSection = onSection;
      this.onLoading = onLoading;
      this.onComplete = onComplete;
      this.onAdaptation = onAdaptation;
      this.onVisualBar = onVisualBar;
      this.onVisualWindow = onVisualWindow;
      this.currentBar = 0;
      this.nextBarTime = 0;
      this.lastScheduledBar = 0;
      this.lastScheduledTime = 0;
      this.sectionIndex = -1;
      this.charge = 0.5;
      this.performanceControl = { format: 'typing-dynamics/2', energy: 0.5, charge: 0.5,
        forecast: 0.5, confidence: 0 };
      this.pendingPerformanceControl = null;
      this.performanceRamp = null;
      this.lockedTempoScale = 1;
      this.sparse = false;
      this.locked = false;
      this.quieter = false;
      this.muted = false;
      this.volume = 0.62;
      this.context = null;
      this.master = null;
      this.buses = {};
      this.samples = {};
      this.loaded = false;
      this.playing = false;
      this.timer = null;
      this.completionTimer = null;
      this.completed = false;
      this.activeSources = new Set();
      this.tempoScaleRamp = null;
      this.tempoScale = 1;
      this.appliedAdaptation = normalizeAdaptation();
      this.pendingAdaptation = null;
      this.adaptationRequestedAtBar = 0;
      this.instrumentGainDb = {};
      this.activeGesture = null;
      this.currentGestureMix = normalizeAdaptation();
      this.lastModeAppliedPhraseId = null;
      this.positionBeat = 0;
      this.transportSegments = [];
      this.transportRevision = 0;
      this.applyPlan(plan);
    }

    applyPlan(input) {
      this.plan = normalizePlan(input);
      this.baseBpm = this.plan.baseTempoBpm;
      // A stable score-time axis; live timing is captured separately as audio is scheduled.
      this.timeIndex = [{ beat: 0, seconds: 0 }];
      let seconds = 0;
      for (let beat = 0; beat < this.plan.totalBeats; beat += 1 / 16) {
        const end = Math.min(this.plan.totalBeats, beat + 1 / 16);
        seconds += (end - beat) * 60 / this.scoreTempoAtBeat((beat + end) / 2);
        this.timeIndex.push({ beat: end, seconds });
      }
      this.durationSeconds = seconds;
      this.eventsByBar = Array.from({ length: this.plan.totalBars }, () => []);
      for (const event of this.plan.events) {
        const index = Number(event.bar) - 1;
        if (index >= 0 && index < this.eventsByBar.length) this.eventsByBar[index].push(event);
      }
    }

    async prepare() {
      if (this.loaded) return;
      const AudioContextType = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextType) throw new Error('此浏览器不支持 Web Audio');
      this.context = new AudioContextType();
      await this.context.resume();
      if (!global.ORCHESTRA_SAMPLES?.length) await global.loadOrchestraSamples?.();
      if (!global.ORCHESTRA_SAMPLES?.length) throw new Error('管弦乐音色未加载');
      this.makeGraph();
      const items = global.ORCHESTRA_SAMPLES;
      let nextIndex = 0;
      let done = 0;
      await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        while (nextIndex < items.length) {
          const item = items[nextIndex++];
          const audio = await decodeSample(this.context, item);
          const key = `${item.instrument}:${item.articulation}`;
          (this.samples[key] ??= []).push({ rootMidi: item.rootMidi,
            velocityCenter: item.velocityCenter, audio });
          this.onLoading(++done, items.length);
        }
      }));
      for (const event of this.plan.events) {
        if (!this.samples[samplePatch(event.instrument, event.articulation)]?.length) {
          throw new Error(`缺少音色：${event.instrument} ${event.articulation}`);
        }
      }
      this.loaded = true;
    }

    makeGraph() {
      const context = this.context;
      const rounded = this.mixProfile === 'rounded-v1';
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = rounded ? -12 : -16;
      compressor.knee.value = 12;
      compressor.ratio.value = rounded ? 1.8 : 2.5;
      compressor.attack.value = rounded ? 0.03 : 0.018;
      compressor.release.value = rounded ? 0.45 : 0.38;
      compressor.connect(context.destination);

      this.master = context.createGain();
      this.master.gain.value = this.effectiveVolume();
      this.master.connect(compressor);
      const room = context.createConvolver();
      this.room = room;
      room.buffer = this.makeRoomImpulse(2.75);
      const wet = context.createGain();
      wet.gain.value = rounded ? 0.18 : 0.24;
      if (rounded) {
        const roomDamping = context.createBiquadFilter();
        roomDamping.type = 'lowpass';
        roomDamping.frequency.value = 6200;
        roomDamping.Q.value = 0.7;
        room.connect(roomDamping);
        roomDamping.connect(wet);
      } else room.connect(wet);
      wet.connect(compressor);
      this.master.connect(room);

      for (const instrument of Object.keys(PAN)) {
        const gain = context.createGain();
        gain.gain.value = LEVEL[instrument];
        const pan = context.createStereoPanner();
        pan.pan.value = PAN[instrument];
        const tone = rounded && ROUNDED_TONE[instrument];
        if (tone) {
          const filter = context.createBiquadFilter();
          filter.type = 'highshelf';
          filter.frequency.value = tone.frequency;
          filter.gain.value = tone.gain;
          gain.connect(filter);
          filter.connect(pan);
        } else gain.connect(pan);
        pan.connect(this.master);
        this.buses[instrument] = gain;
      }
    }

    makeRoomImpulse(seconds) {
      const length = Math.floor(this.context.sampleRate * seconds);
      const buffer = this.context.createBuffer(2, length, this.context.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        const preDelay = Math.floor(this.context.sampleRate * (channel ? 0.027 : 0.023));
        let randomState = channel ? 0x1badf00d : 0x6d2b79f5;
        for (let index = preDelay; index < length; index++) {
          randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
          const noise = randomState / 0xffffffff * 2 - 1;
          const elapsed = (index - preDelay) / this.context.sampleRate;
          const bloom = Math.min(1, elapsed / 0.075);
          const decay = Math.exp(-3.9 * elapsed / seconds);
          data[index] = noise * bloom * decay * 0.16;
        }
        const reflections = channel
          ? [[0.035, 0.42], [0.052, 0.31], [0.083, 0.22], [0.121, 0.14]]
          : [[0.031, 0.42], [0.047, 0.31], [0.076, 0.22], [0.109, 0.14]];
        for (const [delay, gain] of reflections) {
          const index = Math.floor(this.context.sampleRate * delay);
          if (index < length) data[index] += gain;
        }
      }
      return buffer;
    }

    effectiveVolume() {
      return this.muted ? 0 : (this.mixProfile === 'rounded-v1' ? 1.5 : 2.2)
        * this.volume * (this.quieter ? 0.57 : 1) * (this.auditionGain ?? 1);
    }
    setAuditionDucking(value = 1) {
      this.auditionGain = clamp(Number(value), 0, 1);
      this.setVolume(this.volume);
    }
    setVolume(value) {
      this.volume = clamp(Number(value) || 0, 0, 2);
      if (this.master) this.master.gain.setTargetAtTime(this.effectiveVolume(), this.context.currentTime, 0.15);
    }
    setQuieter(value) { this.quieter = Boolean(value); this.setVolume(this.volume); }
    setMuted(value) { this.muted = Boolean(value); this.setVolume(this.volume); }
    setCharge(value) {
      this.setPerformanceControl({ format: 'typing-dynamics/1', energy: value, charge: value,
        forecast: value, confidence: 1 });
    }
    setPerformanceControl(snapshot = {}) {
      const energy = clamp(Number(snapshot.energy ?? snapshot.charge), 0, 1);
      const normalized = { ...snapshot, energy, charge: energy };
      this.pendingPerformanceControl = normalized;
      if (this.locked) return { ...this.performanceControl };
      const beat = this.absoluteBarStartBeat(this.currentBar);
      const from = this.performanceAtBeat(beat).energy;
      this.performanceControl = normalized;
      this.charge = energy;
      if (Math.abs(from - energy) > 0.001) {
        this.performanceRamp = { from, to: energy, startBeat: beat, endBeat: beat + 8 };
      }
      return { ...this.performanceControl };
    }
    setLocked(value) {
      const next = Boolean(value);
      const beat = this.absoluteBarStartBeat(this.currentBar);
      if (next && !this.locked) {
        this.lockedTempoScale = this.interactionScaleAt(beat);
      } else if (!next && this.locked) {
        if (this.pendingPerformanceControl) {
          const heldEnergy = this.performanceAtBeat(beat).energy;
          this.performanceControl = this.pendingPerformanceControl;
          this.charge = this.performanceControl.energy;
          this.performanceRamp = { from: heldEnergy, to: this.charge,
            startBeat: beat, endBeat: beat + 8 };
        }
      }
      this.locked = next;
    }

    performanceAtBeat(beat) {
      let energy = this.performanceControl.energy;
      const ramp = this.performanceRamp;
      if (ramp) {
        if (beat >= ramp.endBeat) energy = ramp.to;
        else if (beat <= ramp.startBeat) energy = ramp.from;
        else energy = ramp.from + (ramp.to - ramp.from)
          * smootherstep((beat - ramp.startBeat) / Math.max(0.001, ramp.endBeat - ramp.startBeat));
      }
      return performanceFromEnergy(energy, this.appliedAdaptation.calmMode);
    }

    baseInteractionScaleAt(beat) {
      if (!this.tempoScaleRamp) return this.tempoScale;
      const ramp = this.tempoScaleRamp;
      if (beat >= ramp.endBeat) return ramp.to;
      return ramp.from + (ramp.to - ramp.from) * smootherstep((beat - ramp.startBeat) / (ramp.endBeat - ramp.startBeat));
    }
    absoluteBarPositionAtBeat(beat) {
      const cycle = Math.floor(beat / this.plan.totalBeats);
      const loopBeat = positiveModulo(beat, this.plan.totalBeats);
      let index = this.plan.bars.findIndex((bar) => loopBeat >= bar.startBeat && loopBeat < bar.endBeat);
      if (index < 0) index = loopBeat < this.plan.bars[0].startBeat ? 0 : this.plan.bars.length - 1;
      const bar = this.plan.bars[index];
      return cycle * this.plan.totalBars + index
        + clamp((loopBeat - bar.startBeat) / Math.max(0.001, bar.durationBeats), 0, 1);
    }
    motionStateAt(beat) {
      if (!this.activeGesture) return {
        index: 0, label: '保持', phase: 0, tempoOffset: 0, densityOffset: 0, dynamicDb: 0,
        familyGainsDb: {}, instrumentGainsDb: {}, roleGainsDb: {}, articulationGainsDb: {},
      };
      const { motion, startBar, startBeat, transitionBeats } = this.activeGesture;
      const elapsedBars = Math.max(0, this.absoluteBarPositionAtBeat(beat) - startBar);
      const phase = positiveModulo(elapsedBars, motion.cycleBars) / motion.cycleBars;
      let index = motion.stages.findIndex((stage, stageIndex) => stageIndex > 0 && phase <= stage.at);
      if (index < 1) index = motion.stages.length - 1;
      const left = motion.stages[index - 1];
      const right = motion.stages[index];
      const amount = smootherstep((phase - left.at) / Math.max(0.001, right.at - left.at));
      const entry = smootherstep((beat - startBeat) / Math.max(1, transitionBeats));
      const scaleMap = (map) => Object.fromEntries(Object.entries(map)
        .map(([key, value]) => [key, (Number(value) || 0) * entry]));
      return {
        index: index - 1,
        label: left.label,
        phase,
        tempoOffset: (left.tempoOffset + (right.tempoOffset - left.tempoOffset) * amount) * entry,
        densityOffset: (left.densityOffset + (right.densityOffset - left.densityOffset) * amount) * entry,
        dynamicDb: (left.dynamicDb + (right.dynamicDb - left.dynamicDb) * amount) * entry,
        familyGainsDb: scaleMap(interpolateMaps(left.familyGainsDb, right.familyGainsDb, amount)),
        instrumentGainsDb: scaleMap(interpolateMaps(left.instrumentGainsDb, right.instrumentGainsDb, amount)),
        roleGainsDb: scaleMap(interpolateMaps(left.roleGainsDb, right.roleGainsDb, amount)),
        articulationGainsDb: scaleMap(interpolateMaps(left.articulationGainsDb,
          right.articulationGainsDb, amount)),
      };
    }
    mixAtBeat(beat) {
      const motion = this.motionStateAt(beat);
      const base = this.appliedAdaptation;
      const performance = this.performanceAtBeat(beat);
      const dynamicDb = clamp(motion.dynamicDb + performance.dynamicDb,
        -14, base.calmMode ? 1.5 : 8);
      const familyGainsDb = addMaps(base.familyGainsDb, motion.familyGainsDb,
        performance.familyGainsDb);
      if (base.calmMode) {
        familyGainsDb.brass = Math.min(0.8, Number(familyGainsDb.brass) || 0);
        familyGainsDb.percussion = Math.min(0.8, Number(familyGainsDb.percussion) || 0);
      }
      return {
        ...base,
        energy: performance.energy,
        performanceTempoScale: performance.tempoScale,
        densityBias: clamp(base.densityBias + motion.densityOffset + performance.densityBias,
          -0.3, 0.3),
        dynamicDb,
        familyGainsDb,
        instrumentGainsDb: addMaps(base.instrumentGainsDb, motion.instrumentGainsDb),
        roleGainsDb: addMaps(base.roleGainsDb, motion.roleGainsDb),
        articulationGainsDb: addMaps(base.articulationGainsDb, motion.articulationGainsDb),
        stage: motion.label,
        stageIndex: motion.index,
        stagePhase: motion.phase,
      };
    }
    interactionScaleAt(beat) {
      if (this.locked) return this.lockedTempoScale;
      const base = this.baseInteractionScaleAt(beat);
      const offset = this.motionStateAt(beat).tempoOffset;
      const semanticRange = this.appliedAdaptation.tempoRange || [0.96, 1.04];
      const calmCeiling = this.appliedAdaptation.calmMode
        ? Math.min(1.03, Math.max(semanticRange[0], Number(this.appliedAdaptation.tempoScale) || 1))
        : semanticRange[1];
      const semantic = clamp(base + offset, semanticRange[0], calmCeiling);
      const { phrase } = this.phraseAt(beat);
      const performance = this.performanceAtBeat(beat);
      const performanceRange = this.performanceTempoRangeFor(phrase);
      return clamp(semantic * performance.tempoScale, performanceRange[0], performanceRange[1]);
    }
    queueAdaptation(input) {
      this.pendingAdaptation = normalizeAdaptation(input);
      this.adaptationRequestedAtBar = Math.max(0, this.currentBar);
      this.onAdaptation({ phase: 'queued', plan: { ...this.pendingAdaptation } });
      return { ...this.pendingAdaptation };
    }
    performanceTempoRangeFor(phrase) {
      const explicit = phrase.permissionMask || {};
      if (explicit.performanceTempoRange?.length === 2) return explicit.performanceTempoRange;
      return /cadence|coda|recapitulation|theme|climax|终止|尾声|主题|高潮/i
        .test(`${phrase.function || ''} ${phrase.section || ''}`) ? [0.96, 1.04] : [0.90, 1.10];
    }
    phrasePermission(phrase) {
      const events = this.plan.events.filter((event) => event.beat >= phrase.startBeat
        && event.beat < phrase.endBeat);
      const availableInstruments = new Set(events.map((event) => event.instrument));
      let availableFamilies = new Set([...availableInstruments]
        .map((instrument) => FAMILY_BY_INSTRUMENT[instrument] || 'other'));
      const explicit = phrase.permissionMask || {};
      if (explicit.adjustableFamilies?.length) {
        const adjustable = new Set(explicit.adjustableFamilies);
        availableFamilies = new Set([...availableFamilies].filter((family) => adjustable.has(family)));
      }
      const protectedRoles = new Set(explicit.protectedRoles?.length
        ? explicit.protectedRoles : ['lead', 'melody', 'bass', 'cadence']);
      const protectedInstruments = new Set(events
        .filter((event) => protectedRoles.has(event.role))
        .map((event) => event.instrument));
      return {
        tempoRange: explicit.tempoRange || [0.96, 1.04],
        performanceTempoRange: this.performanceTempoRangeFor(phrase),
        maxFamilyGainDb: Number(explicit.maxFamilyGainDb) || 4.5,
        allowDensityChange: explicit.allowDensityChange !== false,
        availableInstruments,
        availableFamilies,
        protectedInstruments,
      };
    }
    rampParam(param, value, startTime, duration) {
      const at = Math.max(this.context.currentTime, startTime);
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
      else if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(at);
      param.setValueAtTime(param.value, at);
      param.linearRampToValueAtTime(value, at + Math.max(0.08, duration));
    }
    applyBusMix(adaptation, permission, startBeat, startTime, transitionBeats = adaptation.transitionBeats) {
      if (!this.context || !Object.keys(this.buses).length) return;
      const seconds = this.secondsForBeats(startBeat, transitionBeats);
      for (const instrument of Object.keys(this.buses)) {
        const family = FAMILY_BY_INSTRUMENT[instrument] || 'other';
        let db = Number(adaptation.familyGainsDb[family] || 0)
          + Number(adaptation.instrumentGainsDb[instrument] || 0);
        if (!permission.availableFamilies.has(family)) db = 0;
        if (permission.protectedInstruments.has(instrument)) db = Math.max(-1.5, db);
        const low = family === 'percussion' ? -18
          : family === 'color' ? -10 : Math.min(-permission.maxFamilyGainDb, -8);
        const high = adaptation.calmMode
          ? ['brass', 'percussion'].includes(family) ? 0.8 : Math.min(2.2, permission.maxFamilyGainDb)
          : family === 'percussion' ? 5 : family === 'color' ? 5 : permission.maxFamilyGainDb;
        db = clamp(db, low, high);
        this.instrumentGainDb[instrument] = db;
        this.rampParam(this.buses[instrument].gain, LEVEL[instrument] * 10 ** (db / 20), startTime, seconds);
      }
    }
    applyAdaptationAt(phrase, startBeat, startTime, notify = false, absoluteBar = this.currentBar) {
      if (this.locked) return false;
      const adaptation = this.pendingAdaptation || this.appliedAdaptation;
      const previousMode = this.appliedAdaptation.mode;
      const permission = this.phrasePermission(phrase);
      const current = clamp(this.baseInteractionScaleAt(startBeat)
        + this.motionStateAt(startBeat).tempoOffset, 0.96, 1.04);
      const tempoRange = [permission.tempoRange[0],
        Math.min(permission.tempoRange[1], adaptation.calmMode ? 1.03 : 1.04)];
      const target = clamp(adaptation.tempoScale, tempoRange[0], tempoRange[1]);
      this.tempoScale = current;
      this.tempoScaleRamp = Math.abs(target - current) < 0.0005 ? null : {
        from: current,
        to: target,
        startBeat,
        endBeat: startBeat + adaptation.transitionBeats,
      };
      this.appliedAdaptation = { ...adaptation, tempoScale: target, tempoRange,
        densityBias: permission.allowDensityChange ? adaptation.densityBias : 0 };
      this.pendingAdaptation = null;
      this.activeGesture = { motion: this.appliedAdaptation.motion, startBar: absoluteBar,
        startBeat, transitionBeats: this.appliedAdaptation.transitionBeats, lastStageIndex: 0 };
      if (adaptation.mode !== previousMode) this.lastModeAppliedPhraseId = phrase.id || null;
      this.currentGestureMix = this.mixAtBeat(startBeat);
      this.applyBusMix(this.currentGestureMix, permission, startBeat, startTime,
        this.appliedAdaptation.transitionBeats);
      if (notify) this.onAdaptation({ phase: 'applied', plan: { ...this.appliedAdaptation },
        phrase: this.phraseLabel(phrase), startBeat, stage: this.currentGestureMix.stage,
        actual: { tempoScale: this.interactionScaleAt(startBeat),
          densityBias: this.currentGestureMix.densityBias,
          dynamicDb: this.currentGestureMix.dynamicDb,
          familyGainsDb: { ...this.currentGestureMix.familyGainsDb } } });
      return true;
    }
    updateGestureAtBar(absoluteBar, phrase, startBeat, startTime, durationBeats) {
      if (this.locked) return;
      const mix = this.mixAtBeat(startBeat);
      const permission = this.phrasePermission(phrase);
      this.currentGestureMix = mix;
      this.applyBusMix(mix, permission, startBeat, startTime, Math.max(2, durationBeats));
      if (this.activeGesture && mix.stageIndex !== this.activeGesture.lastStageIndex) {
        this.activeGesture.lastStageIndex = mix.stageIndex;
        this.onAdaptation({ phase: 'motion', plan: { ...this.appliedAdaptation },
          phrase: this.phraseLabel(phrase), startBeat, stage: mix.stage,
          stagePhase: mix.stagePhase,
          actual: { tempoScale: this.interactionScaleAt(startBeat),
            densityBias: mix.densityBias, dynamicDb: mix.dynamicDb,
            familyGainsDb: { ...mix.familyGainsDb } } });
      }
    }
    barInfo(absoluteBar) {
      const barIndex = positiveModulo(absoluteBar, this.plan.totalBars);
      const cycle = Math.floor(absoluteBar / this.plan.totalBars);
      const bar = this.plan.bars[barIndex];
      return { bar, barIndex, startBeat: cycle * this.plan.totalBeats + bar.startBeat };
    }
    absoluteBarStartBeat(absoluteBar) { return this.barInfo(absoluteBar).startBeat; }
    phraseAt(beat) {
      const loopBeat = positiveModulo(beat, this.plan.totalBeats);
      let index = this.plan.phrases.findIndex((phrase) => loopBeat >= phrase.startBeat && loopBeat < phrase.endBeat);
      if (index < 0) index = loopBeat < this.plan.phrases[0].startBeat ? 0 : this.plan.phrases.length - 1;
      const phrase = this.plan.phrases[index];
      const length = Math.max(0.001, phrase.endBeat - phrase.startBeat);
      return { phrase, index, loopBeat, position: clamp((loopBeat - phrase.startBeat) / length, 0, 1) };
    }
    scoreTempoAtBeat(beat) {
      const points = this.plan.tempoMap;
      if (!points.length) {
        const { phrase, position } = this.phraseAt(beat);
        return this.baseBpm * curveAt(phrase.tempoArc, position);
      }
      const loopBeat = positiveModulo(beat, this.plan.totalBeats);
      let low = 0, high = points.length;
      while (low + 1 < high) {
        const middle = (low + high) >> 1;
        if (points[middle].beat <= loopBeat) low = middle; else high = middle;
      }
      const current = points[low];
      const next = points[low + 1];
      if (next?.transitionBeats) {
        const rampStart = Math.max(current.beat, next.beat - next.transitionBeats);
        if (loopBeat >= rampStart) {
          return current.bpm + (next.bpm - current.bpm)
            * smootherstep((loopBeat - rampStart) / Math.max(0.001, next.beat - rampStart));
        }
      }
      return current.bpm;
    }
    tempoAtBeat(beat) {
      return this.scoreTempoAtBeat(beat) * this.interactionScaleAt(beat);
    }
    secondsForBeats(startBeat, beats) {
      const pieces = Math.max(1, Math.ceil(beats * 16));
      const step = beats / pieces;
      let seconds = 0;
      for (let index = 0; index < pieces; index++) {
        seconds += step * 60 / this.tempoAtBeat(startBeat + (index + 0.5) * step);
      }
      return seconds;
    }
    planPhrase(startBeat) {
      const motion = this.motionStateAt(startBeat);
      const densitySignal = clamp(this.performanceAtBeat(startBeat).energy
        + this.appliedAdaptation.densityBias + motion.densityOffset, 0, 1);
      if (densitySignal < 0.28) this.sparse = true;
      else if (densitySignal > 0.38) this.sparse = false;
    }

    expressionDbFor(event) {
      const mix = this.currentGestureMix || this.appliedAdaptation;
      return clamp(Number(mix.dynamicDb || 0)
        + Number(mix.roleGainsDb?.[event.role] || 0)
        + Number(mix.articulationGainsDb?.[event.articulation] || 0), -12, 7);
    }

    selectSample(instrument, articulation, midi, eventVelocity = 0.5) {
      const available = this.samples[samplePatch(instrument, articulation)] || [];
      if (['bassDrum', 'cymbal', 'tamTam'].includes(instrument)) {
        return available.reduce((best, item) => !best
          || Math.abs((item.velocityCenter ?? 0.5) - eventVelocity)
            < Math.abs((best.velocityCenter ?? 0.5) - eventVelocity) ? item : best, null);
      }
      return available.reduce((best, item) =>
        !best || Math.abs(item.rootMidi - midi) < Math.abs(best.rootMidi - midi) ? item : best, null);
    }
    note(event, start, duration, peak, resumed = false) {
      const sample = this.selectSample(event.instrument, event.articulation, event.midi, event.velocity);
      if (!sample) throw new Error(`缺少音色：${event.instrument} ${event.articulation}`);
      const context = this.context;
      const source = context.createBufferSource();
      source.buffer = sample.audio;
      source.playbackRate.value = ['bassDrum', 'cymbal', 'tamTam'].includes(event.instrument)
        ? 1 : 2 ** ((event.midi - sample.rootMidi) / 12);
      const envelope = context.createGain();
      const isPluck = event.articulation === 'pizzicato' || event.articulation === 'pluck'
        || event.articulation === 'strike';
      const isPortato = event.articulation === 'portato';
      const isLegato = event.articulation === 'legato';
      if (isPluck) duration = Math.min(duration, sample.audio.duration / source.playbackRate.value - 0.02);
      if (isPortato) duration *= 0.83;
      const end = start + Math.max(0.08, duration);
      let attack = isPluck ? 0.006 : event.articulation === 'swell' ? Math.min(0.52, duration * 0.3) :
        isPortato ? 0.065 : isLegato ? Math.min(0.16, duration * 0.24) :
          event.instrument === 'doubleBass' ? 0.18 : Math.min(0.23, duration * 0.26);
      if (resumed) attack = Math.min(attack, .035);
      const release = isPluck ? Math.min(0.22, duration * 0.4) :
        isPortato ? Math.min(0.22, duration * 0.42) : Math.min(0.35, duration * 0.32);
      const gain = envelope.gain;
      gain.setValueAtTime(0.0001, start);
      if (event.articulation === 'swell') {
        gain.linearRampToValueAtTime(peak * 0.55, start + attack);
        gain.linearRampToValueAtTime(peak, start + duration * 0.57);
        gain.linearRampToValueAtTime(peak * 0.72, Math.max(start + duration * 0.58, end - release));
      } else {
        gain.linearRampToValueAtTime(peak, start + attack);
        gain.setValueAtTime(peak, Math.max(start + attack, end - release));
      }
      gain.exponentialRampToValueAtTime(0.0001, end);
      source.connect(envelope);
      envelope.connect(this.buses[event.instrument]);
      source.start(start);
      source.stop(end + 0.04);
      this.activeSources.add(source);
      source.onended = () => {
        this.activeSources.delete(source);
        source.disconnect();
        envelope.disconnect();
      };
    }

    buildVisualFrame(absoluteBar, start, timing = 'projected') {
      const { bar, barIndex, startBeat } = this.barInfo(absoluteBar);
      const { phrase } = this.phraseAt(startBeat);
      const entries = [];
      for (const [eventIndex, event] of this.eventsByBar[barIndex].entries()) {
        if (this.sparse && event.optional) continue;
        const localBeat = event.beat - bar.startBeat;
        const eventBeat = startBeat + localBeat;
        const when = start + this.secondsForBeats(startBeat, localBeat);
        const duration = this.secondsForBeats(eventBeat, event.durationBeats);
        const phrasePosition = clamp((event.beat - phrase.startBeat)
          / Math.max(0.001, phrase.endBeat - phrase.startBeat), 0, 1);
        const arc = curveAt(phrase.dynamicArc, phrasePosition);
        const accent = phrase.accents.find((item) => item.bar === event.bar
          && Math.abs(item.beat - localBeat) < 0.12);
        const expression = 10 ** (this.expressionDbFor(event) / 20);
        const peak = clamp(event.velocity * (0.53 + 1.35 * arc)
          * (1 + (accent?.strength || 0)) * expression, 0.025, 0.88);
        entries.push({ event, when, duration, peak, visual: {
          id: `${absoluteBar + 1}:${eventIndex}:${event.instrument}:${event.midi}:${Math.round(localBeat * 1000)}`,
          absoluteBar: absoluteBar + 1,
          arrivalTime: when,
          offsetSeconds: Math.max(0, when - start),
          durationBeats: event.durationBeats,
          durationSeconds: duration,
          midi: event.midi,
          peak,
          family: FAMILY_BY_INSTRUMENT[event.instrument] || 'other',
          instrument: event.instrument,
          role: event.role,
        } });
      }
      return { entries, frame: {
        bar: barIndex + 1,
        absoluteBar: absoluteBar + 1,
        section: this.phraseLabel(phrase),
        audioStartTime: start,
        durationSeconds: this.secondsForBeats(startBeat, bar.durationBeats),
        beats: bar.durationBeats,
        endsPhrase: Math.abs(bar.endBeat - phrase.endBeat) < 0.001,
        generatedAt: Number(this.context?.currentTime) || 0,
        timing,
        notes: entries.map((entry) => entry.visual),
      } };
    }

    scheduleBar(absoluteBar, start) {
      const { bar, barIndex, startBeat } = this.barInfo(absoluteBar);
      const { phrase, index: phraseIndex } = this.phraseAt(startBeat);
      const firstPhraseBar = Math.abs(bar.startBeat - phrase.startBeat) < 0.001;
      const majorModeChange = this.pendingAdaptation
        && this.pendingAdaptation.mode !== this.appliedAdaptation.mode;
      const modeCooldown = majorModeChange && this.lastModeAppliedPhraseId
        && this.lastModeAppliedPhraseId === phrase.id;
      const adaptationDue = this.pendingAdaptation && !modeCooldown && (firstPhraseBar
        || absoluteBar >= this.adaptationRequestedAtBar + 4);
      const appliedNow = adaptationDue
        ? this.applyAdaptationAt(phrase, startBeat, start, true, absoluteBar) : false;
      if (!appliedNow) this.updateGestureAtBar(absoluteBar, phrase, startBeat, start,
        bar.durationBeats);
      if (firstPhraseBar) this.planPhrase(startBeat);
      if (this.sectionIndex !== phraseIndex) {
        this.sectionIndex = phraseIndex;
        this.onSection(this.phraseLabel(phrase), phraseIndex);
      }
      if (Number.isFinite(this.resumeBeat) && Number.isFinite(this.resumeAudioTime)) {
        start = this.resumeAudioTime - this.secondsForBeats(startBeat, this.resumeBeat - startBeat);
        this.nextBarTime = start;
      }
      const visual = this.buildVisualFrame(absoluteBar, start, 'scheduled');
      const cut = this.resumeBeat;
      if (Number.isFinite(cut)) {
        const at = start + this.secondsForBeats(startBeat, cut - startBeat);
        visual.entries = visual.entries.filter(entry => entry.event.beat >= cut);
        // Restore sustained voices that began before the seek point, including earlier bars.
        for (const event of this.plan.events) {
          if (event.beat >= cut || event.beat + event.durationBeats <= cut || (this.sparse && event.optional)) continue;
          const duration = this.secondsForBeats(cut, event.beat + event.durationBeats - cut);
          const visualNote = { id: `seek:${this.transportRevision}:${event.instrument}:${event.midi}:${event.beat}`,
            arrivalTime: at, offsetSeconds: 0, durationSeconds: duration,
            durationBeats: event.beat + event.durationBeats - cut, midi: event.midi,
            peak: event.velocity * .6, family: FAMILY_BY_INSTRUMENT[event.instrument] || 'other', instrument: event.instrument };
          visual.entries.push({ event, when: at, duration, peak: visualNote.peak, visual: visualNote, resumed: true });
        }
        visual.frame.notes = visual.entries.map(entry => entry.visual);
        this.resumeBeat = null;
      }
      for (const entry of visual.entries) this.note(entry.event, entry.when, entry.duration, entry.peak, entry.resumed);
      const segment = { start, startBeat, endBeat: startBeat + bar.durationBeats, points: [{ beat: startBeat, time: start }] };
      let time = start;
      for (let beat = startBeat; beat < segment.endBeat; beat += 1 / 16) {
        const end = Math.min(segment.endBeat, beat + 1 / 16);
        time += this.secondsForBeats(beat, end - beat);
        segment.points.push({ beat: end, time });
      }
      segment.end = time;
      this.transportSegments.push(segment);
      this.transportSegments = this.transportSegments.filter(item => item.end >= (this.context?.currentTime || 0) - 1).slice(-8);
      this.onVisualBar(visual.frame);
      const program = this.programAtBar(barIndex + 1);
      this.onProgress({ bar: barIndex + 1, totalBars: this.plan.totalBars,
        section: this.phraseLabel(phrase), bpm: this.tempoAtBeat(startBeat),
        nextPhraseIn: this.secondsForBeats(startBeat, Math.max(0, phrase.endBeat - bar.startBeat)),
        program });
    }
    programAtBar(barNumber) {
      const programme = this.plan.program;
      if (!programme) return null;
      const item = programme.items.find((entry) => barNumber >= entry.startBar && barNumber <= entry.endBar);
      if (item) {
        const position = (barNumber - item.startBar) / Math.max(1, item.endBar - item.startBar + 1);
        const elapsedSeconds = item.startSecond + item.durationSeconds * position;
        return { phase: 'performance', item, elapsedSeconds,
          remainingSeconds: Math.max(0, this.plan.estimatedDurationSeconds - elapsedSeconds) };
      }
      const intermission = programme.intermissions.find((entry) =>
        barNumber >= entry.startBar && barNumber <= entry.endBar);
      if (intermission) return { phase: 'intermission', item: null,
        elapsedSeconds: intermission.startSecond,
        remainingSeconds: Math.max(0, this.plan.estimatedDurationSeconds - intermission.startSecond) };
      return null;
    }
    phraseLabel(phrase) {
      const section = this.plan.sectionNames?.[phrase.section] || SECTION_NAMES[phrase.section] || phrase.section;
      return [section, phrase.function].filter(Boolean).join(' · ');
    }
    emitVisualWindow(seconds = 8) {
      if (!this.context) return;
      const generatedAt = this.context.currentTime;
      const frames = [];
      let barNumber = this.currentBar;
      let start = this.nextBarTime;
      const limit = generatedAt + seconds;
      while (start < limit && frames.length < 8) {
        if (this.plan.repeat === false && barNumber >= this.plan.totalBars) break;
        const projected = this.buildVisualFrame(barNumber, start, 'projected');
        frames.push(projected.frame);
        const { bar, startBeat } = this.barInfo(barNumber);
        start += this.secondsForBeats(startBeat, bar.durationBeats);
        barNumber++;
      }
      this.onVisualWindow({ generatedAt, frames });
    }
    scheduleAhead(forceFirst = false) {
      if (!this.playing) return;
      let scheduled = 0;
      while ((forceFirst && scheduled === 0) || this.nextBarTime < this.context.currentTime + 0.48) {
        if (this.plan.repeat === false && this.currentBar >= this.plan.totalBars) {
          clearInterval(this.timer);
          this.timer = null;
          const delay = Math.max(0, this.nextBarTime - this.context.currentTime);
          clearTimeout(this.completionTimer);
          this.completionTimer = setTimeout(() => this.finish(), delay * 1000);
          this.emitVisualWindow();
          return;
        }
        this.lastScheduledBar = this.currentBar;
        this.lastScheduledTime = this.nextBarTime;
        this.scheduleBar(this.currentBar, this.nextBarTime);
        const { bar, startBeat } = this.barInfo(this.currentBar);
        this.nextBarTime += this.secondsForBeats(startBeat, bar.durationBeats);
        this.currentBar++;
        scheduled++;
      }
      this.emitVisualWindow();
    }
    finish() {
      if (!this.playing) return;
      this.playing = false;
      this.completed = true;
      this.positionBeat = this.plan.totalBeats;
      this.transportSegments = [];
      clearInterval(this.timer);
      this.timer = null;
      this.currentBar = 0;
      this.lastScheduledBar = 0;
      this.sectionIndex = -1;
      if (this.master && this.context) {
        this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.25);
      }
      this.onComplete();
    }
    interpolate(points, value, input, output) {
      let low = 0, high = points.length - 1;
      if (value <= points[0][input]) return points[0][output];
      if (value >= points[high][input]) return points[high][output];
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (points[middle][input] <= value) low = middle; else high = middle;
      }
      const left = points[low], right = points[high];
      return left[output] + (right[output] - left[output]) * (value - left[input]) / (right[input] - left[input]);
    }
    getPlaybackPosition() {
      let beat = this.positionBeat || 0;
      if (this.playing && this.context) {
        const time = this.context.currentTime;
        const segment = this.transportSegments.find(item => time >= item.start && time < item.end);
        if (segment) beat = this.interpolate(segment.points, time, 'time', 'beat');
        else if (this.transportSegments.length && time >= this.transportSegments.at(-1).end) beat = this.transportSegments.at(-1).endBeat;
      }
      if (!this.completed && this.plan.repeat !== false && beat >= this.plan.totalBeats) beat %= this.plan.totalBeats;
      if (this.playing && this.context.currentTime < this.resumeAudioTime) beat = this.positionBeat;
      beat = clamp(beat, 0, this.plan.totalBeats);
      const seconds = this.interpolate(this.timeIndex, beat, 'beat', 'seconds');
      const item = this.plan.program?.items.find(item => beat >= item.startBeat && beat < item.endBeat) || null;
      return { seconds, beat, durationSeconds: this.durationSeconds,
        remainingSeconds: Math.max(0, this.durationSeconds - seconds), item, completed: this.completed };
    }
    stopTransport() {
      this.playing = false;
      clearInterval(this.timer); clearTimeout(this.completionTimer);
      this.timer = this.completionTimer = null;
      if (this.context) {
        for (const source of this.activeSources) { try { source.stop(this.context.currentTime); } catch {} }
        this.activeSources.clear();
        if (this.room?.buffer) { const impulse = this.room.buffer; this.room.buffer = null; this.room.buffer = impulse; }
        this.master?.gain.cancelScheduledValues?.(this.context.currentTime);
        this.master?.gain.setValueAtTime(0, this.context.currentTime);
      }
      this.transportSegments = [];
    }
    async seekTo(seconds, { resume = this.playing } = {}) {
      const revision = ++this.transportRevision;
      this.stopTransport();
      const target = clamp(Number(seconds) || 0, 0, this.durationSeconds);
      this.positionBeat = this.interpolate(this.timeIndex, target, 'seconds', 'beat');
      this.completed = target >= this.durationSeconds;
      this.sectionIndex = -1;
      this.performanceRamp = this.tempoScaleRamp = null;
      this.tempoScale = this.appliedAdaptation.tempoScale;
      this.activeGesture = null;
      this.lastModeAppliedPhraseId = null;
      this.currentGestureMix = this.appliedAdaptation;
      this.currentBar = Math.max(0, this.plan.bars.findIndex(bar => this.positionBeat < bar.endBeat));
      this.adaptationRequestedAtBar = this.currentBar;
      if (this.context) {
        for (const bus of Object.values(this.buses)) bus.gain?.cancelScheduledValues?.(this.context.currentTime);
      }
      if (this.completed) { this.onComplete(); return this.getPlaybackPosition(); }
      if (resume && revision === this.transportRevision) await this.play();
      return this.getPlaybackPosition();
    }
    async play() {
      const revision = this.transportRevision;
      if (!this.loaded) await this.prepare();
      if (revision !== this.transportRevision || this.playing) return;
      await this.context.resume();
      if (revision !== this.transportRevision) return;
      if (this.completed) this.positionBeat = 0;
      this.completed = false;
      this.playing = true;
      this.currentBar = Math.max(0, this.plan.bars.findIndex(bar => this.positionBeat < bar.endBeat));
      this.resumeBeat = this.positionBeat;
      this.resumeAudioTime = this.context.currentTime + .08;
      const startBeat = this.absoluteBarStartBeat(this.currentBar);
      this.master.gain.setTargetAtTime(this.effectiveVolume(), this.context.currentTime, 0.035);
      this.nextBarTime = this.context.currentTime + 0.08 - this.secondsForBeats(startBeat, this.positionBeat - startBeat);
      this.scheduleAhead(true);
      this.timer = setInterval(() => this.scheduleAhead(), 90);
    }
    async restart() { return this.seekTo(0); }
    async pause() {
      ++this.transportRevision;
      const position = this.getPlaybackPosition();
      this.positionBeat = position.beat;
      this.stopTransport();
      if (this.context) await this.context.suspend();
    }
    currentBpm() {
      if (!this.context) return this.baseBpm;
      const elapsed = Math.max(0, this.context.currentTime - this.lastScheduledTime);
      return this.tempoAtBeat(this.absoluteBarStartBeat(this.lastScheduledBar) + elapsed * this.baseBpm / 60);
    }
  }

  global.OrchestraScore = OrchestraScore;
  global.ORCHESTRA_SCORE_META = { bars: defaultPlan?.totalBars || 0,
    sections: defaultPlan?.phrases?.map((phrase) => phrase.function) || [] };
})(typeof window !== 'undefined' ? window : globalThis);


(function (global) {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const SEMANTIC_EMOTION_SCHEMA = Object.freeze({
    schemaVersion: '1.0',
    required: ['schemaVersion', 'valence', 'arousal', 'tension', 'confidence',
      'narrativeMode', 'paceIntent'],
    narrativeModes: ['reflection', 'tenderness', 'dialogue', 'suspense', 'action', 'grief', 'neutral'],
    paceIntents: ['rising', 'falling', 'steady'],
    ranges: {
      valence: [-1, 1], arousal: [0, 1], tension: [0, 1], confidence: [0, 1],
    },
  });

  function validateEmotionObservation(input) {
    if (!input || typeof input !== 'object') throw new TypeError('情绪输出必须是对象');
    if (input.schemaVersion !== SEMANTIC_EMOTION_SCHEMA.schemaVersion) {
      throw new TypeError(`不支持的情绪协议版本：${input.schemaVersion || '缺失'}`);
    }
    for (const [key, [low, high]] of Object.entries(SEMANTIC_EMOTION_SCHEMA.ranges)) {
      if (!Number.isFinite(input[key]) || input[key] < low || input[key] > high) {
        throw new TypeError(`${key} 必须在 ${low}–${high} 之间`);
      }
    }
    if (!SEMANTIC_EMOTION_SCHEMA.narrativeModes.includes(input.narrativeMode)) {
      throw new TypeError(`未知叙事状态：${input.narrativeMode}`);
    }
    if (!SEMANTIC_EMOTION_SCHEMA.paceIntents.includes(input.paceIntent)) {
      throw new TypeError(`未知节奏意图：${input.paceIntent}`);
    }
    return {
      schemaVersion: '1.0',
      valence: input.valence,
      arousal: input.arousal,
      tension: input.tension,
      confidence: input.confidence,
      narrativeMode: input.narrativeMode,
      paceIntent: input.paceIntent,
      evidence: Array.isArray(input.evidence) ? input.evidence.slice(0, 3).map(String) : [],
      source: input.source || 'unknown',
    };
  }

  class SemanticEmotionProvider {
    async analyze(_text, _context = {}) {
      throw new Error('SemanticEmotionProvider.analyze() 尚未实现');
    }
  }

  const MODE_PROFILES = {
    neutral: {
      label: '中性叙事', valence: 0, arousal: 0.5, tension: 0.35,
      tempoScale: 1, densityBias: 0,
      familyGainsDb: {}, instrumentGainsDb: {}, roleGainsDb: {}, articulationGainsDb: {},
      fingerprint: '全乐团均衡呼吸',
      motion: { cycleBars: 16, stages: [
        { at: 0, label: '自然呼吸', dynamicDb: -0.3 },
        { at: 0.42, label: '自然展开', dynamicDb: 0.5, densityOffset: 0.02 },
        { at: 0.76, label: '轻微抬升', dynamicDb: 0.9, tempoOffset: 0.003 },
        { at: 1, label: '回到平衡', dynamicDb: -0.3 },
      ] },
    },
    reflection: {
      label: '沉思', valence: -0.1, arousal: 0.28, tension: 0.28,
      tempoScale: 0.976, densityBias: -0.08,
      familyGainsDb: { upperStrings: -1.8, lowerStrings: 2.3, woodwinds: 0.5,
        brass: -4.5, percussion: -10, color: 1.2 },
      instrumentGainsDb: { clarinet: 1.4, cello: 1.8, viola: 0.8 },
      roleGainsDb: { lead: -0.8, reply: 2.2, counter: 1.6, orchestralBody: -2.4, color: 1.2 },
      articulationGainsDb: { legato: 1.2, sustain: 0.4, portato: -1.2, strike: -6 },
      fingerprint: '中低弦独白，单簧管像记忆般回应',
      motion: { cycleBars: 16, stages: [
        { at: 0, label: '独白', dynamicDb: -1.8, densityOffset: -0.03,
          instrumentGainsDb: { cello: 1.5, clarinet: -0.5 } },
        { at: 0.3, label: '回想', dynamicDb: -0.7, tempoOffset: -0.003,
          familyGainsDb: { woodwinds: 1.2 }, instrumentGainsDb: { clarinet: 1.8 },
          roleGainsDb: { reply: 1.5 } },
        { at: 0.64, label: '思绪展开', dynamicDb: 1.1, densityOffset: 0.05,
          familyGainsDb: { lowerStrings: 1.2, upperStrings: 0.8 }, roleGainsDb: { counter: 1.2 } },
        { at: 0.84, label: '欲言又止', dynamicDb: -2.2, densityOffset: -0.05,
          tempoOffset: -0.006, familyGainsDb: { woodwinds: -1.4 } },
        { at: 1, label: '独白', dynamicDb: -1.8, densityOffset: -0.03,
          instrumentGainsDb: { cello: 1.5, clarinet: -0.5 } },
      ] },
    },
    tenderness: {
      label: '温柔', valence: 0.65, arousal: 0.32, tension: 0.18,
      tempoScale: 0.988, densityBias: -0.01,
      familyGainsDb: { upperStrings: 2.1, lowerStrings: 0.5, woodwinds: 1.2,
        brass: -3.5, percussion: -12, color: 2.2 },
      instrumentGainsDb: { flute: 1.1, oboe: 1.3, harp: 1.8, violin1: 0.8 },
      roleGainsDb: { lead: 1.2, color: 2.2, reply: 0.8, bass: -1.2, orchestralBody: -0.8 },
      articulationGainsDb: { legato: 1.8, swell: 2.2, pluck: 0.8, tremolo: -2.5, strike: -8 },
      fingerprint: '高弦长线与竖琴微光，木管温柔接力',
      motion: { cycleBars: 18, stages: [
        { at: 0, label: '轻触', dynamicDb: -2, densityOffset: -0.04,
          instrumentGainsDb: { harp: 1.2, violin1: -0.4 } },
        { at: 0.28, label: '靠近', dynamicDb: -0.4,
          familyGainsDb: { upperStrings: 1, woodwinds: 0.8 }, articulationGainsDb: { legato: 0.8 } },
        { at: 0.58, label: '相拥', dynamicDb: 1.7, densityOffset: 0.05,
          instrumentGainsDb: { violin1: 1.2, oboe: 0.8 }, roleGainsDb: { lead: 1 } },
        { at: 0.8, label: '余温', dynamicDb: -0.8, tempoOffset: -0.004,
          familyGainsDb: { woodwinds: -0.8 }, instrumentGainsDb: { harp: 1.5 } },
        { at: 1, label: '轻触', dynamicDb: -2, densityOffset: -0.04,
          instrumentGainsDb: { harp: 1.2, violin1: -0.4 } },
      ] },
    },
    dialogue: {
      label: '对白', valence: 0.08, arousal: 0.48, tension: 0.35,
      tempoScale: 1, densityBias: -0.04,
      familyGainsDb: { upperStrings: -1.5, lowerStrings: -0.8, woodwinds: 3.2,
        brass: -4.5, percussion: -10, color: -1 },
      instrumentGainsDb: { clarinet: 1.2, oboe: 1.2, flute: 0.6, bassoon: 0.5 },
      roleGainsDb: { lead: 0.4, reply: 3.4, counter: 2.3, orchestralBody: -3.2, bass: -1 },
      articulationGainsDb: { portato: 2.2, legato: 0.8, sustain: -0.5, strike: -7 },
      fingerprint: '木管问答，弦乐退为轻薄的语气背景',
      motion: { cycleBars: 12, stages: [
        { at: 0, label: '提问', dynamicDb: -1, instrumentGainsDb: { oboe: 2, clarinet: -1,
          flute: -1 }, roleGainsDb: { lead: 1.2, reply: -0.8 } },
        { at: 0.27, label: '应答', dynamicDb: 0.3, instrumentGainsDb: { oboe: -1,
          clarinet: 2.2, bassoon: 1 }, roleGainsDb: { lead: -0.8, reply: 1.8 } },
        { at: 0.54, label: '交谈', dynamicDb: 1.1, densityOffset: 0.06,
          familyGainsDb: { upperStrings: 1.2 }, instrumentGainsDb: { flute: 1.4 },
          roleGainsDb: { counter: 1.2 } },
        { at: 0.82, label: '留白', dynamicDb: -2.6, densityOffset: -0.08,
          tempoOffset: -0.004, familyGainsDb: { woodwinds: -1.5 } },
        { at: 1, label: '提问', dynamicDb: -1, instrumentGainsDb: { oboe: 2,
          clarinet: -1, flute: -1 }, roleGainsDb: { lead: 1.2, reply: -0.8 } },
      ] },
    },
    suspense: {
      label: '悬念', valence: -0.48, arousal: 0.64, tension: 0.86,
      tempoScale: 1.004, densityBias: -0.02,
      familyGainsDb: { upperStrings: -1.5, lowerStrings: 3.4, woodwinds: -0.5,
        brass: 1.2, percussion: -1.5, color: -3 },
      instrumentGainsDb: { bassoon: 2.2, horn: 2.4, timpani: 1.2, flute: -3,
        doubleBass: 1.5 },
      roleGainsDb: { lead: -1.2, bass: 2, counter: 1, color: -3, orchestralBody: 0.6 },
      articulationGainsDb: { tremolo: 3.8, swell: 3, sustain: 0.8, pizzicato: 1.2, strike: 0.5 },
      fingerprint: '低弦暗流、圆号阴影与逐步逼近的颤弓',
      motion: { cycleBars: 16, stages: [
        { at: 0, label: '潜伏', dynamicDb: -2.4, densityOffset: -0.08,
          familyGainsDb: { percussion: -4 }, instrumentGainsDb: { doubleBass: 1 } },
        { at: 0.3, label: '阴影浮现', dynamicDb: -0.8,
          familyGainsDb: { lowerStrings: 1.2, brass: 0.6 }, articulationGainsDb: { tremolo: 1 } },
        { at: 0.6, label: '步步逼近', dynamicDb: 1.8, densityOffset: 0.08,
          tempoOffset: 0.008, instrumentGainsDb: { horn: 1.2, timpani: 1.4 },
          articulationGainsDb: { tremolo: 1.8, swell: 1 } },
        { at: 0.82, label: '悬停', dynamicDb: -1.4, densityOffset: -0.05,
          tempoOffset: -0.006, familyGainsDb: { upperStrings: -1.2 },
          instrumentGainsDb: { timpani: -2 } },
        { at: 1, label: '潜伏', dynamicDb: -2.4, densityOffset: -0.08,
          familyGainsDb: { percussion: -4 }, instrumentGainsDb: { doubleBass: 1 } },
      ] },
    },
    action: {
      label: '行动', valence: 0.02, arousal: 0.9, tension: 0.76,
      tempoScale: 1.025, densityBias: 0.1,
      familyGainsDb: { upperStrings: 2.4, lowerStrings: 1.4, woodwinds: -2,
        brass: 3.5, percussion: 3, color: -4 },
      instrumentGainsDb: { trumpet: 1.8, trombone: 1.2, timpani: 2.2,
        bassDrum: 1.2, violin1: 0.8 },
      roleGainsDb: { lead: 1, bass: 1.2, orchestralBody: 1.5, reply: -1.5, color: -3 },
      articulationGainsDb: { portato: 3, tremolo: 2.2, strike: 3.2, swell: 1.2, legato: -1.2 },
      fingerprint: '弦乐推进、铜管接管峰值、打击乐形成脉冲',
      motion: { cycleBars: 12, stages: [
        { at: 0, label: '起跑', dynamicDb: -0.4, densityOffset: 0.02,
          familyGainsDb: { brass: -1, percussion: -0.8 }, articulationGainsDb: { portato: 1 } },
        { at: 0.25, label: '推进', dynamicDb: 1.2, densityOffset: 0.06,
          tempoOffset: 0.005, familyGainsDb: { upperStrings: 0.8, percussion: 0.8 } },
        { at: 0.56, label: '冲刺', dynamicDb: 2.8, densityOffset: 0.1,
          tempoOffset: 0.012, familyGainsDb: { brass: 1.2, percussion: 1.2 },
          instrumentGainsDb: { trumpet: 1, timpani: 1 }, articulationGainsDb: { strike: 1.5 } },
        { at: 0.8, label: '喘息', dynamicDb: -1.8, densityOffset: -0.05,
          tempoOffset: -0.006, familyGainsDb: { brass: -1.8, percussion: -2.5 } },
        { at: 1, label: '起跑', dynamicDb: -0.4, densityOffset: 0.02,
          familyGainsDb: { brass: -1, percussion: -0.8 }, articulationGainsDb: { portato: 1 } },
      ] },
    },
    grief: {
      label: '悲恸', valence: -0.82, arousal: 0.2, tension: 0.55,
      tempoScale: 0.968, densityBias: -0.1,
      familyGainsDb: { upperStrings: -2.2, lowerStrings: 3.8, woodwinds: 0.8,
        brass: -5, percussion: -12, color: -2 },
      instrumentGainsDb: { cello: 3, viola: 1.3, doubleBass: 1.2, bassoon: 2.4,
        oboe: 0.8 },
      roleGainsDb: { lead: 0.8, counter: 2, bass: 0.8, color: -3, orchestralBody: -1.8 },
      articulationGainsDb: { legato: 2.4, swell: 2.8, sustain: 0.6, portato: -2, strike: -10 },
      fingerprint: '大提琴哀歌从压抑走向一次克制的浪涌',
      motion: { cycleBars: 20, stages: [
        { at: 0, label: '哽咽', dynamicDb: -2.8, densityOffset: -0.07,
          instrumentGainsDb: { cello: 1.2 }, roleGainsDb: { lead: -0.6 } },
        { at: 0.25, label: '下沉', dynamicDb: -1.2, tempoOffset: -0.004,
          familyGainsDb: { lowerStrings: 1 }, instrumentGainsDb: { bassoon: 1 } },
        { at: 0.55, label: '哀歌涌起', dynamicDb: 2.2, densityOffset: 0.07,
          familyGainsDb: { upperStrings: 1.8, lowerStrings: 1.2 },
          instrumentGainsDb: { cello: 1.5, oboe: 1 }, articulationGainsDb: { swell: 1.5 } },
        { at: 0.78, label: '力竭', dynamicDb: -3.2, densityOffset: -0.1,
          tempoOffset: -0.009, familyGainsDb: { upperStrings: -2, woodwinds: -1.5 } },
        { at: 1, label: '哽咽', dynamicDb: -2.8, densityOffset: -0.07,
          instrumentGainsDb: { cello: 1.2 }, roleGainsDb: { lead: -0.6 } },
      ] },
    },
  };

  const FAMILY_BY_INSTRUMENT = {
    violin1: 'upperStrings', violin2: 'upperStrings',
    viola: 'lowerStrings', cello: 'lowerStrings', doubleBass: 'lowerStrings',
    flute: 'woodwinds', oboe: 'woodwinds', clarinet: 'woodwinds', bassoon: 'woodwinds',
    horn: 'brass', trumpet: 'brass', trombone: 'brass', tuba: 'brass',
    timpani: 'percussion', bassDrum: 'percussion', cymbal: 'percussion', tamTam: 'percussion',
    harp: 'color',
  };

  class SemanticTextWindow {
    constructor({ minNewCharacters = 80, targetMinCharacters = 300, maxCharacters = 800,
      minIntervalSeconds = 30, maxWindowSeconds = 120 } = {}) {
      this.minNewCharacters = minNewCharacters;
      this.targetMinCharacters = targetMinCharacters;
      this.maxCharacters = maxCharacters;
      this.minIntervalSeconds = minIntervalSeconds;
      this.maxWindowSeconds = maxWindowSeconds;
      this.lastAnalyzedText = '';
      this.lastAnalyzedAt = Number.NEGATIVE_INFINITY;
      this.chapterSummary = '';
    }

    setChapterSummary(summary) {
      this.chapterSummary = String(summary || '').trim().slice(-600);
    }

    selectParagraphs(text) {
      const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
      if (!normalized) return { text: '', paragraphCount: 0 };
      const paragraphs = normalized.split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
      const selected = [];
      let characters = 0;
      for (let index = paragraphs.length - 1; index >= 0; index--) {
        const paragraph = paragraphs[index];
        if (selected.length >= 2 && characters >= this.targetMinCharacters) break;
        selected.unshift(paragraph);
        characters += Array.from(paragraph).length;
        if (characters >= this.maxCharacters) break;
      }
      const joined = selected.join('\n\n');
      return { text: Array.from(joined).slice(-this.maxCharacters).join(''),
        paragraphCount: selected.length };
    }

    consider(text, { nowSeconds = Date.now() / 1000, isComposing = false,
      paragraphCompleted = false } = {}) {
      if (isComposing) return { ready: false, reason: 'composing' };
      const current = String(text || '');
      const newCharacters = Math.max(0,
        Array.from(current).length - Array.from(this.lastAnalyzedText).length);
      if (newCharacters < this.minNewCharacters) {
        return { ready: false, reason: 'insufficient-new-text', newCharacters };
      }
      const elapsed = nowSeconds - this.lastAnalyzedAt;
      if (!paragraphCompleted && elapsed < this.minIntervalSeconds) {
        return { ready: false, reason: 'rate-limited', newCharacters,
          retryAfterSeconds: this.minIntervalSeconds - elapsed };
      }
      const selected = this.selectParagraphs(current);
      return {
        ready: true,
        reason: paragraphCompleted ? 'paragraph-complete'
          : elapsed >= this.maxWindowSeconds ? 'max-window' : 'interval',
        ...selected,
        newCharacters,
        chapterSummary: this.chapterSummary,
      };
    }

    commit(text, { nowSeconds = Date.now() / 1000 } = {}) {
      this.lastAnalyzedText = String(text || '');
      this.lastAnalyzedAt = nowSeconds;
    }
  }

  class EmotionObservationCache {
    constructor({ maxEntries = 64 } = {}) {
      this.maxEntries = maxEntries;
      this.entries = new Map();
    }

    key(text, context = {}) {
      const source = `${String(text || '')}\u241f${String(context.chapterSummary || '')}`;
      let hash = 2166136261;
      for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `emotion-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    get(text, context) {
      const key = this.key(text, context);
      const value = this.entries.get(key);
      if (!value) return null;
      this.entries.delete(key);
      this.entries.set(key, value);
      return clone(value);
    }

    set(text, context, observation) {
      const key = this.key(text, context);
      this.entries.set(key, clone(observation));
      while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
      return key;
    }
  }

  class HunyuanSemanticEmotionProvider extends SemanticEmotionProvider {
    constructor({ endpoint = '/sheng-sui-bi-xing-demo/api/semantic-emotion', transport = null, enabled = false } = {}) {
      super();
      this.endpoint = endpoint;
      this.transport = transport;
      this.enabled = enabled;
    }

    async analyze(text, { chapterSummary = '', allowTextUpload = false, signal } = {}) {
      if (!this.enabled || !allowTextUpload) {
        throw new Error('语义适配尚未由用户开启，正文不会发送');
      }
      const request = {
        text: String(text || ''),
        chapterSummary: String(chapterSummary || ''),
        schema: SEMANTIC_EMOTION_SCHEMA,
        temperature: 0,
      };
      let response;
      if (this.transport) response = await this.transport(request, { signal });
      else {
        if (typeof fetch !== 'function') throw new Error('当前环境没有可用的后端传输');
        const result = await fetch(this.endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request), signal,
        });
        if (!result.ok) throw new Error(`语义代理返回 ${result.status}`);
        response = await result.json();
      }
      return validateEmotionObservation({ ...response, source: response?.source || 'hunyuan-proxy' });
    }
  }

  class MockSemanticEmotionProvider extends SemanticEmotionProvider {
    async analyze(_text = '', { mode = 'neutral' } = {}) {
      const profile = MODE_PROFILES[mode];
      if (!profile) throw new Error(`Unknown mock emotion mode: ${mode}`);
      return validateEmotionObservation({
        schemaVersion: '1.0',
        valence: profile.valence,
        arousal: profile.arousal,
        tension: profile.tension,
        confidence: mode === 'neutral' ? 0.82 : 0.94,
        narrativeMode: mode,
        paceIntent: profile.arousal > 0.62 ? 'rising'
          : profile.arousal < 0.35 ? 'falling' : 'steady',
        evidence: [`本地预设：${profile.label}`, profile.fingerprint],
        source: 'local-mock',
      });
    }
  }

  class EmotionStabilizer {
    constructor({ clock = () => Date.now(), minConfidence = 0.55, deadband = 0.08 } = {}) {
      this.clock = clock;
      this.minConfidence = minConfidence;
      this.deadband = deadband;
      this.lastAt = clock();
      this.history = [];
      this.state = {
        valence: 0, arousal: 0.5, tension: 0.35,
        confidence: 0, narrativeMode: 'neutral', paceIntent: 'steady',
      };
      this.snapshot = this.makeSnapshot('initial', null);
    }

    normalize(observation) {
      const mode = MODE_PROFILES[observation?.narrativeMode] ? observation.narrativeMode : 'neutral';
      return {
        valence: clamp(Number(observation?.valence) || 0, -1, 1),
        arousal: clamp(Number(observation?.arousal) || 0, 0, 1),
        tension: clamp(Number(observation?.tension) || 0, 0, 1),
        confidence: clamp(Number(observation?.confidence) || 0, 0, 1),
        narrativeMode: mode,
        paceIntent: ['rising', 'falling', 'steady'].includes(observation?.paceIntent)
          ? observation.paceIntent : 'steady',
      };
    }

    tauFor(key, rising) {
      if (key === 'valence') return rising ? 90 : 120;
      if (key === 'tension') return rising ? 60 : 90;
      return rising ? 50 : 90;
    }

    ingest(rawObservation, { elapsedSeconds } = {}) {
      const now = this.clock();
      const observation = this.normalize(rawObservation);
      const elapsed = clamp(Number.isFinite(elapsedSeconds)
        ? elapsedSeconds : (now - this.lastAt) / 1000, 0, 180);
      this.lastAt = now;
      if (observation.confidence < this.minConfidence || elapsed <= 0) {
        this.snapshot = this.makeSnapshot('held-low-confidence', observation);
        return this.snapshot;
      }
      const distance = Math.max(
        Math.abs(observation.valence - this.state.valence) / 2,
        Math.abs(observation.arousal - this.state.arousal),
        Math.abs(observation.tension - this.state.tension),
      );
      if (distance < this.deadband) {
        this.state.confidence = observation.confidence;
        this.snapshot = this.makeSnapshot('held-deadband', observation);
        return this.snapshot;
      }
      const previous = { ...this.state };
      for (const key of ['valence', 'arousal', 'tension']) {
        const tau = this.tauFor(key, observation[key] >= this.state[key]);
        const alpha = 1 - Math.exp(-elapsed / tau);
        this.state[key] = clamp(this.state[key]
          + alpha * observation.confidence * (observation[key] - this.state[key]),
        key === 'valence' ? -1 : 0, 1);
      }
      this.state.confidence = observation.confidence;
      this.state.narrativeMode = observation.narrativeMode;
      this.state.paceIntent = observation.paceIntent;
      this.history.push({ elapsed, previous, current: { ...this.state } });
      this.history = this.history.slice(-3);
      this.snapshot = this.makeSnapshot('accepted', observation);
      return this.snapshot;
    }

    forecast() {
      const last = this.history.at(-1);
      if (!last || last.elapsed <= 0) return { ...this.state };
      const output = { ...this.state };
      for (const key of ['valence', 'arousal', 'tension']) {
        const slope = (last.current[key] - last.previous[key]) / last.elapsed;
        const projected = clamp(slope * 30, -0.12, 0.12);
        output[key] = clamp(this.state[key] + projected, key === 'valence' ? -1 : 0, 1);
      }
      return output;
    }

    makeSnapshot(status, observation) {
      return {
        status,
        observation: observation ? { ...observation } : null,
        smoothed: { ...this.state },
        forecast: this.forecast(),
      };
    }
  }

  class OrchestrationPlanner {
    plan(emotion, { engagement = 0.5, calmMode = false } = {}) {
      const mode = MODE_PROFILES[emotion?.narrativeMode] ? emotion.narrativeMode : 'neutral';
      const profile = MODE_PROFILES[mode];
      const arousalCorrection = clamp((Number(emotion?.arousal ?? profile.arousal) - profile.arousal) * 0.025,
        -0.008, 0.008);
      const limitMap = (map, positiveLimit, negativeLimit = 12) => Object.fromEntries(
        Object.entries(map || {}).map(([key, value]) => [key,
          clamp(Number(value) || 0, -negativeLimit, positiveLimit)]),
      );
      const motion = clone(profile.motion);
      if (calmMode) {
        for (const stage of motion.stages) {
          stage.tempoOffset = clamp(Number(stage.tempoOffset) || 0, -0.006, 0.004);
          stage.densityOffset = clamp(Number(stage.densityOffset) || 0, -0.1, 0);
          stage.dynamicDb = clamp(Number(stage.dynamicDb) || 0, -3.5, 1.2);
          stage.familyGainsDb = limitMap(stage.familyGainsDb, 1.2, 6);
          stage.instrumentGainsDb = limitMap(stage.instrumentGainsDb, 1.2, 6);
          stage.roleGainsDb = limitMap(stage.roleGainsDb, 1.5, 6);
          stage.articulationGainsDb = limitMap(stage.articulationGainsDb, 1.5, 8);
        }
      }
      const familyGainsDb = limitMap(profile.familyGainsDb, calmMode ? 2.2 : 12);
      if (calmMode && Number(familyGainsDb.percussion) > 0.8) familyGainsDb.percussion = 0.8;
      return {
        schemaVersion: '1.0',
        mode,
        label: profile.label,
        calmMode,
        confidence: clamp(Number(emotion?.confidence) || 0, 0, 1),
        tempoScale: clamp(profile.tempoScale + arousalCorrection, 0.96, calmMode ? 1.012 : 1.04),
        densityBias: clamp(profile.densityBias + (clamp(engagement, 0, 1) - 0.5) * 0.04,
          -0.12, calmMode ? 0.03 : 0.12),
        familyGainsDb,
        instrumentGainsDb: limitMap(profile.instrumentGainsDb, calmMode ? 2.2 : 12),
        roleGainsDb: limitMap(profile.roleGainsDb, calmMode ? 2.5 : 12),
        articulationGainsDb: limitMap(profile.articulationGainsDb, calmMode ? 2.5 : 12),
        fingerprint: profile.fingerprint,
        motion,
        transitionBeats: mode === 'action' ? 20 : 24,
        emotion: {
          valence: clamp(Number(emotion?.valence ?? profile.valence), -1, 1),
          arousal: clamp(Number(emotion?.arousal ?? profile.arousal), 0, 1),
          tension: clamp(Number(emotion?.tension ?? profile.tension), 0, 1),
        },
      };
    }

    static familyForInstrument(instrument) {
      return FAMILY_BY_INSTRUMENT[instrument] || 'other';
    }
  }

  class SemanticAdaptationController {
    constructor({ provider, textWindow = new SemanticTextWindow(),
      cache = new EmotionObservationCache(), stabilizer = new EmotionStabilizer(),
      planner = new OrchestrationPlanner() } = {}) {
      if (!(provider instanceof SemanticEmotionProvider)) {
        throw new TypeError('provider 必须实现 SemanticEmotionProvider');
      }
      this.provider = provider;
      this.textWindow = textWindow;
      this.cache = cache;
      this.stabilizer = stabilizer;
      this.planner = planner;
      this.lastPlan = planner.plan(stabilizer.snapshot.forecast);
    }

    async consider(text, options = {}) {
      const selection = this.textWindow.consider(text, options);
      if (!selection.ready) return { status: 'held', reason: selection.reason,
        snapshot: this.stabilizer.snapshot, plan: this.lastPlan };
      const context = { chapterSummary: selection.chapterSummary };
      try {
        let observation = this.cache.get(selection.text, context);
        const cached = Boolean(observation);
        if (!observation) {
          observation = await this.provider.analyze(selection.text, {
            ...context,
            allowTextUpload: Boolean(options.allowTextUpload),
            signal: options.signal,
          });
          observation = validateEmotionObservation(observation);
          this.cache.set(selection.text, context, observation);
        }
        const nowSeconds = Number.isFinite(options.nowSeconds) ? options.nowSeconds : Date.now() / 1000;
        const sinceLast = nowSeconds - this.textWindow.lastAnalyzedAt;
        const elapsedSeconds = Number.isFinite(options.elapsedSeconds)
          ? options.elapsedSeconds : Math.min(this.textWindow.maxWindowSeconds,
            Math.max(this.textWindow.minIntervalSeconds,
              Number.isFinite(sinceLast) ? sinceLast : this.textWindow.maxWindowSeconds));
        const snapshot = this.stabilizer.ingest(observation, { elapsedSeconds });
        this.lastPlan = this.planner.plan(snapshot.forecast, {
          engagement: options.engagement, calmMode: options.calmMode,
        });
        this.textWindow.commit(text, options);
        return { status: snapshot.status, cached, selection, observation, snapshot,
          plan: this.lastPlan };
      } catch (error) {
        return { status: 'held-provider-error', reason: error.message,
          selection, snapshot: this.stabilizer.snapshot, plan: this.lastPlan };
      }
    }
  }

  global.SEMANTIC_EMOTION_SCHEMA = clone(SEMANTIC_EMOTION_SCHEMA);
  global.validateEmotionObservation = validateEmotionObservation;
  global.SemanticEmotionProvider = SemanticEmotionProvider;
  global.SemanticTextWindow = SemanticTextWindow;
  global.EmotionObservationCache = EmotionObservationCache;
  global.HunyuanSemanticEmotionProvider = HunyuanSemanticEmotionProvider;
  global.MockSemanticEmotionProvider = MockSemanticEmotionProvider;
  global.EmotionStabilizer = EmotionStabilizer;
  global.OrchestrationPlanner = OrchestrationPlanner;
  global.SemanticAdaptationController = SemanticAdaptationController;
  global.ORCHESTRATION_EMOTION_PROFILES = clone(MODE_PROFILES);
})(typeof window !== 'undefined' ? window : globalThis);

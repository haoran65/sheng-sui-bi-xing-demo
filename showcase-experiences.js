(function (global) {
  'use strict';
  const moods = {
    reflection: { label: '回望', energy: .28, pace: '舒缓',
      text: '她推开门，旧屋依然安静。桌上放着那封泛黄的信，窗外的雨声，把许多年前的傍晚慢慢带了回来。',
      interpretation: '文字慢慢回望，音乐也留出更长的呼吸。', arrangement: '步调舒缓，低弦与木管慢慢回应。' },
    suspense: { label: '悬念', energy: .88, pace: '紧凑',
      text: '她推开门，灯突然熄灭。桌上的信还未拆开，走廊里便响起急促的脚步。她屏住呼吸，那声音停在了门外。',
      interpretation: '文字里的紧张向前推进，音乐的步调也更紧凑。', arrangement: '节奏收紧，低弦与颤音推动悬念。' },
    tenderness: { label: '温暖', energy: .56, pace: '从容',
      text: '她推开门，暖黄的灯还亮着。桌上留着一碗热汤，他笑着接过她的外套。窗外雨声很轻，屋里终于有了久违的安心。',
      interpretation: '文字落在安心的相逢里，音乐从容而柔和。', arrangement: '步调从容，弦乐与竖琴轻轻舒展。' },
  };
  function comparisonPlan(source) {
    // Same four original bars for all moods; never change the melody to simulate emotion.
    const phrase = source.phrases.find(item => item.bars[0] === 17);
    return { ...source, title: '同一乐句 · 原创序曲第 17–20 小节', totalBars: 4,
      totalBeats: 16, repeat: false, bars: undefined, tempoMap: [],
      phrases: [{ ...phrase, bars: [1, 4], startBeat: 0, endBeat: 16,
        accents: phrase.accents.map(item => ({ ...item, bar: item.bar - 16 })),
        techniqueCues: phrase.techniqueCues.map(item => ({ ...item, bar: item.bar - 16 })) }],
      events: source.events.filter(item => item.bar >= 17 && item.bar <= 20)
        .map(item => ({ ...item, bar: item.bar - 16, beat: item.beat - 64 })),
    };
  }
  class AudioFocus {
    constructor() { this.owners = new Map(); this.owner = null; }
    register(id, stop) { this.owners.set(id, stop); }
    claim(id) { this.owner = id; this.owners.forEach((stop, key) => { if (key !== id) stop(); }); }
    stopAll() { this.owner = null; this.owners.forEach(stop => stop()); }
  }
  class EmotionPlayer {
    constructor({ onState = () => {}, onFrame = () => {}, onWindow = () => {}, canPlay = () => true,
      engineFactory = options => new global.OrchestraScore(options),
      planner = new global.OrchestrationPlanner(), source = global.ORCHESTRA_PERFORMANCE } = {}) {
      Object.assign(this, { onState, onFrame, onWindow, canPlay, engineFactory, planner, source });
      this.mode = 'reflection'; this.state = 'idle'; this.version = 0; this.engine = null; this.pending = null;
    }
    emit(extra = {}) { this.onState({ state: this.state, mode: this.mode, ...extra }); }
    async select(mode) {
      if (!moods[mode] || this.mode === mode) return;
      const wasActive = ['playing', 'loading'].includes(this.state);
      this.stop(); this.mode = mode; this.emit();
      if (wasActive) await this.play();
    }
    async play() {
      if (!this.canPlay() || this.disposed) return;
      const version = ++this.version;
      this.state = 'loading'; this.emit();
      let engine;
      try {
        const previous = this.engine; this.engine = null;
        if (previous) { await previous.pause(); await previous.context?.close(); }
        if (version !== this.version || this.disposed) return;
        {
          engine = this.engineFactory({ plan: comparisonPlan(this.source),
            onLoading: (done, total) => { if (this.state === 'loading') this.emit({ done, total }); },
            onVisualBar: this.onFrame, onVisualWindow: this.onWindow,
            onComplete: () => { if (engine === this.engine && this.state === 'playing') { this.state = 'ended'; this.emit(); } },
          });
          this.engine = engine;
          this.pending = engine.prepare();
        }
        await this.pending;
        if (version !== this.version || this.disposed) return;
        if (!this.canPlay()) { this.stop(); return; }
        await engine.pause();
        await engine.restart();
        if (version !== this.version || !this.canPlay()) return;
        engine.setVolume(.48);
        const mood = moods[this.mode];
        engine.setPerformanceControl({ energy: mood.energy, charge: mood.energy, forecast: mood.energy, confidence: 1 });
        engine.queueAdaptation(this.planner.plan({ narrativeMode: this.mode, confidence: 1 }, { engagement: mood.energy }));
        await engine.play();
        if (version !== this.version || !this.canPlay()) { await engine.pause(); return; }
        this.state = 'playing'; this.emit();
      } catch {
        if (version !== this.version) return;
        const failed = this.engine; this.engine = null; this.pending = null;
        this.state = 'error'; this.emit();
        try { await failed?.pause(); await failed?.context?.close(); } catch { /* Failed preparation. */ }
      }
    }
    stop() {
      ++this.version;
      if (['playing', 'loading'].includes(this.state)) { this.state = 'paused'; this.emit(); }
      this.engine?.pause().catch(() => {});
    }
    async dispose() { this.disposed = true; this.stop(); try { await this.engine?.context?.close(); } catch { /* Already closed. */ } }
  }
  global.ShowcaseAudioFocus = AudioFocus;
  global.ShowcaseEmotionPlayer = EmotionPlayer;
  global.ShowcaseComparisonPlan = comparisonPlan;
  global.ShowcaseExperienceMoods = moods;

  global.initShowcaseExperiences = function ({ pauseDemo }) {
    const $ = id => document.getElementById(id);
    const all = selector => [...document.querySelectorAll(selector)];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const visible = node => { const rect = node.getBoundingClientRect(); return !document.hidden && rect.top < innerHeight && rect.bottom > 0; };
    const focus = new AudioFocus(); focus.register('demo', pauseDemo);

    const rhythm = $('rhythm-lab'), rhythmSection = $('rhythm');
    const phrase = Array.from('雨停之后，她没有急着寻找答案，只想把此刻的风、光和心事，慢慢写下来。');
    const stages = { begin: ['先落下第一句', '不必刻意快写。每一次落笔，慢慢积累成音乐的力量。'],
      flow: ['文字连贯，乐团展开', '持续书写让音乐更丰盈，旋律与伴奏渐渐舒展。'],
      think: ['停笔构思，先保留呼吸', '短暂的留白不打断音乐。想得久一些，演奏才逐渐收束。'] };
    let rhythmFrame = null, rhythmAt = 0, rhythmAnchor = 0, rhythmRunning = false, rhythmStarted = false;
    all('.breath-ensemble i').forEach((node, index) => { node.style.setProperty('--bar', String(index)); node.style.setProperty('--height', `${24 + Math.sin(index / 14 * Math.PI) * 110}px`); });
    for (let index = 0; index < 26; index++) { const key = document.createElement('i'); key.style.setProperty('--key', String(index)); document.querySelector('.rhythm-keystrokes').append(key); }
    function rhythmRender() {
      const phase = rhythmAt < 3500 ? 'begin' : rhythmAt < 10000 ? 'flow' : 'think';
      rhythm.dataset.phase = phase; rhythm.dataset.release = String(rhythmAt >= 16000);
      $('rhythm-words').textContent = phrase.slice(0, Math.min(phrase.length, 5 + Math.floor(Math.min(rhythmAt, 10000) / 270))).join('');
      $('rhythm-response-title').textContent = stages[phase][0]; $('rhythm-response-copy').textContent = stages[phase][1];
      all('[data-rhythm-state]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rhythmState === phase)));
    }
    function rhythmPause() { rhythmRunning = false; rhythm.dataset.running = 'false'; cancelAnimationFrame(rhythmFrame); rhythmFrame = null; $('rhythm-toggle').textContent = rhythmAt >= 20000 ? '重播节奏动画' : '播放节奏动画'; }
    function rhythmTick(now) {
      if (!rhythmRunning) return;
      if (!visible(rhythmSection)) { rhythmPause(); return; }
      rhythmAt = Math.min(20000, now - rhythmAnchor); rhythmRender();
      if (rhythmAt >= 20000) rhythmPause(); else rhythmFrame = requestAnimationFrame(rhythmTick);
    }
    function rhythmPlay() {
      if (reduced.matches) { rhythmPause(); return; }
      rhythmStarted = true; if (rhythmAt >= 20000) rhythmAt = 0;
      rhythmRunning = true; rhythm.dataset.running = 'true'; rhythmAnchor = performance.now() - rhythmAt;
      $('rhythm-toggle').textContent = '暂停节奏动画'; rhythmFrame = requestAnimationFrame(rhythmTick);
    }
    $('rhythm-toggle').addEventListener('click', () => rhythmRunning ? rhythmPause() : rhythmPlay());
    all('[data-rhythm-state]').forEach(button => button.addEventListener('click', () => {
      rhythmStarted = true; rhythmAt = { begin: 0, flow: 6500, think: 13000 }[button.dataset.rhythmState]; rhythmPause(); rhythmRender();
    }));
    function reducedRhythm() { rhythmPause(); $('rhythm-toggle').hidden = reduced.matches; }
    reduced.addEventListener('change', reducedRhythm); reducedRhythm();

    let emotionRail;
    const emotionNode = $('emotion'), emotionButton = $('emotion-play');
    const emotion = new EmotionPlayer({ canPlay: () => focus.owner === 'emotion' && visible(emotionNode),
      onFrame: frame => emotionRail?.enqueue(frame), onWindow: data => emotionRail?.enqueueWindow(data),
      onState: state => {
        const mood = moods[state.mode]; $('emotion-listener').dataset.state = state.state;
        all('[data-emotion]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.emotion === state.mode)));
        $('emotion-text').textContent = mood.text;
        $('emotion-label').textContent = mood.label; $('emotion-interpretation').textContent = mood.interpretation;
        $('emotion-arrangement').textContent = mood.arrangement;
        $('emotion-pace').textContent = `${mood.pace} · 同一音乐片段`;
        emotionButton.textContent = state.state === 'loading' ? '取消准备' : state.state === 'playing' ? '暂停试听' : state.state === 'error' ? '重试试听' : `试听${mood.label}`;
        $('emotion-status').textContent = state.state === 'loading' ? `正在准备音色${state.total ? ` · ${state.done} / ${state.total}` : '…'}`
          : state.state === 'playing' ? `正在演绎 · ${mood.pace}` : state.state === 'error' ? '音色加载失败，请重试。仍可阅读配器说明。'
          : state.state === 'paused' ? '已暂停 · 再次试听从同一乐句起点开始' : state.state === 'ended' ? '这一句结束了，换一段文字再听。' : '选择一段文字，听它的节奏。';
        if (emotionRail) { emotionRail.setPlaying(state.state === 'playing'); if (state.state !== 'playing') emotionRail.clear(); }
      },
    });
    emotion.emit();
    emotionRail = new global.ScoreRailVisualizer($('emotion-score'), { clock: () => emotion.engine?.context?.currentTime || 0 });
    focus.register('emotion', () => emotion.stop());
    emotionButton.disabled = false;
    emotionButton.addEventListener('click', () => {
      if (['playing', 'loading'].includes(emotion.state)) emotion.stop();
      else { focus.claim('emotion'); emotion.play(); }
    });
    all('[data-emotion]').forEach(button => button.addEventListener('click', () => emotion.select(button.dataset.emotion)));

  const seatPlan = [
    { instrument: 'timpani', x: 34, y: 15, size: 8.8, tilt: -3, gain: 1 },
    { instrument: 'bassDrum', x: 45, y: 15, size: 8.8, tilt: -1, gain: 1 },
    { instrument: 'cymbal', x: 56, y: 15, size: 8.5, tilt: 2, gain: 1 },
    { instrument: 'tamTam', x: 67, y: 15, size: 8.8, tilt: 3, gain: 1 },
    { instrument: 'horn', x: 31, y: 32, size: 8.2, tilt: -8, gain: 1 },
    { instrument: 'trumpet', x: 44, y: 32, size: 8, tilt: -3, gain: 1 },
    { instrument: 'trombone', x: 57, y: 32, size: 8.4, tilt: 3, gain: 1 },
    { instrument: 'tuba', x: 70, y: 32, size: 8.6, tilt: 7, gain: 1 },
    { instrument: 'flute', x: 36, y: 49, size: 7.5, tilt: -25, gain: 1 },
    { instrument: 'oboe', x: 46, y: 49, size: 7.4, tilt: -10, gain: 1 },
    { instrument: 'clarinet', x: 56, y: 49, size: 7.4, tilt: 10, gain: 1 },
    { instrument: 'bassoon', x: 66, y: 49, size: 7.7, tilt: 24, gain: 1 },
    { instrument: 'harp', x: 12, y: 45, size: 10.2, tilt: -4, gain: 1 },
    { instrument: 'violin1', x: 15, y: 65, size: 7.4, tilt: -20, gain: 1 },
    { instrument: 'violin1', x: 23, y: 72, size: 7.4, tilt: -13, gain: .92 },
    { instrument: 'violin1', x: 31, y: 77, size: 7.4, tilt: -6, gain: .84 },
    { instrument: 'violin2', x: 38, y: 72, size: 7.4, tilt: -2, gain: 1 },
    { instrument: 'violin2', x: 45, y: 77, size: 7.4, tilt: 4, gain: .92 },
    { instrument: 'violin2', x: 52, y: 79, size: 7.4, tilt: 9, gain: .84 },
    { instrument: 'viola', x: 60, y: 77, size: 7.6, tilt: 13, gain: 1 },
    { instrument: 'viola', x: 67, y: 73, size: 7.6, tilt: 17, gain: .92 },
    { instrument: 'cello', x: 75, y: 67, size: 8.2, tilt: 12, gain: 1 },
    { instrument: 'cello', x: 81, y: 60, size: 8.2, tilt: 8, gain: .92 },
    { instrument: 'doubleBass', x: 88, y: 50, size: 9.3, tilt: 5, gain: 1 },
  ];
    const guide = global.OrchestraInstrumentGuide;
    let selected = 'violin1';
    const audition = new global.InstrumentAudition({ onState: state => {
      const name = guide.instruments[selected].name;
      $('showcase-instrument-listen').textContent = state === 'loading' ? '取消准备' : state === 'playing' ? '停止试听' : ['unavailable','blocked'].includes(state) ? `重试试听${name}` : `试听${name}`;
      $('showcase-instrument-listen').dataset.state = state;
      $('hall-preview-status').textContent = state === 'loading' ? '正在准备音色…' : state === 'playing' ? `正在试听 · ${name}` : state === 'unavailable' ? '音色暂不可用，点击重试。' : state === 'blocked' ? '点击试听按钮开启声音。' : `已选择 · ${name}`;
      all('.showcase-instrument-seat').forEach(seat => { seat.dataset.sounding = String(state === 'playing' && seat.dataset.instrument === selected); });
    }});
    focus.register('instrument', () => audition.stop());
    const seatContainer = $('showcase-orchestra-seats'), seen = new Set();
    const mobileRows = { percussion: [16,[20,40,60,80]], brass: [34,[20,40,60,80]], woodwinds: [52,[20,40,60,80]], strings: [73,[10,30,50,70,90]], color: [91,[16]] };
    seatPlan.forEach(config => {
      const item = guide.instruments[config.instrument], seat = document.createElement('button');
      seat.type = 'button'; seat.className = `showcase-instrument-seat family-${item.family}`;
      seat.dataset.instrument = item.id; seat.dataset.duplicate = String(seen.has(item.id)); seen.add(item.id);
      seat.setAttribute('aria-label', `了解${item.name}`); seat.setAttribute('aria-pressed', String(item.id === selected)); seat.setAttribute('aria-controls', 'showcase-instrument-detail');
      for (const key of ['x','y','size','tilt']) seat.style.setProperty(`--${key}`, String(config[key]));
      seat.style.setProperty('--mobile-x', String(mobileRows[item.family][1][guide.families[item.family].members.indexOf(item.id)]));
      seat.style.setProperty('--mobile-y', String(mobileRows[item.family][0]));
      const icon = document.createElement('i'); icon.setAttribute('aria-hidden','true'); icon.style.setProperty('--icon-image', `url('/sheng-sui-bi-xing-demo/assets/images/orchestra-icons/${item.asset}')`);
      const label = document.createElement('span'); label.textContent = item.name; label.setAttribute('aria-hidden','true');
      seat.append(icon,label); seat.addEventListener('click', () => selectInstrument(item.id)); seatContainer.append(seat);
    });
    function selectInstrument(id) {
      audition.stop(); selected = id; const item = guide.instruments[id];
      $('family-title').textContent = guide.families[item.family].label;
      for (const key of ['name','timbre','role','together','note']) $('showcase-instrument-'+key).textContent = item[key];
      $('showcase-instrument-image').src = '/sheng-sui-bi-xing-demo/assets/images/orchestra-icons/' + item.asset; $('showcase-instrument-image').alt = item.name;
      $('showcase-instrument-listen').textContent = `试听${item.name}`; $('hall-preview-status').textContent = `已选择 · ${item.name}`;
      all('.showcase-instrument-seat').forEach(seat => { seat.setAttribute('aria-pressed', String(seat.dataset.instrument === id)); seat.dataset.familyActive = String(guide.instruments[seat.dataset.instrument].family === item.family); });
      all('[data-family]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.family === item.family)));
      $('showcase-instrument-members').replaceChildren(...guide.families[item.family].members.map(member => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = guide.instruments[member].name;
        button.setAttribute('aria-pressed', String(member === id)); button.addEventListener('click', () => selectInstrument(member)); return button;
      }));
      $('showcase-instrument-parts').replaceChildren(...item.parts.flatMap(([name, description]) => { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = name; detail.textContent = description; return [term,detail]; }));
    }
    all('[data-family]').forEach(button => button.addEventListener('click', () => selectInstrument(guide.families[button.dataset.family].members[0])));
    $('showcase-instrument-listen').disabled = false;
    $('showcase-instrument-listen').addEventListener('click', () => {
      if (['playing','loading'].includes($('showcase-instrument-listen').dataset.state)) audition.stop();
      else { focus.claim('instrument'); audition.play(guide.instruments[selected]); }
    });
    selectInstrument(selected);
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.target === rhythmSection) {
        if (entry.isIntersecting && entry.intersectionRatio > .25 && !rhythmStarted && !reduced.matches) rhythmPlay();
        if (!entry.isIntersecting) rhythmPause();
      } else if (!entry.isIntersecting) {
        if (entry.target === emotionNode) emotion.stop(); else audition.stop();
      }
    }), { threshold: [0,.25] });
    observer.observe(rhythmSection); observer.observe(emotionNode); observer.observe($('orchestra'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) { focus.stopAll(); rhythmPause(); } });
    all('.app-entry').forEach(link => link.addEventListener('click', () => focus.stopAll()));
    addEventListener('pagehide', () => { focus.stopAll(); rhythmPause(); emotionRail.clear(); emotion.dispose(); audition.dispose(); });
    addEventListener('pageshow', event => { if (event.persisted) { emotion.disposed = false; emotion.engine = null; emotion.pending = null; emotion.state = 'idle'; emotion.emit(); } });
    reduced.addEventListener('change', () => { emotionRail.reducedMotion = reduced.matches; emotionRail.clear(); });
    return focus;
  };
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
  'use strict';
  const KEY = 'sonata-first-notes-v2';
  const stages = ['welcome', 'first-reward', 'slow', 'slow-reward', 'fast', 'fast-reward', 'library', 'needle', 'complete'];
  const rewards = { 'first-reward': ['slow', 2500], 'slow-reward': ['fast', 4000], 'fast-reward': ['library', 2000] };
  const copy = {
    welcome: '随便写点什么', 'first-reward': '听，它在回应你。',
    slow: '试点其他的？我们慢慢打？', 'slow-reward': '对，就是这个节奏。',
    fast: '这次，放开写，快一点。', 'fast-reward': '让它热烈起来。',
    library: '给这段文字，挑一张唱片。', needle: '轻触唱针，继续写。', complete: '接下来，随你。',
  };
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  function cadence(times) {
    if (times.length < 2) return null;
    const recent = times.slice(-6);
    const intervals = recent.slice(1).map((time, index) => time - recent[index]);
    return intervals.every((time) => time > 0) ? median(intervals) : null;
  }
  function rhythmPasses(stage, times, baseline = null) {
    if (!['slow', 'fast'].includes(stage) || times.length < 3) return false;
    const current = cadence(times.slice(-3));
    if (current === null) return false;
    // One initial character has no measurable tempo. Let that user explore too.
    if (!(baseline > 0)) return true;
    return stage === 'slow' ? current > baseline : current < baseline;
  }
  // Receives timestamps and committed edits, never the contents of pressed keys.
  class FirstNotesFlow {
    constructor({ stage = 'welcome', baseline = {}, clock = () => Date.now(), onChange = () => {}, onReward = () => {}, onHint = () => {}, onHandoff = (done) => done(), onFinish = () => {} } = {}) {
      Object.assign(this, { clock, onChange, onReward, onHint, onHandoff, onFinish });
      this.stage = stages.includes(stage) ? stage : 'welcome';
      this.text = '';
      this.paused = false;
      this.generation = 0;
      this.baseline = Object.fromEntries(['hardware', 'committed'].map((source) => [source,
        Number.isFinite(baseline?.[source]) && baseline[source] > 0 ? baseline[source] : null]));
      this.resetRhythm();
    }
    resetRhythm(keepHint = false) {
      this.times = [];
      this.commitTimes = [];
      this.hasHardware = false;
      this.pendingHardware = false;
      this.lastInputAt = null;
      if (!keepHint) this.lastHintAt = -Infinity;
      this.needsHint = false;
    }
    start() { this.onChange(this.stage); if (rewards[this.stage]) this.reward(); }
    enter(stage) {
      if (this.stage === 'welcome' && stage === 'first-reward') {
        this.baseline = { hardware: cadence(this.times), committed: cadence(this.commitTimes) };
      }
      this.generation++;
      this.cancelHandoff?.();
      this.cancelHandoff = null;
      this.handoffPending = false;
      this.stage = stage;
      this.resetRhythm();
      this.onChange(stage);
      if (rewards[stage]) this.reward();
    }
    reward() {
      const stage = this.stage;
      const generation = ++this.generation;
      this.onReward(stage, () => {
        if (!this.paused && this.stage === stage && this.generation === generation) this.enter(rewards[stage][0]);
      }, rewards[stage][1]);
    }
    pulse(at = this.clock()) {
      if (this.paused || !['welcome', 'slow', 'fast'].includes(this.stage)) return;
      if (this.times.length && at - this.times.at(-1) > 3000) this.resetRhythm(true);
      this.times.push(at);
      this.times = this.times.slice(-6);
      this.pendingHardware = true;
      this.hasHardware = true;
    }
    input({ text, inserted = 0, kind = 'insert' }) {
      this.text = text;
      if (this.paused || this.stage === 'complete' || rewards[this.stage]) return;
      this.lastInputAt = this.clock();
      if (!['welcome', 'slow', 'fast'].includes(this.stage)) return;
      if (!(inserted > 0) || kind !== 'insert') { this.pendingHardware = false; return; }
      if (!text.trim()) { this.pendingHardware = false; return; }
      const at = this.clock();
      if (this.commitTimes.length && at - this.commitTimes.at(-1) > 3000) this.resetRhythm(true);
      this.lastInputAt = at;
      this.commitTimes.push(at);
      this.commitTimes = this.commitTimes.slice(-6);
      this.pendingHardware = false;
      if (this.stage === 'welcome') return;
      const source = this.hasHardware ? 'hardware' : 'committed';
      const times = this.hasHardware ? this.times : this.commitTimes;
      if (rhythmPasses(this.stage, times, this.baseline[source])) this.enter(`${this.stage}-reward`);
      else this.needsHint = times.length >= 3;
    }
    confirm(composing = false) {
      if (!composing && !this.paused && this.stage === 'welcome' && this.text.trim()) this.enter('first-reward');
    }
    tick() {
      if (this.paused || this.lastInputAt === null) return;
      const now = this.clock();
      if (now - this.lastInputAt < 900) return;
      if (this.stage === 'welcome' && this.text.trim()) this.enter('first-reward');
      else if (this.needsHint && now - this.lastHintAt >= 4000) {
        this.lastHintAt = now;
        this.needsHint = false;
        this.onHint(this.stage === 'slow' ? '再慢一点，让字停一停。' : '再快一点，连着写。');
      }
      if (now - this.lastInputAt > 3000) this.resetRhythm(true);
    }
    update({ loaded, playing, busy }) {
      if (this.handoffPending && (!loaded || !playing || busy)) {
        this.generation++;
        this.cancelHandoff?.();
        this.cancelHandoff = null;
        this.handoffPending = false;
      }
      if (this.stage === 'library' && loaded && !busy) this.enter('needle');
      if (this.stage === 'needle' && !loaded && !busy) this.enter('library');
      if (!this.paused && this.stage === 'needle' && playing && !busy && !this.handoffPending) {
        this.handoffPending = true;
        const generation = ++this.generation;
        this.cancelHandoff = this.onHandoff(() => {
          if (!this.paused && this.stage === 'needle' && this.generation === generation) this.finish();
        });
      }
    }
    pause() {
      this.paused = true; this.generation++; this.resetRhythm();
      this.cancelHandoff?.(); this.cancelHandoff = null; this.handoffPending = false;
    }
    resume() {
      this.paused = false;
      this.resetRhythm();
      if (this.stage === 'welcome' && this.text.trim()) this.lastInputAt = this.clock();
      if (rewards[this.stage]) this.reward();
    }
    finish() {
      if (this.stage === 'complete') return;
      this.enter('complete');
      this.onFinish();
    }
  }
  function readProgress(storage) {
    try {
      const progress = JSON.parse(storage?.getItem(KEY) || 'null');
      return progress?.version === 2 && stages.includes(progress.stage) ? progress : null;
    } catch { return null; }
  }
  function initialStage(storage, text) {
    const progress = readProgress(storage);
    if (progress) return progress.stage === 'complete' ? null : progress.stage;
    try { if (storage?.getItem('sonata-first-notes-v1') === 'done') return null; } catch { /* Optional storage. */ }
    return text.trim() ? null : 'welcome';
  }
  function inputKey(event) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
    return (event.key?.length === 1 && Boolean(event.key.trim()))
      || /^(Key[A-Z]|Digit\d|Numpad\d|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/.test(event.code || '');
  }
  class FirstNotes {
    constructor({ editor, storage, clock = () => Date.now(), onStart = () => {}, onFinish = () => {}, onReward, openLibrary = () => {}, layoutLibrary = () => {}, unlockAudio = () => {} }) {
      Object.assign(this, { editor, storage, clock, onStart, onFinish, onReward, openLibrary, layoutLibrary, unlockAudio });
      this.root = document.documentElement;
      this.element = document.querySelector('#first-notes');
      this.copy = document.querySelector('#guide-copy');
      this.dismiss = document.querySelector('#guide-dismiss-btn');
      this.audioButton = document.querySelector('#guide-audio-btn');
      this.dock = document.querySelector('.conductor-dock');
      this.state = {};
      this.replay = false;
      this.active = false;
      this.blocks = ['.topbar', '.writing-head', '.writing-footer', '.conductor-stage', '.conductor-dock', '#orchestra-face'].map((selector) => document.querySelector(selector)).filter(Boolean);
      this.dismiss.addEventListener('click', () => this.finish());
      document.querySelector('#guide-restart-btn').addEventListener('click', () => this.restart());
      editor.addEventListener('pointerdown', () => this.interact());
      this.audioButton?.addEventListener('click', () => this.unlockAudio());
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && this.active && !event.isComposing && !this.composing) { event.preventDefault(); this.finish(); }
      });
      document.addEventListener('visibilitychange', () => {
        if (!this.active) return;
        if (document.hidden) { this.flow.pause(); this.cancelReward?.(); clearTimeout(this.libraryTimer); }
        else {
          this.flow.resume(); this.unlockAudio(); this.flow.update(this.state);
          if (this.flow.stage === 'library') this.scheduleLibrary();
        }
      });
      const resize = () => {
        const viewport = global.visualViewport;
        this.root.style.setProperty('--guide-height', `${viewport?.height || global.innerHeight}px`);
        this.root.style.setProperty('--guide-offset', `${viewport?.offsetTop || 0}px`);
        this.layoutLibrary();
      };
      global.addEventListener('resize', resize);
      global.visualViewport?.addEventListener('resize', resize);
      global.visualViewport?.addEventListener('scroll', resize);
      document.querySelector('.conductor-dock')?.addEventListener('animationend', () => this.layoutLibrary());
      resize();
      const stage = initialStage(storage, editor.value);
      if (stage) this.begin(stage);
      else delete this.root.dataset.firstNotes;
      this.timer = setInterval(() => { if (this.active && !this.composing) this.flow.tick(); }, 100);
    }
    begin(stage = 'welcome') {
      clearTimeout(this.finishTimer);
      this.active = true;
      this.originalSurface = this.dock?.dataset.surface;
      if (this.dock) this.dock.dataset.surface = 'bare';
      this.interacted = false;
      this.repeatInput = false;
      this.originalPlaceholder = this.editor.placeholder;
      this.editor.placeholder = '';
      this.editor.setAttribute('aria-describedby', 'guide-copy');
      this.onStart({ replay: this.replay });
      this.inertBefore = new Map(this.blocks.map((block) => [block, block.inert]));
      this.flow = new FirstNotesFlow({ stage, baseline: this.replay ? {} : readProgress(this.storage)?.baseline, clock: this.clock,
        onChange: (next) => this.render(next), onHint: (text) => { this.copy.textContent = text; },
        onHandoff: (done) => this.expandPlayer(done),
        onReward: (reward, done, duration) => this.playReward(reward, done, duration), onFinish: () => this.complete() });
      this.flow.text = this.editor.value;
      if (stage === 'welcome' && this.editor.value.trim()) this.flow.lastInputAt = this.clock();
      this.flow.start();
      if (document.hidden) { this.flow.pause(); this.cancelReward?.(); }
      else if (!global.matchMedia('(pointer: coarse)').matches) this.editor.focus({ preventScroll: true });
    }
    persist(stage) {
      if (this.replay) return;
      try { this.storage?.setItem(KEY, JSON.stringify({ version: 2, stage, baseline: this.flow.baseline })); } catch { /* Still works in memory. */ }
    }
    render(stage) {
      clearTimeout(this.libraryTimer);
      this.persist(stage);
      // Keep the source layout until complete() measures it for the transition.
      if (stage !== 'complete') this.root.dataset.firstNotes = stage;
      this.element.dataset.lesson = stage;
      this.element.dataset.interacted = String(this.interacted);
      this.copy.textContent = copy[stage];
      this.element.hidden = false;
      this.root.dataset.guideEmpty = String(!this.editor.value);
      const collection = ['library', 'needle', 'complete'].includes(stage);
      for (const block of this.blocks) {
        const dock = block.classList.contains('conductor-dock');
        block.inert = stage === 'complete' ? this.inertBefore.get(block) : !(dock && collection);
      }
      if (stage === 'library') {
        if (global.matchMedia('(pointer: coarse)').matches) this.editor.blur();
        this.scheduleLibrary();
      }
    }
    scheduleLibrary() {
      clearTimeout(this.libraryTimer);
      const open = () => {
        if (this.active && !document.hidden && this.flow.stage === 'library') { this.layoutLibrary(); this.openLibrary(); }
      };
      if (global.matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(open);
      else this.libraryTimer = setTimeout(open, 1700);
    }
    expandPlayer(done) {
      if (!this.dock || global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (this.dock) this.dock.dataset.surface = 'expanded';
        done();
        return;
      }
      this.dock.dataset.surface = 'opening';
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.dock.removeEventListener('animationend', onEnd);
        this.dock.dataset.surface = 'expanded';
        done();
      };
      const onEnd = (event) => { if (event.animationName === 'player-surface-unfold') finish(); };
      this.dock.addEventListener('animationend', onEnd);
      // The timeout also supports browsers that omit pseudo-element animation events.
      const timer = setTimeout(finish, 1350);
      return () => {
        settled = true;
        clearTimeout(timer);
        this.dock.removeEventListener('animationend', onEnd);
        if (this.dock.dataset.surface === 'opening') this.dock.dataset.surface = 'bare';
      };
    }
    interact() {
      if (!this.active) return;
      this.interacted = true;
      this.element.dataset.interacted = 'true';
      this.unlockAudio();
    }
    key(event) {
      if (!this.active) return;
      this.repeatInput = Boolean(event.repeat);
      this.interact();
      if (inputKey(event)) this.flow.pulse();
      if (event.key === 'Enter') this.flow.confirm(this.composing || event.isComposing || event.keyCode === 229);
    }
    input(edit) {
      if (!this.active) return;
      this.interact();
      this.root.dataset.guideEmpty = String(!edit.text);
      this.flow.input({ ...edit, kind: this.repeatInput ? 'repeat' : edit.kind });
    }
    keyUp() { this.repeatInput = false; }
    playReward(stage, done, duration) {
      this.cancelReward?.();
      this.burst(stage);
      if (this.onReward) this.cancelReward = this.onReward(stage, done);
      else { const timer = setTimeout(done, duration); this.cancelReward = () => clearTimeout(timer); }
    }
    burst(stage) {
      const layer = document.querySelector('#guide-note-burst');
      layer.replaceChildren();
      if (global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const editor = this.editor.getBoundingClientRect();
      const staff = document.querySelector('#score-rail').getBoundingClientRect();
      for (let index = 0; index < 5; index++) {
        const note = document.createElement('span');
        note.textContent = index % 2 ? '♫' : '♪';
        note.style.left = `${editor.left + editor.width / 2}px`;
        note.style.top = `${editor.top + 22}px`;
        note.style.setProperty('--note-dx', `${staff.left + staff.width * (.3 + index * .1) - editor.left - editor.width / 2}px`);
        note.style.setProperty('--note-dy', `${staff.top + staff.height / 2 - editor.top - 22}px`);
        note.style.animationDelay = `${index * (stage === 'fast-reward' ? 35 : 65)}ms`;
        note.addEventListener('animationend', () => note.remove(), { once: true });
        layer.append(note);
      }
    }
    update(state = {}) { this.state = { ...this.state, ...state }; if (this.active) this.flow.update(this.state); }
    finish() { if (this.active) this.flow.finish(); }
    complete() {
      const moving = [document.querySelector('.writing-sheet'), this.dock].filter(Boolean);
      const before = moving.map((element) => element.getBoundingClientRect());
      this.active = false;
      clearTimeout(this.libraryTimer);
      if (this.dock && this.dock.dataset.surface !== 'expanded') {
        if (this.originalSurface) this.dock.dataset.surface = this.originalSurface;
        else delete this.dock.dataset.surface;
      }
      this.cancelReward?.();
      this.cancelReward = null;
      document.querySelector('#guide-note-burst').replaceChildren();
      this.audioButton.hidden = true;
      this.editor.placeholder = this.originalPlaceholder;
      this.editor.removeAttribute('aria-describedby');
      for (const block of this.blocks) block.inert = this.inertBefore.get(block);
      delete this.root.dataset.firstNotes;
      delete this.root.dataset.guideEmpty;
      this.onFinish({ replay: this.replay });
      if (!global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        moving.forEach((element, index) => {
          if (!element.animate) return;
          const after = element.getBoundingClientRect();
          const from = before[index];
          if (!after.width || !after.height || !from.width || !from.height) return;
          element.animate([
            { transformOrigin: '0 0', transform: `translate(${from.left - after.left}px, ${from.top - after.top}px) scale(${from.width / after.width}, ${from.height / after.height})` },
            { transformOrigin: '0 0', transform: 'none' },
          ], { duration: 850, easing: 'cubic-bezier(.22,1,.36,1)' });
        });
      }
      this.replay = false;
      this.finishTimer = setTimeout(() => { this.element.hidden = true; }, 1800);
    }
    restart() { if (this.active) this.finish(); this.replay = true; this.begin(); }
  }
  global.FirstNotesFlow = FirstNotesFlow;
  global.FirstNotesRhythm = rhythmPasses;
  global.FirstNotesInitialStage = initialStage;
  global.FirstNotesInputKey = inputKey;
  global.FirstNotes = FirstNotes;
})(typeof window !== 'undefined' ? window : globalThis);

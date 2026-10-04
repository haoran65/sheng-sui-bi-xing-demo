(function (global) {
  'use strict';
  const DURATION = 60000;
  const PASSAGE = Array.from('雨停后的车站，像一只缓慢醒来的钟。林秋站在第三站台，听见檐下的水滴逐渐稀疏。她把行李放在长椅旁，展开那封迟到了许多年的信。字迹有些模糊，熟悉的停顿却还留在纸上。远处的灯亮了。她没有急着寻找答案，只想把此刻的风、光和心事，慢慢写下来。故事尚未结束，下一句正在向她走来。');
  class ShowcaseTimeline {
    constructor() {
      this.now = 0; this.text = ''; this.index = 0; this.nextSample = 1000;
      this.model = new global.PredictiveConductor({ clock: () => this.now, storage: null });
      this.snapshot = this.model.snapshot; this.events = [];
      let cursor = 0;
      const add = at => {
        this.events.push({ at: at - 80, type: 'down' }, { at, type: 'up' },
          { at, type: 'text', value: PASSAGE[cursor++ % PASSAGE.length] });
      };
      for (let at = 500; at < 30000; at += at < 10000 ? 650 : 280) add(at);
      add(30000);
      for (let at = 50300; at <= 60000; at += 330) add(at);
      this.events.sort((a, b) => a.at - b.at);
    }
    advanceTo(elapsed) {
      const target = Math.max(0, Math.min(DURATION, elapsed));
      if (target < this.now) throw new Error('演示时间不能倒退，请重建时间线');
      while (true) {
        const event = this.events[this.index];
        const next = Math.min(event?.at ?? Infinity, this.nextSample);
        if (next > target) break;
        this.now = next;
        if (event && event.at <= this.nextSample) {
          if (event.type === 'down') this.model.recordKeyDown();
          else if (event.type === 'up') this.model.recordKeyUp();
          else { this.text += event.value; this.model.record({ characters: 1 }); }
          this.index++;
        } else { this.snapshot = this.model.sample(); this.nextSample += 1000; }
      }
      this.now = target;
      const stage = target >= 60000 ? 'ended' : target >= 50000 ? 'resume'
        : target >= 30000 ? (this.snapshot.pauseSeconds > 12 ? 'release' : 'think')
        : target < 10000 ? 'begin' : 'flow';
      return { elapsed: target, progress: target / DURATION, text: this.text,
        stage, snapshot: this.snapshot, done: target >= DURATION };
    }
  }
  class ShowcasePresentation {
    constructor({ onChange = () => {}, onFrame = () => {}, onWindow = () => {},
      engineFactory = options => new global.OrchestraScore(options), canPlay = () => true,
      clock = () => global.performance.now(),
      requestFrame = callback => global.requestAnimationFrame(callback),
      cancelFrame = handle => global.cancelAnimationFrame(handle) } = {}) {
      Object.assign(this, { onChange, onFrame, onWindow, engineFactory, canPlay, clock, requestFrame, cancelFrame });
      this.timeline = new ShowcaseTimeline(); this.state = 'idle'; this.elapsed = 0;
      this.silent = false; this.engine = null; this.preparation = null; this.version = 0;
      this.requested = false; this.frame = null; this.disposed = false; this.reason = '';
      this.emit();
    }
    emit(extra = {}) {
      this.onChange({ ...this.timeline.advanceTo(this.elapsed), state: this.state,
        silent: this.silent, reason: this.reason, ...extra });
    }
    time() { return this.silent ? this.clock() / 1000 : this.engine.context.currentTime; }
    async play({ silent = this.silent } = {}) {
      if (this.disposed || !this.canPlay() || this.state === 'playing' || this.state === 'loading') return;
      if (this.state === 'ended' || silent !== this.silent) { await this.reset(); }
      this.silent = silent; this.requested = true; this.reason = '';
      const token = ++this.version;
      this.state = 'loading'; this.emit();
      try {
        if (!silent) {
          if (!this.engine) this.engine = this.engineFactory({
            onLoading: (done, total) => { if (this.state === 'loading') this.emit({ loading: { done, total } }); },
            onVisualBar: frame => this.onFrame(frame), onVisualWindow: data => this.onWindow(data),
          });
          const engine = this.engine;
          this.preparation ??= engine.prepare();
          await this.preparation;
          if (token !== this.version || !this.requested) return;
          if (!this.canPlay()) { await this.pause('离开演示区域'); return; }
          engine.setVolume(.48);
          engine.setPerformanceControl(this.timeline.snapshot);
          await engine.play();
          if (token !== this.version || !this.requested) { if (!this.requested) await engine.pause(); return; }
          if (!this.canPlay()) { await this.pause('离开演示区域'); return; }
        }
        if (token !== this.version || this.disposed) return;
        this.anchor = silent ? this.time() : (this.engine.resumeAudioTime ?? this.time() + .8);
        this.anchorElapsed = this.elapsed; this.state = 'playing'; this.emit(); this.schedule();
      } catch {
        if (token !== this.version || this.disposed) return;
        this.requested = false; this.state = 'error';
        const failed = this.engine; this.engine = null; this.preparation = null;
        await this.releaseEngine(failed);
        if (token === this.version && !this.disposed) this.emit();
      }
    }
    schedule() {
      if (this.frame !== null || this.state !== 'playing') return;
      this.frame = this.requestFrame(() => { this.frame = null; this.tick(); });
    }
    tick() {
      if (this.state !== 'playing') return;
      this.elapsed = Math.min(DURATION, this.anchorElapsed + Math.max(0, this.time() - this.anchor) * 1000);
      const data = this.timeline.advanceTo(this.elapsed);
      if (!this.silent) this.engine.setPerformanceControl(data.snapshot);
      if (data.done) {
        this.state = 'ended'; this.requested = false; this.reason = '';
        this.engine?.pause().catch(() => {});
      }
      this.emit(); this.schedule();
    }
    async pause(reason = '') {
      if (this.disposed || !['playing', 'loading'].includes(this.state)) return;
      if (this.state === 'playing') {
        this.elapsed = Math.min(DURATION, this.anchorElapsed + Math.max(0, this.time() - this.anchor) * 1000);
      }
      this.requested = false; ++this.version;
      if (this.frame !== null) this.cancelFrame(this.frame);
      this.frame = null; this.reason = reason;
      this.state = this.elapsed >= DURATION ? 'ended' : 'paused';
      this.emit(); await this.engine?.pause();
    }
    async seekTo(seconds, { resume = this.state === 'playing' } = {}) {
      if (this.disposed || this.state === 'loading') return;
      await this.pause('调整演示进度');
      const token = ++this.version;
      this.elapsed = Math.max(0, Math.min(DURATION, Number(seconds) * 1000 || 0));
      this.timeline = new ShowcaseTimeline();
      const data = this.timeline.advanceTo(this.elapsed);
      if (this.engine) {
        this.engine.setPerformanceControl(data.snapshot);
        await this.engine.seekTo(this.elapsed / 1000, { resume: false });
      }
      if (token !== this.version || this.disposed) return;
      this.state = this.elapsed >= DURATION ? 'ended' : 'paused'; this.reason = '';
      this.emit();
      if (resume && this.state !== 'ended' && this.canPlay()) await this.play();
    }
    async releaseEngine(engine) {
      if (!engine) return;
      try { await engine.pause(); } catch { /* A failed preparation may not have an audio graph. */ }
      try { if (engine.context?.state !== 'closed') await engine.context?.close(); } catch { /* Already closed. */ }
    }
    async reset() {
      this.requested = false; ++this.version;
      if (this.frame !== null) this.cancelFrame(this.frame);
      this.frame = null;
      const old = this.engine; this.engine = null; this.preparation = null;
      this.elapsed = 0; this.timeline = new ShowcaseTimeline(); this.state = 'idle'; this.reason = '';
      this.emit(); await this.releaseEngine(old);
    }
    async restart() { const silent = this.silent; await this.reset(); if (!this.disposed) await this.play({ silent }); }
    async dispose() { this.disposed = true; await this.reset(); }
  }
  global.ShowcaseTimeline = ShowcaseTimeline;
  global.ShowcasePresentation = ShowcasePresentation;
})(typeof window !== 'undefined' ? window : globalThis);

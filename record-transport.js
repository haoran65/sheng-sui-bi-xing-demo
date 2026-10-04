(function (global) {
  'use strict';
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  class RecordTransport {
    constructor({ state, begin, commit, render, status, inputs = ['record-seek', 'hall-seek'].map(id => document.getElementById(id)).filter(Boolean) }) {
      Object.assign(this, { state, begin, commit, render, status });
      this.inputs = inputs;
      this.revision = 0;
      for (const input of this.inputs) {
        input.addEventListener('pointerdown', event => {
          if (input.disabled || event.button > 0) return;
          input.setPointerCapture?.(event.pointerId);
          this.start(true);
        });
        input.addEventListener('input', () => {
          if (!this.session) this.start(false);
          if (!this.session) return;
          this.session.target = Number(input.value);
          if (Number(input.max) - this.session.target < .1) this.session.target = Number(input.max);
          this.preview(this.session.target);
        });
        input.addEventListener('pointerup', () => void this.finish());
        input.addEventListener('change', () => void this.finish());
        input.addEventListener('pointercancel', () => void this.finish(true));
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape' && this.session) { event.preventDefault(); void this.finish(true); }
          else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (input.disabled) return;
            this.start(false);
            const current = Number(input.value), duration = Number(input.max);
            this.session.target = event.key === 'Home' ? 0 : event.key === 'End' ? duration
              : Math.max(0, Math.min(duration, current + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -5 : 5)));
            this.preview(this.session.target);
            void this.finish();
          }
        });
      }
    }
    start(animate) {
      if (this.session) return;
      const state = this.state();
      if (state.disabled) return;
      this.error = '';
      this.session = { ...state, target: state.seconds, revision: ++this.revision };
      this.session.ready = Promise.resolve(this.begin(animate));
    }
    preview(seconds) {
      const state = this.state();
      for (const input of this.inputs) input.value = seconds;
      const item = state.program?.find(item => seconds >= item.startSecond && seconds < item.endSecond);
      this.status.textContent = `${clock(seconds)} / ${clock(state.durationSeconds)}${item ? ` · ${item.title}` : ''}`;
      this.render(seconds, state.durationSeconds - seconds);
    }
    async finish(cancel = false) {
      const session = this.session;
      if (!session || session.committing) return;
      session.committing = true;
      try {
        await session.ready;
        if (session.revision !== this.revision) return;
        await this.commit(cancel ? session.seconds : session.target, session.playing, session.trackId);
      } catch (error) {
        this.error = `定位失败：${error.message || '请重试'}`;
        this.status.textContent = this.error;
      } finally {
        if (this.session === session) { this.session = null; this.sync(); }
      }
    }
    cancel() { ++this.revision; this.session = null; this.error = ''; }
    sync() {
      const state = this.state();
      for (const input of this.inputs) {
        input.disabled = state.disabled;
        input.max = state.durationSeconds || 1;
        if (!this.session) input.value = state.seconds || 0;
        input.setAttribute('aria-valuetext', `${clock(Number(input.value))} / ${clock(state.durationSeconds || 0)}`);
      }
      if (!this.session) {
        this.render(state.seconds || 0, Math.max(0, state.durationSeconds - state.seconds));
        this.status.textContent = state.reason || this.error || '';
      }
    }
  }
  global.RecordTransport = RecordTransport;
})(typeof window !== 'undefined' ? window : globalThis);

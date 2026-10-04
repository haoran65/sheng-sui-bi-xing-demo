(function (global) {
  'use strict';
  const $ = (id) => document.querySelector(`#${id}`);
  const clock = (seconds) => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  };
  class ConcertHall {
    constructor({ onSelect = () => {} } = {}) {
      this.onSelect = onSelect;
      this.selected = null;
      this.frames = [];
      this.reviewKey = '';
      this.auditionState = 'idle';
      this.playing = false;
      this.busy = false;
      $('instrument-close').addEventListener('click', () => this.clearSelection());
      $('instrument-listen').addEventListener('click', () => {
        if (this.selected && !this.playing && !this.busy) this.onSelect(this.selected);
      });
    }
    select(id) {
      const item = global.OrchestraInstrumentGuide.instruments[id];
      if (!item) return;
      this.selected = id;
      $('instrument-empty').hidden = true;
      $('instrument-detail').hidden = false;
      $('instrument-structure').open = false;
      $('instrument-name').textContent = item.name;
      $('instrument-family').textContent = global.OrchestraInstrumentGuide.families[item.family].label;
      $('instrument-timbre').textContent = item.timbre;
      $('instrument-purpose').textContent = item.role;
      $('instrument-together').textContent = item.together;
      $('instrument-note').textContent = item.note;
      $('instrument-note').hidden = !item.note;
      $('instrument-image').src = `./assets/images/orchestra-icons/${item.asset}`;
      $('instrument-current').textContent = '等待乐句';
      const siblings = global.OrchestraInstrumentGuide.families[item.family].members.map((member) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = global.OrchestraInstrumentGuide.instruments[member].name;
        button.setAttribute('aria-pressed', String(member === id));
        button.addEventListener('click', () => this.onSelect(member));
        return button;
      });
      $('instrument-members').replaceChildren(...siblings);
      const parts = item.parts.map(([name, description], index) => {
        const part = document.createElement('li');
        const label = document.createElement('strong');
        const text = document.createElement('p');
        label.textContent = `${String(index + 1).padStart(2, '0')}  ${name}`;
        text.textContent = description;
        part.append(label, text);
        return part;
      });
      $('instrument-parts').replaceChildren(...parts);
      this.markSeats();
    }
    markSeats() {
      document.querySelectorAll('[data-orchestra-instrument]').forEach((seat) => {
        const selected = seat.dataset.orchestraInstrument === this.selected;
        seat.setAttribute('aria-pressed', String(selected));
        seat.dataset.selected = String(selected);
        seat.dataset.audition = String(selected && !this.playing && this.auditionState === 'playing');
        const name = global.OrchestraInstrumentGuide.instruments[seat.dataset.orchestraInstrument]?.name;
        seat.setAttribute('aria-label', this.playing || this.busy ? `查看${name}介绍` : `试听${name}并查看介绍`);
      });
    }
    clearSelection() {
      const previous = this.selected;
      this.selected = null;
      this.onSelect(null);
      $('instrument-detail').hidden = true;
      $('instrument-empty').hidden = false;
      this.markSeats();
      const seat = [...document.querySelectorAll('[data-orchestra-instrument]')]
        .find((item) => item.dataset.orchestraInstrument === previous);
      seat?.focus({ preventScroll: true });
    }
    setAuditionState(state) {
      this.auditionState = state;
      this.syncAuditionControl();
      this.markSeats();
    }
    syncAuditionControl() {
      const state = this.auditionState;
      const labels = { idle: '再听一次', loading: '正在准备音色…', playing: '正在试听…', muted: '静音中 · 取消静音后再听', blocked: '点击开启声音', unavailable: '音色暂不可用 · 点击重试' };
      $('instrument-listen').textContent = labels[state] || labels.idle;
      $('instrument-listen').hidden = this.playing;
      $('instrument-listen').disabled = this.playing || this.busy;
      $('instrument-listen').setAttribute('aria-busy', String(state === 'loading'));
      const status = this.playing ? '演出进行中，暂停后可试听。' : state === 'idle' ? '' : labels[state];
      if ($('instrument-audition-status').textContent !== status) $('instrument-audition-status').textContent = status;
    }
    enqueue(frame) {
      if (frame?.timing !== 'scheduled') return;
      this.frames.push(frame);
      if (this.frames.length > 12) this.frames.splice(0, this.frames.length - 12);
    }
    resetFrames() { this.frames = []; }
    update({ playing, muted, audioTime, loaded, title, feedback = '', pauseSeconds = 0, locked = false, demo = false, busy = false }) {
      const playbackChanged = this.playing !== Boolean(playing) || this.busy !== Boolean(busy);
      this.playing = Boolean(playing);
      this.busy = Boolean(busy);
      this.syncAuditionControl();
      if (playbackChanged) this.markSeats();
      $('stage-explore-hint').textContent = playing ? '轻触乐器，了解它的合奏职责' : '轻触乐器，听见它的声音';
      $('hall-track-title').textContent = loaded ? title : '等待第一张唱片';
      $('hall-play').disabled = !loaded || busy;
      $('hall-play').setAttribute('aria-label', playing ? '暂停演出' : '播放演出');
      $('hall-play').dataset.playing = String(playing);
      $('hall-play-label').textContent = playing ? '暂停' : '播放';
      $('hall-mute').setAttribute('aria-pressed', String(muted));
      $('hall-mute').setAttribute('aria-label', muted ? '取消静音' : '静音');
      $('hall-feedback').textContent = feedback || (!loaded ? '回到正面，挑一张唱片。' : '');
      $('hall-breath').textContent = !loaded ? '点一件乐器，认识它的声音。'
        : !playing ? '演出暂停，仍可探索每件乐器。'
        : demo ? '正在按演奏轨迹回放。'
        : locked ? '保持当前演奏，静静听一会儿。'
        : pauseSeconds >= 8 ? '你停下来，音乐也慢慢舒展。' : '听一会儿，让音乐继续呼吸。';
      if (this.selected) {
        const notes = this.frames.flatMap((frame) => frame.notes || []).filter((note) =>
          note.instrument === this.selected && note.arrivalTime <= audioTime
          && audioTime < note.arrivalTime + note.durationSeconds);
        const label = global.OrchestraInstrumentGuide.currentRole(notes, { playing, muted });
        if ($('instrument-current').textContent !== label) $('instrument-current').textContent = label;
      }
    }
    showClock(elapsed, total) {
      $('hall-elapsed').textContent = clock(elapsed);
      $('hall-duration').textContent = clock(total);
      $('hall-progress').value = total ? Math.max(0, Math.min(100, elapsed / total * 100)) : 0;
    }
    showReview(trace, title, words) {
      const key = `${trace.length}:${trace.at(-1)?.at}:${title}:${words}`;
      if (key === this.reviewKey) return;
      this.reviewKey = key;
      const review = global.OrchestraInstrumentGuide.summarizeTrace(trace);
      $('review-title').textContent = title || '未命名的故事';
      $('review-words').textContent = `${words} 字`;
      $('review-duration').textContent = clock(review.duration);
      $('review-empty').hidden = Boolean(review.points.length);
      $('review-chart').hidden = !review.points.length;
      $('review-chart').setAttribute('aria-label', `写作节奏轨迹，时长 ${clock(review.duration)}。${review.moments.map((moment) => `${clock(moment.at)} ${moment.label}`).join('；')}`);
      $('review-chart').replaceChildren(...review.points.map((point) => {
        const bar = document.createElement('span');
        bar.style.setProperty('--energy', String(point.energy));
        bar.dataset.paused = String(point.paused);
        bar.setAttribute('aria-hidden', 'true');
        return bar;
      }));
      $('review-moments').replaceChildren(...review.moments.map((moment) => {
        const item = document.createElement('li');
        const time = document.createElement('time');
        const label = document.createElement('span');
        time.textContent = clock(moment.at); label.textContent = moment.label;
        item.append(time, label); return item;
      }));
    }
  }
  global.ConcertHall = ConcertHall;
})(typeof window !== 'undefined' ? window : globalThis);

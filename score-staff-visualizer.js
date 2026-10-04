(function (global) {
  'use strict';

  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const ASSET_ROOT = './assets/images/score-notes/';
  const NOTE_ASSETS = Object.freeze({
    whole: `${ASSET_ROOT}whole.png`,
    'half-up': `${ASSET_ROOT}half-up.png`,
    'half-down': `${ASSET_ROOT}half-down.png`,
    'quarter-up': `${ASSET_ROOT}quarter-up.png`,
    'quarter-down': `${ASSET_ROOT}quarter-down.png`,
    'eighth-up': `${ASSET_ROOT}eighth-up.png`,
    'eighth-down': `${ASSET_ROOT}eighth-down.png`,
    'sixteenth-up': `${ASSET_ROOT}sixteenth-up.png`,
    'sixteenth-down': `${ASSET_ROOT}sixteenth-down.png`,
  });
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Opaque contour anchors in the existing 256px PNGs, inside their alpha edge.
  // The slanted seam follows the stem tip and the foot of the note head.
  const RIBBON_ANCHORS = Object.freeze({
    whole: [131, 70, 127, 185],
    'half-up': [166, 23, 120, 232],
    'half-down': [92, 23, 121, 232],
    'quarter-up': [161, 23, 119, 232],
    'quarter-down': [97, 23, 119, 232],
    'eighth-up': [133, 23, 92, 232],
    'eighth-down': [131, 23, 89, 232],
    'sixteenth-up': [128, 23, 90, 232],
    'sixteenth-down': [128, 23, 89, 232],
  });
  let ribbonSerial = 0;
  const SUSTAIN_THRESHOLD_SECONDS = 0.8;

  const STAGES = {
    tacet: ['TACET', '静默'],
    preparatory: ['PREPARATORY BEAT', '预备拍'],
    stringendo: ['STRINGENDO', '推进'],
    inTempo: ['IN TEMPO', '稳定进行'],
    sostenuto: ['SOSTENUTO', '持续展开'],
    fermata: ['FERMATA', '构思延长'],
    calando: ['CALANDO', '渐缓渐弱'],
    smorzando: ['SMORZANDO', '渐隐'],
    intermezzo: ['INTERMEZZO', '乐章间呼吸'],
    fine: ['FINE', '演出结束'],
  };

  class ScoreStageController {
    constructor(root, term, meaning, { clock = () => performance.now() } = {}) {
      this.root = root;
      this.term = term;
      this.meaning = meaning;
      this.clock = clock;
      this.current = 'tacet';
      this.changedAt = Number.NEGATIVE_INFINITY;
      this.playStartedAt = null;
      this.render('tacet', true);
    }

    select(snapshot = {}, playback = {}) {
      if (playback.completed) return 'fine';
      if (playback.programPhase === 'intermission') return 'intermezzo';
      if (!playback.playing) return 'tacet';
      const now = this.clock();
      if (this.playStartedAt === null) this.playStartedAt = now;
      if (now - this.playStartedAt < 3000 && playback.bar <= 1) return 'preparatory';

      const pause = Number(snapshot.pauseSeconds);
      if (Number.isFinite(pause) && pause > 12) return 'smorzando';
      if (Number.isFinite(pause) && pause >= 2) return 'fermata';

      const energy = clamp(Number(snapshot.energy ?? snapshot.charge) || 0);
      const forecast = clamp(Number(snapshot.forecast) || energy);
      const trend = Number(snapshot.trend) || 0;
      const lead = forecast - energy;
      if (this.current === 'stringendo' && (trend > 0.0015 || lead > 0.03)) return 'stringendo';
      if (this.current === 'calando' && (trend < -0.0015 || lead < -0.03)) return 'calando';
      if (trend > 0.0045 || lead > 0.065) return 'stringendo';
      if (trend < -0.0045 || lead < -0.065) return 'calando';
      return energy >= 0.68 ? 'sostenuto' : 'inTempo';
    }

    update(snapshot, playback) {
      const candidate = this.select(snapshot, playback);
      const now = this.clock();
      const immediate = ['tacet', 'intermezzo', 'fine'].includes(candidate);
      if (candidate !== this.current && (immediate || now - this.changedAt >= 1500)) {
        this.render(candidate);
      }
      return this.current;
    }

    render(stage, force = false) {
      if (!force && stage === this.current) return;
      this.current = stage;
      this.changedAt = this.clock();
      if (stage === 'tacet' || stage === 'fine') this.playStartedAt = null;
      const [term, meaning] = STAGES[stage] || STAGES.inTempo;
      if (this.root) this.root.dataset.stage = stage;
      if (this.term) this.term.textContent = term;
      if (this.meaning) this.meaning.textContent = meaning;
    }

    reset() { this.render('tacet', true); }
  }

  class ScoreRailVisualizer {
    constructor(root, { clock = () => 0, travelTime = 6, removalDelay = 0.2 } = {}) {
      if (!root) throw new Error('动态五线谱缺少乐谱带容器');
      this.root = root;
      this.noteLayer = root.querySelector?.('.score-note-layer') || root;
      this.clock = clock;
      this.travelTime = travelTime;
      this.removalDelay = clamp(removalDelay, 0.18, 0.22);
      this.notes = new Map();
      this.energy = 0.5;
      this.playing = false;
      this.completed = false;
      this.raf = 0;
      this.phraseEnds = [];
      this.reducedMotion = global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
      this.root.style?.setProperty('--score-energy', this.energy.toFixed(3));
      this.root.dataset.state = 'idle';
      this.root.dataset.motion = this.reducedMotion ? 'reduced' : 'full';
      if (typeof global.ResizeObserver === 'function') {
        this.resizeObserver = new global.ResizeObserver(() => {
          if (!this.playing && this.notes.size) this.renderAt(this.lastRenderTime ?? this.clock());
        });
        this.resizeObserver.observe(this.root);
      }
    }

    static isSustained(note) {
      return Number(note.durationSeconds) >= SUSTAIN_THRESHOLD_SECONDS;
    }

    static aggregateNotes(frame, limit = 24) {
      const duration = Math.max(0.001, Number(frame?.durationSeconds) || 1);
      const clusterWindow = Number(global.innerWidth) <= 520 ? 0.4
        : Number(global.innerWidth) <= 760 ? 0.26 : 0.18;
      const sourceNotes = (frame?.notes || []).map((source, index) => {
        const offset = clamp(Number(source.offsetSeconds) || 0, 0, duration);
        const arrival = Number.isFinite(source.arrivalTime)
          ? Number(source.arrivalTime) : Number(frame.audioStartTime || 0) + offset;
        return { ...source, _sourceIndex: index, offsetSeconds: offset, arrivalTime: arrival,
          peak: clamp(Number(source.peak) || 0.05) };
      }).sort((a, b) => a.arrivalTime - b.arrivalTime || a._sourceIndex - b._sourceIndex);
      const clusters = [];
      for (const note of sourceNotes) {
        const current = clusters.at(-1);
        if (!current || note.arrivalTime - current.arrivalTime > clusterWindow) {
          clusters.push({ arrivalTime: note.arrivalTime, notes: [note] });
        } else {
          current.notes.push(note);
        }
      }
      const notes = clusters.map((cluster, clusterIndex) => {
        const representative = [...cluster.notes].sort((a, b) => b.peak - a.peak)[0];
        const peak = clamp(1 - cluster.notes.reduce((remaining, note) =>
          remaining * (1 - note.peak * 0.42), 1), representative.peak, 1);
        const sourceIds = cluster.notes.map((note) => note.id || `${note.instrument || 'voice'}:${note.midi || 0}:${note._sourceIndex}`);
        return { ...representative,
          id: `${frame.absoluteBar || frame.bar || 0}:onset:${clusterIndex}:${sourceIds.sort().join('|')}`,
          arrivalTime: cluster.arrivalTime,
          offsetSeconds: Math.max(0, cluster.arrivalTime - Number(frame.audioStartTime || 0)),
          // The glyph and its tail describe the same representative voice.
          durationBeats: Number(representative.durationBeats) || 0.25,
          durationSeconds: Number(representative.durationSeconds) || 0.08,
          peak,
          voices: cluster.notes.length,
        };
      });
      if (notes.length <= limit) return notes;
      const picked = new Set();
      for (let index = 0; index < limit; index++) {
        picked.add(Math.round(index * (notes.length - 1) / Math.max(1, limit - 1)));
      }
      return [...picked].map((index) => notes[index]).sort((a, b) => a.arrivalTime - b.arrivalTime);
    }

    static noteAsset(durationBeats, stemUp = true) {
      const duration = Math.max(0, Number(durationBeats) || 0);
      if (duration >= 3.5) return NOTE_ASSETS.whole;
      const direction = stemUp ? 'up' : 'down';
      if (duration >= 1.75) return NOTE_ASSETS[`half-${direction}`];
      if (duration >= 0.75) return NOTE_ASSETS[`quarter-${direction}`];
      if (duration >= 0.375) return NOTE_ASSETS[`eighth-${direction}`];
      return NOTE_ASSETS[`sixteenth-${direction}`];
    }

    static ribbonGeometry({ durationBeats, stemUp = true, length = 0, size = 36, time = 0 }) {
      size = Math.max(1, Number(size) || 36);
      length = Math.max(0, Number(length) || 0);
      const key = ScoreRailVisualizer.noteAsset(durationBeats, stemUp).split('/').at(-1).replace('.png', '');
      const [topX, topY, bottomX, bottomY] = RIBBON_ANCHORS[key].map((value) => value * size / 256);
      const growth = clamp(length / size);
      // A single soft S fold; its phase comes from the same clock as note travel.
      const bend = Math.min((bottomY - topY) * .34, length * .18)
        * Math.sin((Number(time) || 0) * .85 + .65);
      const ghostY = Math.sin((Number(time) || 0) * .65) * size * .065 * growth;
      const point = (x, y) => `${x.toFixed(3)} ${y.toFixed(3)}`;
      const top = `M ${point(topX, topY)} C ${point(topX + length * .32, topY + bend)} ${point(topX + length * .68, topY + ghostY - bend)} ${point(topX + length, topY + ghostY)}`;
      const bottom = `C ${point(bottomX + length * .68, bottomY + ghostY - bend)} ${point(bottomX + length * .32, bottomY + bend)} ${point(bottomX, bottomY)}`;
      return {
        path: `${top} L ${point(bottomX + length, bottomY + ghostY)} ${bottom} Z`,
        // A translucent folded panel, contained inside the main sheet.
        foldPath: `M ${point(topX + length * .32, topY + bend * .44 + ghostY * .24)} L ${point(topX + length, topY + ghostY)} L ${point(bottomX + length, bottomY + ghostY)} C ${point(bottomX + length * .68, bottomY + ghostY - bend)} ${point(bottomX + length * .32, bottomY + bend)} ${point(bottomX, bottomY)} Z`,
        width: size + length, height: size, ghostY,
        anchors: { topX, topY, bottomX, bottomY },
      };
    }

    static positionPx({ arrivalTime, enteredAt, time, endX, spawnX }) {
      const remaining = Math.max(0, arrivalTime - time);
      const available = Math.max(0.001, arrivalTime - enteredAt);
      return endX + clamp(remaining / available) * (spawnX - endX);
    }

    static stableId(note, frame, index) {
      if (note.id) return String(note.id);
      const beatKey = Math.round((Number(note.offsetSeconds) || 0) * 1000);
      return `${frame.absoluteBar || frame.bar || 0}:${note.instrument || 'voice'}:${note.midi || 0}:${beatKey}:${index}`;
    }

    setClock(clock) { this.clock = typeof clock === 'function' ? clock : this.clock; }

    enqueueWindow(payload = {}) {
      for (const frame of payload.frames || []) {
        this.enqueue({ ...frame, generatedAt: payload.generatedAt ?? frame.generatedAt,
          timing: frame.timing || 'projected' });
      }
    }

    enqueue(frame) {
      if (!frame || !Number.isFinite(frame.audioStartTime) || !(frame.durationSeconds > 0)) return;
      const limit = Number(global.innerWidth) <= 520 ? 16 : 28;
      const timing = frame.timing === 'projected' ? 'projected' : 'scheduled';
      const generatedAt = Number.isFinite(frame.generatedAt) ? frame.generatedAt : this.clock();
      const notes = ScoreRailVisualizer.aggregateNotes(frame, limit);
      const incomingIds = new Set(notes.map((source, index) =>
        ScoreRailVisualizer.stableId(source, frame, index)));
      for (const [id, existing] of this.notes) {
        if (existing.absoluteBar !== frame.absoluteBar || incomingIds.has(id)) continue;
        const replaceProjection = timing === 'scheduled' && existing.timing === 'projected';
        const refreshProjection = timing === 'projected' && existing.timing === 'projected';
        if (replaceProjection || refreshProjection) {
          existing.node?.remove?.();
          this.notes.delete(id);
        }
      }
      notes.forEach((source, index) => {
        const note = { ...source, id: ScoreRailVisualizer.stableId(source, frame, index), timing,
          absoluteBar: frame.absoluteBar, endsPhrase: Boolean(frame.endsPhrase) };
        const existing = this.notes.get(note.id);
        if (existing && existing.timing === 'scheduled' && timing === 'projected') return;
        if (existing) {
          if (timing === 'scheduled' && Math.abs(existing.arrivalTime - note.arrivalTime) > 0.001) {
            existing.correction = { from: existing.arrivalTime, to: note.arrivalTime,
              startedAt: generatedAt, endsAt: generatedAt + 0.2 };
          }
          Object.assign(existing, note, { arrivalTime: existing.arrivalTime,
            timing: timing === 'scheduled' ? 'scheduled' : existing.timing });
          if (existing.node) existing.node.dataset.timing = existing.timing;
          return;
        }
        this.notes.set(note.id, { ...note, enteredAt: null, lastX: Number.POSITIVE_INFINITY,
          hitAt: null, node: null, correction: null });
      });
      if (frame.endsPhrase) {
        const end = Number(frame.audioStartTime) + Number(frame.durationSeconds);
        if (!this.phraseEnds.some((time) => Math.abs(time - end) < 0.03)) this.phraseEnds.push(end);
      }
      if (this.playing) this.startLoop();
    }

    setEnergy(value) {
      this.energy = clamp(Number(value) || 0);
      this.root.style?.setProperty('--score-energy', this.energy.toFixed(3));
    }

    setPlaying(value) {
      this.playing = Boolean(value);
      this.root.dataset.state = this.playing ? 'playing' : 'paused';
      if (this.playing) this.startLoop();
      else this.stopLoop();
    }

    dissolve({ animate = true } = {}) {
      this.setPlaying(false);
      this.root.querySelectorAll?.('.seek-dust').forEach(node => node.remove());
      if (!animate || this.reducedMotion) { this.clear(); return; }
      const bounds = this.root.getBoundingClientRect();
      const visible = [...this.notes.values()].filter(note => note.node).slice(0, 24);
      const dust = document.createElement('span');
      dust.className = 'seek-dust'; dust.setAttribute('aria-hidden', 'true');
      for (const note of visible) {
        const box = note.node.getBoundingClientRect();
        if (box.right < bounds.left || box.left > bounds.right) continue;
        for (let i = 0; i < 5; i++) {
          const dot = document.createElement('i');
          dot.style.left = `${box.left - bounds.left + box.width * .35}px`;
          dot.style.top = `${box.top - bounds.top + box.height * .5}px`;
          dot.style.setProperty('--dx', `${(i - 2) * 9}px`);
          dot.style.setProperty('--dy', `${-8 - (i * 7) % 23}px`);
          dust.append(dot);
        }
      }
      this.clear(); this.root.append(dust);
      setTimeout(() => dust.remove(), 260);
    }
    primeSeekWindow() { this.seekWindow = true; }
    clear() {
      this.completed = false;
      this.stopLoop();
      this.notes.clear();
      this.phraseEnds = [];
      this.noteLayer.replaceChildren?.();
      this.root.classList?.remove('is-complete', 'is-phrase-ending');
      this.root.dataset.state = 'idle';
    }

    complete() {
      this.setPlaying(false);
      this.completed = true;
      this.root.classList?.add('is-complete');
    }

    startLoop() {
      if (this.raf || !this.playing || typeof global.requestAnimationFrame !== 'function') return;
      const tick = () => {
        this.raf = 0;
        this.renderAt(this.clock());
        if (this.playing) this.raf = global.requestAnimationFrame(tick);
      };
      this.raf = global.requestAnimationFrame(tick);
    }

    stopLoop() {
      if (this.raf && typeof global.cancelAnimationFrame === 'function') global.cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.renderAt(this.clock());
    }

    effectiveArrival(note, time) {
      const correction = note.correction;
      if (!correction) return note.arrivalTime;
      const progress = clamp((time - correction.startedAt)
        / Math.max(0.001, correction.endsAt - correction.startedAt));
      const arrival = correction.from + (correction.to - correction.from) * progress;
      if (progress >= 1) {
        note.arrivalTime = correction.to;
        note.correction = null;
      }
      return arrival;
    }

    renderAt(time) {
      if (!Number.isFinite(time)) return;
      const width = Math.max(320, Number(this.root.clientWidth) || 1000);
      const resized = this.railWidth !== undefined && this.railWidth !== width;
      this.railWidth = width;
      this.lastRenderTime = time;
      const endX = width * 0.07;
      const spawnX = width * 0.97;
      this.root.style?.setProperty('--endpoint-x', `${endX.toFixed(2)}px`);
      let activeCount = 0;

      const minimumPixelGap = width <= 520 ? 27 : width <= 760 ? 30 : 34;
      const minimumArrivalGap = this.travelTime * minimumPixelGap / Math.max(1, spawnX - endX);
      const timeline = [...this.notes.entries()].map(([id, note]) => ({
        id, note, arrivalTime: this.effectiveArrival(note, time),
      })).sort((a, b) => a.arrivalTime - b.arrivalTime);
      const arrivals = new Map();
      const nextArrivals = new Map();
      let previousVisibleArrival = Number.NEGATIVE_INFINITY;
      let previousVisibleId;
      for (const item of timeline) {
        arrivals.set(item.id, item.arrivalTime);
        item.note.visualSuppressed = item.arrivalTime - previousVisibleArrival < minimumArrivalGap;
        if (!item.note.visualSuppressed) {
          if (previousVisibleId) nextArrivals.set(previousVisibleId, item.arrivalTime);
          previousVisibleId = item.id;
          previousVisibleArrival = item.arrivalTime;
        }
      }

      for (const [id, note] of this.notes) {
        const arrivalTime = arrivals.get(id);
        if (note.visualSuppressed) {
          if (note.node) {
            note.node.remove?.();
            note.node = null;
          }
          if (time > arrivalTime + this.removalDelay) this.notes.delete(id);
          continue;
        }
        const lead = arrivalTime - time;
        const isSustained = ScoreRailVisualizer.isSustained(note);
        const visibleSustain = isSustained ? Number(note.durationSeconds) : this.removalDelay;
        if (lead > this.travelTime + 0.04) continue;
        if (note.enteredAt === null) note.enteredAt = this.seekWindow ? note.arrivalTime - this.travelTime : time;
        // Scheduled timing can cross the threshold after a projected tempo changes.
        if (note.node && note.node.dataset.sustained !== String(isSustained)) {
          note.node.remove?.(); note.node = null; note.ribbon = null;
        }
        if (!note.node && time <= arrivalTime + visibleSustain) this.createNoteView(note);
        if (!note.node) {
          if (time > arrivalTime + visibleSustain) this.notes.delete(id);
          continue;
        }
        activeCount++;
        let x = this.reducedMotion
          ? (time >= arrivalTime ? endX : spawnX)
          : ScoreRailVisualizer.positionPx({ arrivalTime, enteredAt: note.enteredAt,
            time, endX, spawnX });
        // Preserve progress within the lane when it resizes, including while paused.
        x = resized ? x : Math.min(note.lastX, x);
        note.lastX = x;
        note.node.style.left = `${x.toFixed(2)}px`;
        note.node.dataset.x = x.toFixed(2);
        note.node.dataset.arrivalTime = arrivalTime.toFixed(5);
        note.node.classList.toggle('is-approaching', lead > 0 && lead <= 0.72);
        if (note.hitAt === null) note.node.dataset.state = lead > 0 && lead <= 0.72 ? 'approaching' : 'travelling';
        const velocity = (spawnX - endX) / Math.max(0.001, arrivalTime - note.enteredAt);
        const nextGap = (nextArrivals.get(id) ?? Infinity) - arrivalTime;
        const fullTrailLength = Math.min(clamp(velocity * .4, 24, width <= 520 ? 42 : 72), Math.max(0, nextGap * velocity * .7));
        const sustainRemaining = time <= arrivalTime ? 1
          : clamp((arrivalTime + visibleSustain - time) / Math.max(0.001, visibleSustain));
        // The ribbon stays behind leftward travel and grows only after moving.
        const trailLength = this.reducedMotion || !isSustained ? 0 : Math.min(fullTrailLength, Math.max(0, spawnX - x)) * sustainRemaining;
        note.node.style.setProperty('--trail-length', `${trailLength.toFixed(2)}px`);
        note.node.style.setProperty('--ribbon-fade', (Math.min(1, trailLength / 18) * sustainRemaining).toFixed(3));
        note.node.style.setProperty('--sustain-progress', sustainRemaining.toFixed(3));
        if (note.ribbon) {
          // Measure once per viewport change, rather than reading layout for every note/frame.
          const viewport = `${global.innerWidth}:${width}`;
          if (this.noteSizeViewport !== viewport) {
            const measured = parseFloat(global.getComputedStyle?.(note.node)?.width);
            this.noteSize = measured || (Number(global.innerWidth) <= 420 ? 23
              : clamp(Number(global.innerWidth) * .03 || 36, 29, 36));
            this.noteSizeViewport = viewport;
          }
          const shape = ScoreRailVisualizer.ribbonGeometry({ durationBeats: note.ribbon.durationBeats,
            stemUp: note.ribbon.stemUp, length: trailLength, size: this.noteSize,
            time: time - note.enteredAt });
          note.ribbon.svg.setAttribute('viewBox', `0 0 ${shape.width.toFixed(3)} ${shape.height.toFixed(3)}`);
          note.ribbon.body.setAttribute('d', shape.path);
          note.ribbon.clipShape.setAttribute('d', shape.path);
          note.ribbon.fold.setAttribute('d', shape.foldPath);
          note.node.style.setProperty('--ghost-y', `${shape.ghostY.toFixed(3)}px`);
        }

        if (time >= arrivalTime && note.hitAt === null) {
          note.hitAt = time;
          const syncErrorMs = (time - arrivalTime) * 1000;
          note.node.classList.remove('is-approaching');
          note.node.classList.add(isSustained ? 'is-sustaining' : 'is-arriving');
          note.node.dataset.state = isSustained ? 'sustaining' : note.voices >= 4 ? 'ensemble-impact'
            : note.peak >= 0.64 ? 'accent-impact' : 'impact';
          if (note.timing === 'scheduled') this.root.dataset.lastSyncErrorMs = syncErrorMs.toFixed(1);
        }
        if (note.hitAt !== null && time >= arrivalTime + visibleSustain) {
          note.node.remove?.();
          this.notes.delete(id);
        }
      }

      this.phraseEnds = this.phraseEnds.filter((end) => time <= end + 0.58);
      const phraseEnding = this.phraseEnds.some((end) => time >= end - 0.18 && time <= end + 0.46);
      this.root.classList?.toggle('is-phrase-ending', phraseEnding);
      this.root.dataset.visibleNotes = String(activeCount);
    }

    createNoteView(note) {
      if (typeof document === 'undefined') return;
      const y = this.noteY(note.midi, note.family);
      const intensity = clamp(0.64 * note.peak + 0.36 * this.energy, 0.08, 1);
      const node = document.createElement('span');
      const sustained = ScoreRailVisualizer.isSustained(note);
      node.className = `score-note family-${note.family || 'other'}${note.peak >= 0.64 ? ' is-accent' : ''}${note.voices >= 4 ? ' is-ensemble' : ''}${sustained ? ' is-sustained' : ''}`;
      node.dataset.noteId = note.id;
      node.dataset.sustained = String(sustained);
      node.dataset.durationSeconds = String(note.durationSeconds);
      node.dataset.timing = note.timing;
      node.dataset.voices = String(note.voices || 1);
      node.dataset.state = 'travelling';
      node.style.top = `${y.toFixed(2)}%`;
      node.style.setProperty('--note-level', intensity.toFixed(3));
      node.style.setProperty('--trail-length', '0px');
      node.style.setProperty('--cluster-weight', clamp((Number(note.voices) || 1) / 9, 0, 1).toFixed(3));
      const image = document.createElement('img');
      image.className = 'score-note-image';
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.src = ScoreRailVisualizer.noteAsset(note.durationBeats, Number(note.midi) < 71);
      node.append(image);

      if (this.reducedMotion) {
        this.noteLayer.append(node);
        note.node = node;
        return;
      }

      if (sustained) {
        const ribbon = document.createElement('span');
        ribbon.className = 'score-note-ribbon';
        ribbon.setAttribute('aria-hidden', 'true');
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('preserveAspectRatio', 'none');
        const defs = document.createElementNS(SVG_NS, 'defs');
        const gradient = document.createElementNS(SVG_NS, 'linearGradient');
        const gradientId = `score-ribbon-${++ribbonSerial}`;
        gradient.setAttribute('id', gradientId);
        gradient.setAttribute('x1', '0%'); gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y1', '0%'); gradient.setAttribute('y2', '0%');
        for (const [offset, opacity] of [['0%', '.32'], ['48%', '.18'], ['100%', '.06']]) {
          const stop = document.createElementNS(SVG_NS, 'stop');
          stop.setAttribute('offset', offset);
          stop.setAttribute('stop-color', '#252525');
          stop.setAttribute('stop-opacity', opacity);
          gradient.append(stop);
        }
        defs.append(gradient); svg.append(defs);
        const body = document.createElementNS(SVG_NS, 'path');
        body.setAttribute('fill', `url(#${gradientId})`);
        const fold = document.createElementNS(SVG_NS, 'path');
        fold.setAttribute('fill', '#faf8f2');
        fold.setAttribute('fill-opacity', '.13');
        // Clip the folded panel to the continuous sheet, including its curved edges.
        const clip = document.createElementNS(SVG_NS, 'clipPath');
        clip.setAttribute('id', `${gradientId}-clip`);
        const clipShape = document.createElementNS(SVG_NS, 'path');
        clip.append(clipShape); defs.append(clip);
        fold.setAttribute('clip-path', `url(#${gradientId}-clip)`);
        svg.append(body); svg.append(fold);
        ribbon.append(svg); node.append(ribbon);
        // Share the body's path with the clip on each audio-clock update.
        note.ribbon = { svg, body, fold, clipShape,
          durationBeats: note.durationBeats, stemUp: Number(note.midi) < 71 };

        const ghost = document.createElement('img');
        ghost.className = 'score-note-ghost';
        ghost.src = image.src;
        ghost.alt = '';
        ghost.draggable = false;
        ghost.decoding = 'async';
        node.append(ghost);

      }

      const particles = document.createElement('span');
      particles.className = 'score-note-particles';
      particles.setAttribute?.('aria-hidden', 'true');
      const particleCount = note.voices >= 4 || note.peak >= 0.64 ? 7 : 5;
      for (let index = 0; index < particleCount; index++) {
        const particle = document.createElement('i');
        const angle = -162 + index * (324 / Math.max(1, particleCount - 1));
        const distance = 10 + ((index * 7 + Math.round(intensity * 10)) % 13)
          + (note.voices >= 4 ? 4 : 0);
        const size = 1 + ((index * 3) % 5) * 0.3 + intensity * 0.5;
        particle.style.setProperty('--particle-angle', `${angle.toFixed(1)}deg`);
        particle.style.setProperty('--particle-distance', `${distance.toFixed(1)}px`);
        particle.style.setProperty('--particle-size', `${size.toFixed(2)}px`);
        particle.style.setProperty('--particle-delay', `${(index % 4) * 7}ms`);
        particles.append(particle);
      }
      node.append(particles);

      if (sustained) {
        const dustLayer = document.createElement('span');
        dustLayer.className = 'score-note-dust';
        dustLayer.setAttribute('aria-hidden', 'true');
        const tailDustCount = 4;
        for (let index = 0; index < tailDustCount; index++) {
          const dust = document.createElement('i');
          const progress = (index + 1) / (tailDustCount + 1);
          const verticalOffset = ((index * 13 + Math.round(intensity * 10)) % 23) - 11;
          const drift = 5 + ((index * 5) % 8);
          const size = .75 + ((index * 7) % 6) * .24 + intensity * .35;
          dust.style.setProperty('--dust-x', `${(progress * 94).toFixed(1)}%`);
          dust.style.setProperty('--dust-y', `${verticalOffset.toFixed(1)}px`);
          dust.style.setProperty('--dust-drift', `${drift.toFixed(1)}px`);
          dust.style.setProperty('--dust-lift', `${(-5 - index * 2).toFixed(1)}px`);
          dust.style.setProperty('--dust-size', `${size.toFixed(2)}px`);
          dust.style.setProperty('--dust-delay', `${(-index * .17).toFixed(2)}s`);
          dustLayer.append(dust);
        }
        node.append(dustLayer);
      }
      this.noteLayer.append(node);
      note.node = node;
    }

    noteY(midi, family) {
      if (family === 'percussion') return 50;
      let pitch = Number(midi);
      if (!Number.isFinite(pitch)) pitch = 67;
      while (pitch < 55) pitch += 12;
      while (pitch > 81) pitch -= 12;
      return 70 - (pitch - 55) / 26 * 40;
    }
  }

  global.ScoreStageController = ScoreStageController;
  global.ScoreRailVisualizer = ScoreRailVisualizer;
  global.ScoreStaffVisualizer = ScoreRailVisualizer;
  global.SCORE_NOTE_ASSETS = NOTE_ASSETS;
})(typeof window !== 'undefined' ? window : globalThis);

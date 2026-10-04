(function (global) {
  'use strict';

  const assetRoot = './assets/images/vinyl-player/';
  const vinylSrc = `${assetRoot}vinyl-record-v1.png`;
  const sleeveSrc = `${assetRoot}record-sleeve-v1.png`;
  const lockedRecord = {
    id: 'joe-hisaishi-tokyo-dome-ghibli-2025',
    shortTitle: '久石让 × 吉卜力',
    composerLabel: '2025 东京巨蛋 · 待授权',
    artwork: { src: `${assetRoot}cover-hisaishi-pending-v1.png`, alt: '东京夜色与交响乐团原创示意封面', dominantColor: '#7a9ca0', catalogNumber: 'H/25', sourceUrl: '', creator: 'ImageGen · 本项目原创', license: '项目原创' },
    locked: true,
  };

  class TurntableController {
    constructor(stage, tonearmButton) {
      this.stage = stage;
      this.tonearmButton = tonearmButton;
      this.cover = stage.querySelector('#turntable-cover');
      this.track = null;
      this.state = 'empty';
      this.stage.style.setProperty('--groove-progress', '0');
    }

    setLoaded(track) {
      this.track = track || null;
      this.cover.src = track?.artwork?.src || '';
      this.cover.alt = track?.artwork?.alt || '';
      this.stage.style.setProperty('--cover-tone', track?.artwork?.dominantColor || '#879ca5');
      this.stage.classList.remove('is-dropping');
      this.stage.classList.toggle('has-record', Boolean(track));
      this.stage.style.setProperty('--groove-progress', '0');
      this.sync({ playing: false, busy: false, completed: false, progress: 0 });
    }

    sync({ playing, busy, completed, progress = 0 }) {
      this.state = !this.track ? 'empty' : busy ? 'loading' : completed ? 'completed'
        : playing ? 'playing' : this.state === 'playing' ? 'paused' : 'loaded-raised';
      this.stage.dataset.state = this.state;
      this.stage.style.setProperty('--groove-progress', String(Math.max(0, Math.min(1, progress))));
      this.stage.style.setProperty('--arm-angle', `${-1 - Math.max(0, Math.min(1, progress)) * 10}deg`);
      this.tonearmButton.disabled = !this.track || busy;
      const label = !this.track ? '先装入唱片' : busy ? '音色准备中'
        : playing ? '抬起唱针，暂停演奏' : completed ? '重新落针，重演唱片'
        : '落下唱针，开始或继续演奏';
      this.tonearmButton.setAttribute('aria-label', label);
      this.tonearmButton.setAttribute('aria-pressed', String(Boolean(playing)));
      this.tonearmButton.title = label;
    }

    setDropActive(active) { this.stage.classList.toggle('is-drop-target', active); }
  }

  class VinylLibraryController {
    constructor({ tracks, stage, onLoad }) {
      this.tracks = [...tracks, lockedRecord];
      this.stage = stage;
      this.onLoad = onLoad;
      this.folder = document.querySelector('#record-folder-btn');
      this.panel = document.querySelector('#record-library-panel');
      this.list = document.querySelector('#record-library-list');
      this.closeButton = document.querySelector('#record-library-close');
      this.scoreFace = document.querySelector('.score-front');
      this.loadedId = null;
      this.selectedId = null;
      this.drag = null;
      this.suppressClick = false;
      this.reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
      this.render();
      document.body.append(this.panel);
      this.folder.addEventListener('click', () => this.setOpen(this.panel.hidden));
      this.closeButton.addEventListener('click', () => this.setOpen(false));
      global.addEventListener('resize', () => {
        if (!this.panel.hidden) this.positionPanel();
      });
      this.scoreFace?.addEventListener('scroll', () => {
        if (!this.panel.hidden) this.positionPanel();
      }, { passive: true });
      document.addEventListener('pointerdown', (event) => {
        if (!this.panel.hidden && !this.panel.contains(event.target)
          && !this.folder.contains(event.target)) this.setOpen(false);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !this.panel.hidden) {
          this.setOpen(false);
          this.folder.focus({ preventScroll: true });
        }
      });
    }

    setOpen(open) {
      const restoreFolderFocus = !open && this.panel.contains(document.activeElement);
      const faceScrollTop = this.scoreFace && ['hidden', 'clip'].includes(global.getComputedStyle(this.scoreFace).overflowY)
        ? 0 : this.scoreFace?.scrollTop ?? 0;
      this.panel.hidden = !open;
      this.folder.setAttribute('aria-expanded', String(open));
      this.folder.setAttribute('aria-label', open ? '关闭唱片夹' : '打开唱片夹');
      this.folder.classList.toggle('is-open', open);
      if (open) {
        this.positionPanel();
        this.list.focus({ preventScroll: true });
      } else if (restoreFolderFocus) {
        this.folder.focus({ preventScroll: true });
      }
      if (this.scoreFace) this.scoreFace.scrollTop = faceScrollTop;
      document.dispatchEvent(new CustomEvent('sonata:library'));
    }

    positionPanel() {
      const anchor = this.folder.getBoundingClientRect();
      const width = Math.min(380, global.innerWidth - 22);
      const headerBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const writingBottom = this.teaching ? document.querySelector('#editor')?.getBoundingClientRect().bottom ?? 0 : 0;
      const topLimit = Math.max(headerBottom, writingBottom + (this.teaching ? 10 : 0));
      const available = Math.max(120, anchor.top - topLimit - 18);
      const height = Math.min(global.innerHeight * .55, available);
      this.panel.style.width = `${width}px`;
      this.panel.style.maxHeight = `${height}px`;
      this.panel.style.left = `${Math.max(11, Math.min(anchor.right - width, global.innerWidth - width - 11))}px`;
      this.panel.style.top = `${Math.max(topLimit + 8, anchor.top - height - 10)}px`;
    }

    setLoaded(id) {
      this.loadedId = id;
      this.selectedId = null;
      for (const entry of this.list.querySelectorAll('.record-entry')) {
        const track = this.tracks.find((item) => item.id === entry.dataset.trackId);
        const loaded = entry.dataset.trackId === id;
        entry.classList.toggle('is-loaded', loaded);
        entry.classList.remove('is-selected');
        const button = entry.querySelector('.record-load');
        button.textContent = track?.locked ? '待授权' : loaded ? '已装载' : '装入唱片';
        button.disabled = Boolean(track?.locked || loaded);
        const status = entry.querySelector('.record-child-status');
        if (status) {
          const child = this.tracks.find(item => item.id === id && item.albumId === track.id);
          status.textContent = child ? `已装载：${child.shortTitle}` : '';
        }
      }
    }

    setTeaching(active) { this.teaching = Boolean(active); }

    render() {
      const scrollTop = this.list.scrollTop;
      this.list.textContent = '';
      this.list.tabIndex = -1;
      let groupName = '';
      const albums = this.tracks.filter(track => track.kind === 'concert');
      const ordered = albums.flatMap(track => [track, ...this.tracks.filter(child => child.albumId === track.id)])
        .concat(this.tracks.filter(track => track.kind !== 'concert' && !track.albumId));
      this.expandedAlbums ||= new Set();
      for (const track of ordered) {
        const nextGroup = track.kind === 'concert' || track.albumId ? '专辑' : '单曲';
        if (nextGroup !== groupName) {
          const heading = document.createElement('div');
          heading.className = 'record-group-heading';
          heading.setAttribute('role', 'presentation');
          heading.textContent = nextGroup;
          this.list.append(heading);
          groupName = nextGroup;
        }
        const entry = document.createElement('div');
        entry.className = 'record-entry';
        entry.setAttribute('role', 'listitem');
        entry.dataset.trackId = track.id;
        if (track.albumId) {
          entry.dataset.albumId = track.albumId;
          entry.classList.add('record-movement');
          entry.hidden = !this.expandedAlbums.has(track.albumId);
        }
        entry.style.setProperty('--cover-tone', track.artwork?.dominantColor || '#8399a4');
        if (track.locked) entry.classList.add('is-locked');
        if (this.loadedId === track.id) entry.classList.add('is-loaded');
        if (this.selectedId === track.id) entry.classList.add('is-selected');
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'record-choice';
        choice.disabled = Boolean(track.locked);
        choice.setAttribute('aria-label', `${track.shortTitle}，${track.composerLabel || ''}${track.locked ? '，待授权' : '，选择或拖动到唱片机'}`);
        choice.innerHTML = `<span class="record-art"><img class="record-sleeve" src="${sleeveSrc}" alt="" draggable="false"><span class="record-edition-number"></span><img class="record-vinyl" src="${vinylSrc}" alt="" draggable="false"><img class="record-cover" alt="" draggable="false"><span class="record-spotlight"></span></span>`;
        choice.querySelector('.record-cover').src = track.artwork?.src || '';
        choice.querySelector('.record-cover').alt = track.artwork?.alt || '';
        choice.querySelector('.record-edition-number').textContent = track.artwork?.catalogNumber || '';
        const copy = document.createElement('span');
        copy.className = 'record-copy';
        const title = document.createElement('strong');
        title.textContent = track.shortTitle;
        if (track.albumId) {
          const parent = this.tracks.find(item => item.id === track.albumId);
          const index = parent.movementIds.indexOf(track.id);
          title.textContent = `${['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'][index] || index + 1} · 第${['一', '二', '三', '四', '五'][index] || index + 1}乐章`;
        }
        const subtitle = document.createElement('small');
        subtitle.textContent = track.locked ? '待授权 · 无法播放' : track.composerLabel || track.libraryGroup || '';
        if (track.albumId) subtitle.textContent = (track.plan?.movement || track.label).replace(/^第\s*\d+\s*乐章\s*[·]?\s*/, '');
        const duration = Math.round(track.plan?.estimatedDurationSeconds || 0);
        if (!track.locked) subtitle.textContent += ` · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
        if (track.libraryGroup === '写作选段' && !subtitle.textContent.includes('选段')) subtitle.textContent += ' · 写作选段';
        copy.append(title, subtitle);
        if (track.kind === 'concert') {
          const expand = document.createElement('button');
          expand.type = 'button'; expand.className = 'record-expand';
          expand.textContent = '›';
          expand.setAttribute('aria-label', `展开${track.shortTitle}的乐章`);
          expand.setAttribute('aria-expanded', String(this.expandedAlbums.has(track.id)));
          expand.addEventListener('click', () => {
            const opened = !this.expandedAlbums.has(track.id);
            if (opened) this.expandedAlbums.add(track.id); else this.expandedAlbums.delete(track.id);
            expand.setAttribute('aria-expanded', String(opened));
            this.list.querySelectorAll('[data-album-id]').forEach(row => {
              if (row.dataset.albumId === track.id) row.hidden = !opened;
            });
          });
          title.append(expand);
          const playing = document.createElement('small'); playing.className = 'record-child-status'; copy.append(playing);
        }
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'record-load';
        load.textContent = track.locked ? '待授权' : this.loadedId === track.id ? '已装载' : '装入唱片';
        load.disabled = Boolean(track.locked || this.loadedId === track.id);
        load.addEventListener('click', () => void this.load(track));
        choice.addEventListener('click', (event) => {
          if (this.suppressClick) { this.suppressClick = false; return; }
          if (this.teaching || event.detail === 0) { void this.load(track); return; }
          this.selectedId = track.id;
          this.list.querySelectorAll('.record-entry').forEach((row) => row.classList.toggle('is-selected', row === entry));
        });
        choice.addEventListener('pointermove', (event) => this.pointerMove(event, choice, entry, track));
        choice.addEventListener('pointerdown', (event) => this.pointerDown(event, choice, track));
        choice.addEventListener('pointerup', (event) => this.pointerUp(event, track));
        choice.addEventListener('pointercancel', () => this.cancelDrag());
        choice.addEventListener('pointerleave', () => {
          if (!this.drag?.moved) choice.style.cssText = '';
        });
        entry.append(choice, copy, load);
        this.list.append(entry);
      }
      this.list.scrollTop = scrollTop;
    }

    async load(track, origin) {
      if (track.locked || (this.loadedId === track.id && !this.teaching)) return;
      const motion = this.flyToTurntable(track, origin);
      const [success] = await Promise.all([this.onLoad(track.id), motion]);
      if (success === false) return;
      this.selectedId = null;
      this.setOpen(false);
      this.folder.focus({ preventScroll: true });
    }

    async flyToTurntable(track, origin) {
      if (this.reducedMotion.matches) return;
      const choice = this.list.querySelector(`[data-track-id="${track.id}"] .record-choice`);
      const source = choice?.getBoundingClientRect();
      const target = this.stage.getBoundingClientRect();
      if (!source) return;
      const startX = origin?.x ?? source.left + source.width / 2;
      const startY = origin?.y ?? source.top + source.height / 2;
      const endX = target.left + target.width * .42;
      const endY = target.top + target.height * .49;
      const ghost = this.makeGhost(track);
      ghost.style.left = `${startX}px`;
      ghost.style.top = `${startY}px`;
      try {
        await ghost.animate([
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(.72)`, opacity: .9 },
        ], { duration: 720, easing: 'cubic-bezier(.22,.8,.22,1)' }).finished;
      } finally { ghost.remove(); }
    }

    async returnToFolder(track) {
      if (!track || this.reducedMotion.matches) return;
      const source = this.stage.getBoundingClientRect();
      const target = this.folder.getBoundingClientRect();
      const startX = source.left + source.width * .42;
      const startY = source.top + source.height * .49;
      const endX = target.left + target.width * .48;
      const endY = target.top + target.height * .36;
      const ghost = this.makeGhost(track);
      ghost.style.left = `${startX}px`;
      ghost.style.top = `${startY}px`;
      try {
        await ghost.animate([
          { transform: 'translate(-50%,-50%) scale(.72)', opacity: .9 },
          { transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(.53)`, opacity: 0 },
        ], { duration: 280, easing: 'cubic-bezier(.25,.7,.25,1)' }).finished;
      } finally { ghost.remove(); }
    }

    pointerDown(event, choice, track) {
      if (track.locked || event.button !== 0) return;
      this.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        choice, track, moved: false, ghost: null };
      choice.setPointerCapture(event.pointerId);
    }

    pointerMove(event, choice, entry, track) {
      const bounds = choice.getBoundingClientRect();
      if (this.drag?.pointerId === event.pointerId) {
        const drag = this.drag;
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
          drag.moved = true;
          drag.ghost = this.makeGhost(track);
          choice.classList.add('is-dragging');
        }
        if (drag.moved) {
          event.preventDefault();
          drag.ghost.style.left = `${event.clientX}px`;
          drag.ghost.style.top = `${event.clientY}px`;
          this.stage.classList.toggle('is-drop-target', this.isInsideStage(event.clientX, event.clientY));
          return;
        }
      }
      if (this.reducedMotion.matches || event.pointerType === 'touch') return;
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      choice.style.setProperty('--tilt-x', `${((.5 - y) * 14).toFixed(2)}deg`);
      choice.style.setProperty('--tilt-y', `${((x - .5) * 14).toFixed(2)}deg`);
      choice.style.setProperty('--spot-x', `${(x * 100).toFixed(1)}%`);
      choice.style.setProperty('--spot-y', `${(y * 100).toFixed(1)}%`);
    }

    pointerUp(event, track) {
      const drag = this.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        this.suppressClick = true;
        if (this.isInsideStage(event.clientX, event.clientY)) {
          void this.load(track, { x: event.clientX, y: event.clientY });
        }
      }
      this.cancelDrag();
    }

    isInsideStage(x, y) {
      const rect = this.stage.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    makeGhost(track) {
      const ghost = document.createElement('div');
      ghost.className = 'record-drag-ghost';
      ghost.innerHTML = `<img src="${vinylSrc}" alt=""><img class="record-drag-cover" alt="">`;
      ghost.querySelector('.record-drag-cover').src = track.artwork?.src || '';
      document.body.append(ghost);
      return ghost;
    }

    cancelDrag() {
      if (!this.drag) return;
      this.drag.ghost?.remove();
      this.drag.choice.classList.remove('is-dragging');
      this.drag.choice.style.cssText = '';
      this.stage.classList.remove('is-drop-target');
      this.drag = null;
    }
  }

  global.TurntableController = TurntableController;
  global.VinylLibraryController = VinylLibraryController;
})(typeof window !== 'undefined' ? window : globalThis);

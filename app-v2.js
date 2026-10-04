(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const editor = $('#editor');
  const title = $('#chapter-title');
  const playButton = $('#play-btn');
  const downloadButton = $('#download-btn');
  const importButton = $('#import-btn');
  const albumFileInput = $('#album-file-input');
  const albumReplayButton = $('#album-replay-btn');
  const typingStartButton = $('#typing-test-start');
  const typingResetButton = $('#typing-test-reset');
  const holdButton = $('#hold-btn');
  const volumeSlider = $('#volume');
  const maxVolume = Number(volumeSlider.max) || 200;
  const musicSelect = $('#music-select');
  const appShell = $('#app-shell');
  const sandbox = new URLSearchParams(globalThis.location?.search || '').get('demo') === '1';
  // The app's root base keeps resource URLs stable under /app/. Keep its
  // same-document keyboard shortcut on the current app URL, too.
  const skipLink = $('.skip-link');
  if (skipLink && globalThis.location) skipLink.href = `${location.pathname}${location.search}#editor`;
  const storage = sandbox ? new SonataMemoryStorage() : (() => {
    try { return globalThis.localStorage; } catch { return null; }
  })();
  const draftStore = new SonataDraftStore(storage);
  const read = (key, fallback = '') => {
    try { return storage?.getItem(key) ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { if (!storage) return false; storage.setItem(key, value); return true; } catch { return false; }
  };
  const faceToggleButton = $('#face-toggle-btn');
  const faceToggleLabel = $('#face-toggle-label');
  const writingFace = $('#writing-face');
  const orchestraFace = $('#orchestra-face');
  const model = new PredictiveConductor({ storage });
  const mockSemanticProvider = new MockSemanticEmotionProvider();
  const liveSemanticProvider = new HunyuanSemanticEmotionProvider();
  const emotionStabilizer = new EmotionStabilizer();
  const orchestrationPlanner = new OrchestrationPlanner();
  const semanticController = new SemanticAdaptationController({
    provider: liveSemanticProvider, stabilizer: emotionStabilizer,
    planner: orchestrationPlanner,
  });
  const keys = {
    draft: 'sonata-novel-draft',
    title: 'sonata-novel-title',
    volume: 'sonata-volume',
    track: 'sonata-program-v2',
  };

  const tracks = window.PLAYABLE_MUSIC_LIBRARY || [];
  const newGroups = new Map();
  for (const track of tracks.filter(track => track.lazy || track.albumId)) {
    const name = track.libraryGroup;
    if (!newGroups.has(name)) {
      const group = document.createElement('optgroup');
      group.label = name;
      newGroups.set(name, group);
      musicSelect.append(group);
    }
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = track.label;
    newGroups.get(name).append(option);
  }
  const mixProfile = new URLSearchParams(globalThis.location?.search || '').get('mix') === 'legacy'
    ? 'legacy' : 'rounded-v1';
  const loadedTrackKey = 'sonata-loaded-record-v1';
  let loadedTrackId = read(loadedTrackKey) || null;
  if (!tracks.some((track) => track.id === loadedTrackId)) loadedTrackId = null;
  let activeTrack = tracks.find((track) => track.id === loadedTrackId)
    || tracks.find((track) => track.id === readTrackPreference()) || tracks[0];
  const turntable = new TurntableController($('#turntable-stage'), $('#tonearm-btn'));
  const vinylLibrary = new VinylLibraryController({ tracks, stage: $('#turntable-stage'),
    onLoad: (id) => loadRecord(id) });

  let score = null;
  let pendingMuted = false;
  let saveTimer = null;
  let audioBusy = false;
  let onboarding = null;
  let guideActive = false;
  let guidePractice = null;
  let playbackError = '';
  let toastTimer = null;
  let recordBusy = false;
  let recordRequest = 0;
  let composing = false;
  let compositionBase = '';
  let compositionTimer = null;
  let previousText = '';
  let lastEditAt = null;
  let focusSeconds = 0;
  let lastClockAt = Date.now();
  let typingReplay = null;
  let typingReplayStarting = false;
  let concertClock = null;
  let emotionSimulationActive = false;
  let calmEmotionMode = false;
  let liveSemanticEnabled = false;
  let liveSemanticBusy = false;
  let firstLiveSemanticAnalysis = true;
  let emotionSnapshot = emotionStabilizer.snapshot;
  let emotionPlan = orchestrationPlanner.plan(emotionSnapshot.forecast);
  let albumTrace = [];
  let albumTransport = [];
  let transport = null;
  let albumSessionStartedAt = null;
  let lastAlbumFrameAt = Number.NEGATIVE_INFINITY;
  let importedAlbum = null;
  let albumReplay = null;
  let albumReplayStarting = false;
  let currentProgramPhase = null;
  let hall = null;
  let audition = null;
  const scoreRail = new ScoreRailVisualizer($('#score-rail'), {
    clock: () => Number(score?.context?.currentTime) || 0,
  });
  const guideMusic = new FirstNotesMusic({
    onFrame(frame, energy) {
      $('#score-rail').dataset.clockSource = guideMusic.audible ? 'audio' : 'visual';
      scoreRail.clear();
      scoreRail.setClock(() => guideMusic.clock());
      scoreRail.travelTime = .65;
      scoreRail.setEnergy(energy);
      scoreRail.enqueue(frame);
      scoreRail.setPlaying(true);
    },
    onState(state) {
      $('#first-notes').dataset.audioState = state;
      $('#guide-audio-btn').hidden = state !== 'blocked' || !guideActive;
    },
  });
  const scoreStage = new ScoreStageController($('#conductor-stage'),
    $('#conductor-stage-term'), $('#conductor-stage-meaning'));

  const iconMarkup = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10"/></svg>',
    muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="m16 10 5 5m0-5-5 5"/></svg>',
  };
  const channelByInstrument = {
    violin1: 'strings', violin2: 'strings', viola: 'strings', cello: 'strings', doubleBass: 'strings',
    flute: 'woodwinds', oboe: 'woodwinds', clarinet: 'woodwinds', bassoon: 'woodwinds',
    horn: 'brass', trumpet: 'brass', trombone: 'brass', tuba: 'brass',
    timpani: 'percussion', bassDrum: 'percussion', cymbal: 'percussion', tamTam: 'percussion',
    harp: 'color',
  };
  const channelScale = { strings: 6, woodwinds: 2.4, brass: 2.8, percussion: 1.5, color: 1.1 };
  const instrumentVisuals = {
    violin1: { asset: 'violin.png', label: '第一小提琴', family: 'strings', mixFamily: 'upperStrings', scale: 1.55 },
    violin2: { asset: 'violin.png', label: '第二小提琴', family: 'strings', mixFamily: 'upperStrings', scale: 1.55 },
    viola: { asset: 'viola.png', label: '中提琴', family: 'strings', mixFamily: 'lowerStrings', scale: 1.45 },
    cello: { asset: 'cello.png', label: '大提琴', family: 'strings', mixFamily: 'lowerStrings', scale: 1.45 },
    doubleBass: { asset: 'double-bass.png', label: '低音提琴', family: 'strings', mixFamily: 'lowerStrings', scale: 1.05 },
    flute: { asset: 'flute.png', label: '长笛', family: 'woodwinds', mixFamily: 'woodwinds', scale: .82 },
    oboe: { asset: 'oboe.png', label: '双簧管', family: 'woodwinds', mixFamily: 'woodwinds', scale: .82 },
    clarinet: { asset: 'clarinet.png', label: '单簧管', family: 'woodwinds', mixFamily: 'woodwinds', scale: .88 },
    bassoon: { asset: 'bassoon.png', label: '巴松', family: 'woodwinds', mixFamily: 'woodwinds', scale: .9 },
    horn: { asset: 'horn.png', label: '圆号', family: 'brass', mixFamily: 'brass', scale: 1.25 },
    trumpet: { asset: 'trumpet.png', label: '小号', family: 'brass', mixFamily: 'brass', scale: .92 },
    trombone: { asset: 'trombone.png', label: '长号', family: 'brass', mixFamily: 'brass', scale: 1.02 },
    tuba: { asset: 'tuba.png', label: '大号', family: 'brass', mixFamily: 'brass', scale: .86 },
    timpani: { asset: 'timpani.png', label: '定音鼓', family: 'percussion', mixFamily: 'percussion', scale: .7 },
    bassDrum: { asset: 'bass-drum.png', label: '大鼓', family: 'percussion', mixFamily: 'percussion', scale: .62 },
    cymbal: { asset: 'cymbal.png', label: '钹', family: 'percussion', mixFamily: 'percussion', scale: .58 },
    tamTam: { asset: 'tam-tam.png', label: '锣', family: 'percussion', mixFamily: 'percussion', scale: .58 },
    harp: { asset: 'harp.png', label: '竖琴', family: 'color', mixFamily: 'color', scale: .72 },
  };
  const orchestraSeatPlan = [
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
  const activeModel = () => typingReplay?.scenario.model || model;

  const length = (value) => Array.from(value).length;

  function readTrackPreference() {
    return read('sonata-program-v2', null);
  }

  function formatClock(seconds) {
    const value = Math.max(0, Math.round(seconds || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function setFace(face) {
    const showBack = face === 'back';
    const wasBack = appShell.dataset.face === 'back';
    if (showBack && !vinylLibrary.panel.hidden) vinylLibrary.setOpen(false);
    appShell.dataset.face = showBack ? 'back' : 'front';
    faceToggleButton.setAttribute('aria-pressed', String(showBack));
    faceToggleLabel.textContent = showBack ? '回到写作' : '翻到总谱';
    faceToggleButton.setAttribute('aria-label', faceToggleLabel.textContent);
    faceToggleButton.title = faceToggleLabel.textContent;
    writingFace.setAttribute('aria-hidden', String(showBack));
    orchestraFace.setAttribute('aria-hidden', String(!showBack));
    writingFace.inert = showBack;
    orchestraFace.inert = !showBack;
    if (showBack) $('#orchestra-heading').focus({ preventScroll: true });
    else {
      audition?.stop();
      if (wasBack) editor.focus?.({ preventScroll: true });
    }
    updateHall();
    if (showBack) hall?.showReview(albumTrace, title.value, length(editor.value));
    onboarding?.update({ face: showBack ? 'back' : 'front' });
  }

  function toast(message) {
    const element = $('#experience-toast');
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
  }

  function buildOrchestraSeats() {
    const container = $('#orchestra-seats');
    if (!container) return;
    const fragment = document.createDocumentFragment();
    const seen = new Set();
    const mobileRows = { percussion: [17, [20, 40, 60, 80]], brass: [35, [20, 40, 60, 80]],
      woodwinds: [53, [20, 40, 60, 80]], strings: [73, [10, 30, 50, 70, 90]], color: [91, [16]] };
    orchestraSeatPlan.forEach((seatConfig, index) => {
      const visual = instrumentVisuals[seatConfig.instrument];
      if (!visual) return;
      const seat = document.createElement('button');
      seat.type = 'button';
      seat.className = `instrument-seat family-${visual.family}`;
      seat.setAttribute('aria-label', `试听${visual.label}并查看介绍`);
      seat.setAttribute('aria-pressed', 'false');
      seat.setAttribute('aria-controls', 'instrument-detail');
      seat.dataset.duplicate = String(seen.has(seatConfig.instrument));
      seen.add(seatConfig.instrument);
      seat.dataset.instrument = seatConfig.instrument;
      seat.dataset.orchestraInstrument = seatConfig.instrument;
      seat.dataset.seatGain = String(seatConfig.gain);
      seat.dataset.seatIndex = String(index + 1);
      seat.dataset.playing = 'false';
      seat.style.setProperty('--x', String(seatConfig.x));
      seat.style.setProperty('--y', String(seatConfig.y));
      seat.style.setProperty('--size', String(seatConfig.size));
      seat.style.setProperty('--tilt', String(seatConfig.tilt));
      const mobileRow = mobileRows[visual.family];
      const familyIndex = OrchestraInstrumentGuide.families[visual.family].members.indexOf(seatConfig.instrument);
      seat.style.setProperty('--mobile-x', String(mobileRow[1][familyIndex]));
      seat.style.setProperty('--mobile-y', String(mobileRow[0]));

      const light = document.createElement('i');
      light.className = 'instrument-light';
      const icon = document.createElement('i');
      icon.className = 'instrument-icon';
      icon.style.setProperty('--icon-image', `url("./assets/images/orchestra-icons/${visual.asset}")`);
      light.setAttribute('aria-hidden', 'true');
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'seat-label';
      label.textContent = visual.label;
      label.setAttribute('aria-hidden', 'true');
      seat.append(light, icon, label);
      seat.addEventListener('click', () => selectInstrument(seatConfig.instrument));
      fragment.append(seat);
    });
    container.replaceChildren(fragment);
  }

  function selectInstrument(id) {
    if (!id) { audition?.stop(); return; }
    hall.select(id);
    updateHall();
    if (score?.playing || audioBusy || recordBusy) return;
    audition.configure({ volume: Number(volumeSlider.value) / 100, muted: score?.muted ?? pendingMuted });
    void audition.play(OrchestraInstrumentGuide.instruments[id]);
  }

  function updateHall() {
    audition?.configure({ enabled: !score?.playing && !audioBusy && !recordBusy });
    if (hall) $('#hall-volume').value = volumeSlider.value;
    hall?.update({ playing: Boolean(score?.playing), muted: score?.muted ?? pendingMuted,
      audioTime: Number(score?.context?.currentTime) || 0, loaded: Boolean(loadedTrackId),
      title: activeTrack?.shortTitle || '', feedback: playbackError || (audioBusy ? $('#player-status').textContent : ''),
      busy: audioBusy || recordBusy, pauseSeconds: activeModel().snapshot.pauseSeconds || 0,
      locked: Boolean(score?.locked), demo: Boolean(typingReplay || albumReplay) });
  }

  function syncVolumeControls(value) {
    for (const slider of [volumeSlider, $('#vinyl-volume'), $('#hall-volume')]) {
      slider.value = String(value);
      slider.setAttribute('aria-valuetext', `${value}%`);
    }
    $('#volume-value').textContent = `${value}%`;
    $('#hall-volume-value').textContent = `${value}%`;
  }

  function applyVolume(value) {
    const percent = Math.round(clamp(Number(value) || 0, 0, maxVolume));
    syncVolumeControls(percent);
    write(keys.volume, String(percent));
    score?.setVolume(percent / 100);
    guideMusic.setVolume(percent / 100);
    audition?.configure({ volume: percent / 100 });
  }

  function channelGainDb(channel) {
    const gains = score?.currentGestureMix?.familyGainsDb || {};
    if (channel === 'strings') return Math.max(Number(gains.upperStrings) || 0,
      Number(gains.lowerStrings) || 0);
    return Number(gains[channel]) || 0;
  }

  function instrumentGainDb(instrument) {
    const mix = score?.currentGestureMix || {};
    const visual = instrumentVisuals[instrument];
    return (Number(mix.familyGainsDb?.[visual?.mixFamily]) || 0)
      + (Number(mix.instrumentGainsDb?.[instrument]) || 0);
  }

  function updateOrchestraMonitor() {
    const active = Boolean(score?.playing && score.eventsByBar?.length);
    const levels = { strings: 0, woodwinds: 0, brass: 0, percussion: 0, color: 0 };
    const instrumentEnergy = Object.fromEntries(Object.keys(instrumentVisuals)
      .map((instrument) => [instrument, 0]));
    if (active) {
      const barIndex = Math.max(0, (Math.max(1, score.currentBar) - 1) % score.eventsByBar.length);
      for (const event of score.eventsByBar[barIndex] || []) {
        const channel = channelByInstrument[event.instrument];
        if (!channel || (score.sparse && event.optional)) continue;
        const energy = (Number(event.velocity) || 0.2)
          * Math.sqrt(Math.max(0.2, Number(event.durationBeats) || 1));
        levels[channel] += energy;
        instrumentEnergy[event.instrument] += energy;
      }
    }

    const instrumentLevels = {};
    for (const [instrument, visual] of Object.entries(instrumentVisuals)) {
      const adjustedEnergy = instrumentEnergy[instrument]
        * 10 ** (instrumentGainDb(instrument) / 20);
      instrumentLevels[instrument] = active
        ? Math.min(1, Math.max(.02, .02 + .98 * (1 - Math.exp(-adjustedEnergy / visual.scale))))
        : .02;
    }
    document.querySelectorAll('[data-orchestra-instrument]').forEach((seat) => {
      const baseLevel = instrumentLevels[seat.dataset.orchestraInstrument] || .02;
      const rawLevel = Math.min(1, Math.max(.02,
        baseLevel * (Number(seat.dataset.seatGain) || 1)));
      const displayLevel = active ? 1 - (1 - rawLevel) ** 1.7 : .02;
      seat.style.setProperty('--level', displayLevel.toFixed(3));
      seat.dataset.rawLevel = rawLevel.toFixed(3);
      seat.dataset.level = displayLevel.toFixed(3);
      seat.dataset.playing = String(active && rawLevel > .08);
    });

    const strongestInstruments = Object.values(instrumentLevels).sort((a, b) => b - a).slice(0, 5);
    const strongestMean = strongestInstruments.reduce((sum, level) => sum + level, 0)
      / Math.max(1, strongestInstruments.length);
    const conductorRawLevel = active
      ? Math.min(1, .55 * (strongestInstruments[0] || .02) + .45 * strongestMean)
      : .04;
    const conductorDisplayLevel = active ? 1 - (1 - conductorRawLevel) ** 1.5 : .04;
    const conductor = $('#conductor-figure');
    conductor?.style.setProperty('--level', conductorDisplayLevel.toFixed(3));
    if (conductor) {
      conductor.dataset.rawLevel = conductorRawLevel.toFixed(3);
      conductor.dataset.level = conductorDisplayLevel.toFixed(3);
      conductor.dataset.playing = String(active && conductorRawLevel > .08);
    }

    let dominant = null;
    let dominantLevel = 0;
    const labels = { strings: '弦乐', woodwinds: '木管', brass: '铜管', percussion: '打击乐', color: '色彩乐器' };
    for (const [channel, raw] of Object.entries(levels)) {
      const mixFactor = 10 ** (channelGainDb(channel) / 20);
      const level = active ? Math.min(1, Math.max(0.035, raw * mixFactor / channelScale[channel])) : 0.035;
      const card = document.querySelector(`[data-channel="${channel}"]`);
      card?.style.setProperty('--level', level.toFixed(3));
      const value = card?.querySelector('[data-channel-value]');
      if (value) value.textContent = active ? `${Math.round(level * 100)}%` : '待命';
      if (level > dominantLevel) { dominant = channel; dominantLevel = level; }
    }
    appShell.dataset.orchestraActive = String(active);
    const status = document.querySelector('#orchestra-status span');
    if (status) status.textContent = active && dominantLevel > 0.08
      ? `${labels[dominant]}正在演奏` : active ? '乐团轻声呼吸' : '乐团待命';
    updateHall();
  }

  function showConcertClock(elapsedSeconds, remainingSeconds) {
    const total = score?.durationSeconds || activeTrack.plan.estimatedDurationSeconds || 0;
    $('#concert-clock').textContent = `${formatClock(elapsedSeconds)} / ${formatClock(total)}`;
    $('#concert-remaining').textContent = loadedTrackId ? formatClock(remainingSeconds) : '--:--';
    $('#progress-fill').style.width = `${total ? Math.min(100, elapsedSeconds / total * 100) : 0}%`;
    turntable.stage.style.setProperty('--groove-progress', String(total ? Math.min(1, elapsedSeconds / total) : 0));
    turntable.stage.style.setProperty('--arm-angle', `${-1 - (total ? Math.min(1, elapsedSeconds / total) : 0) * 10}deg`);
    hall?.showClock(elapsedSeconds, loadedTrackId ? total : 0);
  }

  function showVinylInfo() {
    const loaded = tracks.find((track) => track.id === loadedTrackId);
    $('#vinyl-track-title').textContent = loaded?.shortTitle || '从唱片夹装入音乐';
    $('#vinyl-composer').textContent = loaded?.composerLabel || '唱针抬起 · 等待装载';
    $('#vinyl-program-position').textContent = loaded
      ? loaded.kind === 'concert' ? $('#program-position').textContent : loaded.albumId ? '完整乐章' : loaded.libraryGroup === '写作选段' ? '写作选段' : '单曲试听'
      : '—';
    const cover = $('#vinyl-info-cover');
    cover.src = loaded?.artwork?.src || '';
    cover.alt = loaded?.artwork?.alt || '';
    cover.hidden = !loaded;
  }

  function showTrack() {
    if (!activeTrack) return;
    musicSelect.value = activeTrack.id;
    $('#section-title').textContent = `${activeTrack.shortTitle} · 等待播放`;
    const isConcert = activeTrack.kind === 'concert';
    $('#bar-label').textContent = isConcert ? '当前乐章' : '当前小节';
    $('#bar-value').textContent = isConcert
      ? `1 / ${activeTrack.plan.program.itemCount}` : `— / ${activeTrack.plan.totalBars}`;
    $('#bpm-display').textContent = `${activeTrack.plan.baseTempoBpm.toFixed(1)} BPM`;
    $('#progress-fill').style.width = '0%';
    $('#score-description').textContent = activeTrack.description;
    $('#score-rights').textContent = activeTrack.rights;
    $('#concert-kicker').textContent = isConcert ? '本场演出' : '单曲试听';
    $('#concert-title').textContent = isConcert ? activeTrack.plan.program.title : activeTrack.shortTitle;
    $('#program-position').textContent = isConcert ? `乐章 1 / ${activeTrack.plan.program.itemCount}` : '独立曲目';
    $('#program-title').textContent = isConcert ? activeTrack.plan.program.items[0].label : activeTrack.label;
    concertClock = { elapsed: 0, remaining: activeTrack.plan.estimatedDurationSeconds,
      updatedAt: Date.now() };
    showConcertClock(0, activeTrack.plan.estimatedDurationSeconds || 0);
  }

  function updateCount() {
    $('#word-count').textContent = typingReplay
      ? typingReplay.scenario.typedCount.toLocaleString('zh-CN')
      : length(editor.value.replace(/\s/g, '')).toLocaleString('zh-CN');
  }

  function queueSave() {
    $('#save-status').textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 350);
  }

  function saveDraft() {
    const saved = draftStore.save({ text: guidePractice ? guidePractice.text : typingReplay ? typingReplay.originalDraft : editor.value,
      title: guidePractice ? guidePractice.title : typingReplay ? typingReplay.originalTitle : title.value,
      focusSeconds: guidePractice ? guidePractice.focusSeconds : typingReplay ? typingReplay.originalFocusSeconds : focusSeconds });
    $('#save-status').textContent = sandbox ? '演示空间 · 不写入草稿' : saved ? '已自动保存 · 本机' : '保存失败，请留存文字';
    if (draftStore.conflict) $('#save-status').textContent = '另一窗口已更新，请先留存';
    $('#save-status').dataset.state = saved ? 'saved' : 'error';
    $('#draft-recovery-btn').disabled = !draftStore.previous() || Boolean(typingReplay);
    return saved;
  }

  function updateDemoButtons() {
    $('#showcase-strip').hidden = !typingReplay;
    $('#showcase-btn').disabled = typingReplayStarting;
    $('#showcase-btn').querySelector('span').textContent = typingReplay ? '停止' : '演示';
    $('#album-export-back-btn').disabled = Boolean(typingReplay);
    for (const button of document.querySelectorAll('[data-demo]')) {
      button.setAttribute('aria-pressed', String(!typingReplay
        && button.dataset.demo === (model.demoMode || 'off')));
    }
    $('#mode-indicator').textContent = typingReplay
      ? typingReplay.done ? '演示 · 回放完成' : '演示 · 500 字回放'
      : model.demoMode === 'flow'
      ? '演示 · 持续写作'
      : model.demoMode === 'pause' ? '演示 · 停笔构思'
      : activeTrack?.kind === 'concert'
        ? `${Math.round(activeTrack.plan.estimatedDurationSeconds / 60)} 分钟演出` : '实时写作';
  }

  function recordInput(characters, options = {}) {
    if (guideActive) return;
    model.record({ characters, ...options });
    lastEditAt = Date.now();
    recordAlbumFrame(false, model.snapshot);
    updateDemoButtons();
  }

  function handleTextInput(event) {
    if (albumReplay) stopAlbumReplay('已恢复真实写作指挥');
    lastEditAt = Date.now();
    const next = editor.value;
    const changed = next !== previousText;
    const delta = length(next) - length(previousText);
    previousText = next;
    updateCount();
    queueSave();

    if (composing || compositionTimer !== null || event.isComposing || event.inputType === 'insertCompositionText'
      || event.inputType === 'insertFromComposition') return;
    const pasted = /insertFromPaste|insertFromDrop|insertFromYank/.test(event.inputType || '');
    onboarding?.input?.({ text: next, inserted: changed && delta <= 0 && /insertText|insertReplacementText/.test(event.inputType || '')
      ? length(event.data || '') : delta,
      kind: pasted ? 'paste' : /historyUndo|historyRedo/.test(event.inputType || '') ? 'history' : 'insert' });
    if (guideActive) return;
    if (delta > 0) {
      recordInput(delta, { pasted });
    } else if (delta < 0) {
      recordInput(Math.abs(delta), { deleted: true });
    }
    void analyzeLiveSemantic({
      paragraphCompleted: /insertParagraph|insertLineBreak/.test(event.inputType || ''),
    });
  }

  function showForecast(snapshot) {
    const source = activeModel();
    const energy = Number(snapshot.energy ?? snapshot.charge) || 0;
    const percent = Math.round(energy * 100);
    $('#charge-ring').style.setProperty('--charge', `${percent}%`);
    $('#charge-value').textContent = `${percent}%`;
    $('#confidence-value').textContent = snapshot.confidence > 0
      ? `${Math.round(snapshot.confidence * 100)}%` : '积累中';

    const heading = $('#state-title');
    const description = $('#state-description');
    if (source.firstEditAt === null && !source.demoMode) {
      heading.textContent = '等待落笔';
      description.textContent = '音乐有自己的呼吸。开始写作后，这里会缓缓显示你的演奏倾向。';
    } else if (snapshot.confidence < 0.12) {
      heading.textContent = '先听这一句';
      description.textContent = '还在积累写作线索，乐团保持原来的演奏方向。';
    } else if (snapshot.pauseSeconds >= 12 || source.demoMode === 'pause') {
      heading.textContent = '下一句 · 轻轻收束';
      description.textContent = '12 秒构思保护已经结束，乐团正用更长的时间缓慢隐没。';
    } else if (snapshot.pauseSeconds > 2) {
      heading.textContent = '构思保护中';
      description.textContent = '短暂停笔不会改变方向。系统保留当前预判，等待下一句文字。';
    } else if (snapshot.forecast >= 0.62) {
      heading.textContent = '下一句 · 稍向前行';
      description.textContent = '持续书写正在积蓄动能；进入下一乐句后，速度只会轻微上扬。';
    } else {
      heading.textContent = '下一句 · 从容叙事';
      description.textContent = '保持平稳呼吸。文字的瞬时快慢不会打断当前乐句。';
    }
    showTypingDiagnostics(snapshot);
    updateFrontPerformance(snapshot);
  }

  function updateFrontPerformance(snapshot = activeModel().snapshot) {
    if (guideActive) return;
    const playing = Boolean(score?.playing);
    scoreRail.setEnergy(snapshot.energy ?? snapshot.charge ?? 0);
    scoreRail.setPlaying(playing);
    scoreStage.update(snapshot, {
      playing,
      completed: Boolean(score?.completed),
      programPhase: currentProgramPhase,
      bar: score?.currentBar || 0,
    });
  }

  function showTypingDiagnostics(snapshot) {
    const raw = snapshot.raw || {};
    const put = (id, value) => { const element = $(id); if (element) element.textContent = value; };
    put('#typing-text-rate', `${Math.round(raw.textRate || 0)} 字/分`);
    put('#typing-key-rate', `${Math.round(raw.keyRate || 0)} 键/分`);
    put('#typing-flight', `${Math.round(raw.flightMs || snapshot.baseline?.flightMs || 0)} ms`);
    put('#typing-dwell', `${Math.round(raw.dwellMs || snapshot.baseline?.dwellMs || 0)} ms`);
    put('#typing-continuity', `${Math.round((raw.continuity || 0) * 100)}%`);
    const pause = Math.max(0, Number(snapshot.pauseSeconds) || 0);
    put('#typing-pause', pause <= 2 ? '正常输入' : pause < 12
      ? `保护剩余 ${(12 - pause).toFixed(0)} 秒` : pause < 40 ? '缓慢隐没中' : '低能量保持');
    put('#typing-forecast', `${Math.round((snapshot.forecast || 0) * 100)}% · 未来 6 秒`);
    const beat = score ? score.absoluteBarStartBeat(score.currentBar) : 0;
    const performance = score?.performanceAtBeat(beat);
    const mix = score?.currentGestureMix;
    const clean = (value) => Math.abs(value) < 0.05 ? 0 : value;
    put('#typing-tempo-output', performance
      ? `${clean((score.interactionScaleAt(beat) - 1) * 100).toFixed(1)}%` : '等待播放');
    put('#typing-dynamic-output', mix
      ? `${clean(Number(mix.dynamicDb || 0)).toFixed(1)} dB` : '等待播放');
    put('#typing-density-output', mix
      ? `${Math.round(Number(mix.densityBias || 0) * 100)}%` : '等待播放');
    put('#typing-baseline-status', snapshot.calibration?.ready
      ? `已学习 · ${snapshot.calibration.samples || 0} 次更新`
      : `学习中 · ${snapshot.calibration?.validKeys || 0}/120 键`);
  }

  function showEmotionPlan(status) {
    const state = emotionSnapshot.smoothed;
    const raw = emotionSnapshot.observation;
    $('#emotion-raw').textContent = raw
      ? `${raw.narrativeMode} · ${raw.valence.toFixed(2)} / ${raw.arousal.toFixed(2)} / ${raw.tension.toFixed(2)}`
      : '尚无输入';
    $('#emotion-mode').textContent = emotionPlan.label;
    $('#emotion-values').textContent = [state.valence, state.arousal, state.tension]
      .map((value) => value.toFixed(2)).join(' / ');
    const tempoPercent = Math.round((emotionPlan.tempoScale - 1) * 1000) / 10;
    const emphasized = Object.entries(emotionPlan.familyGainsDb)
      .filter(([, db]) => db > 0.2).map(([family]) => ({
        upperStrings: '上方弦乐', lowerStrings: '中低弦', woodwinds: '木管',
        brass: '铜管', percussion: '打击乐', color: '色彩乐器',
      })[family] || family);
    $('#emotion-plan').textContent = `${tempoPercent >= 0 ? '+' : ''}${tempoPercent}% 速度`
      + `${emphasized.length ? ` · 突出${emphasized.join('、')}` : ' · 原始配器平衡'}`
      + `${emotionPlan.calmMode ? ' · 平静限制' : ''}`;
    $('#emotion-fingerprint').textContent = emotionPlan.fingerprint;
    $('#emotion-motion').textContent = emotionPlan.motion.stages.slice(0, -1)
      .map((stage) => stage.label).join(' → ');
    if (status) $('#emotion-status').textContent = status;
  }

  async function analyzeLiveSemantic({ paragraphCompleted = false, announceHeld = false } = {}) {
    if (!liveSemanticEnabled || liveSemanticBusy || typingReplay || composing) return;
    liveSemanticBusy = true;
    try {
      const result = await semanticController.consider(editor.value, {
        paragraphCompleted,
        isComposing: composing,
        allowTextUpload: true,
        elapsedSeconds: firstLiveSemanticAnalysis ? 60 : undefined,
        engagement: activeModel().snapshot.energy ?? activeModel().snapshot.charge,
        calmMode: calmEmotionMode,
      });
      if (!liveSemanticEnabled) return;
      if (result.observation) {
        firstLiveSemanticAnalysis = false;
        emotionSnapshot = result.snapshot;
        emotionPlan = result.plan;
        emotionSimulationActive = true;
        for (const button of document.querySelectorAll('[data-emotion]')) {
          button.setAttribute('aria-pressed', 'false');
        }
        $('#emotion-stage').textContent = '等待生效';
        if (!score) makeScore();
        else score.queueAdaptation(emotionPlan);
        const source = result.cached ? '本地缓存' : '混元';
        showEmotionPlan(`实时语义 · ${source}判断为${emotionPlan.label} · 等待下一乐句平滑生效`);
      } else if (result.status === 'held-provider-error') {
        showEmotionPlan(`实时语义暂缓：${result.reason}`);
      } else if (announceHeld) {
        const count = length(editor.value.trim());
        showEmotionPlan(`实时语义已开启 · 当前 ${count} 字，至少写到 80 字后分析`);
      }
    } finally {
      liveSemanticBusy = false;
    }
  }

  async function checkSemanticService() {
    const toggle = $('#live-semantic-toggle');
    const label = document.querySelector('.semantic-consent small');
    toggle.disabled = true;
    if (!/^https?:$/.test(globalThis.location?.protocol || '')) {
      if (label) label.textContent = '本地模式 · 启动服务后可开启';
      return;
    }
    try {
      const response = await fetch('/sheng-sui-bi-xing-demo/api/health', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('health unavailable');
      const status = await response.json();
      toggle.disabled = !status.semanticConfigured;
      if (label) label.textContent = status.semanticConfigured ? '已配置 · 由你开启' : '未配置分析服务 · 本地节奏可用';
    } catch {
      if (label) label.textContent = '连接暂不可用 · 本地节奏可用';
    }
  }

  async function simulateEmotion(mode) {
    const observation = await mockSemanticProvider.analyze('', { mode });
    emotionSnapshot = emotionStabilizer.ingest(observation, { elapsedSeconds: 90 });
    emotionPlan = orchestrationPlanner.plan(emotionSnapshot.forecast,
      { engagement: activeModel().snapshot.energy ?? activeModel().snapshot.charge,
        calmMode: calmEmotionMode });
    emotionSimulationActive = true;
    for (const button of document.querySelectorAll('[data-emotion]')) {
      button.setAttribute('aria-pressed', String(button.dataset.emotion === mode));
    }
    $('#emotion-stage').textContent = '等待生效';
    if (!score) makeScore();
    else score.queueAdaptation(emotionPlan);
    showEmotionPlan(score?.playing
      ? `${emotionPlan.label}已进入中期稳定器 · 等待下一乐句，最迟四小节后生效`
      : `${emotionPlan.label}已准备 · 开始音乐会后在首个乐句渐变生效`);
  }

  function updatePlayback() {
    updateDemoButtons();
    transport?.sync();
    const playing = Boolean(score?.playing);
    const isConcert = activeTrack?.kind === 'concert';
    $('#play-icon').innerHTML = playing ? iconMarkup.pause : iconMarkup.play;
    playButton.setAttribute('aria-label', playing ? (isConcert ? '暂停音乐会' : '暂停音乐')
      : (isConcert ? '开始音乐会' : '播放音乐'));
    if (!audioBusy) $('#player-status').textContent = playing ? (isConcert ? '演出进行中' : '音乐正在陪伴')
      : score?.completed ? '本场完成 · 可再次开演'
      : isConcert && score?.currentBar > 0 ? '演出暂停 · 点击继续'
      : isConcert ? '等待开演' : '开启音乐';
    $('#mute-btn').innerHTML = (score?.muted ?? pendingMuted) ? iconMarkup.muted : iconMarkup.volume;
    $('#mute-btn').setAttribute('aria-label', (score?.muted ?? pendingMuted) ? '取消静音' : '静音');
    const total = activeTrack?.plan?.estimatedDurationSeconds || 0;
    const elapsed = concertClock?.elapsed || 0;
    turntable.sync({ playing, busy: audioBusy || recordBusy, completed: Boolean(score?.completed),
      progress: total ? elapsed / total : 0 });
    const feedback = $('#playback-feedback');
    feedback.textContent = playbackError || (audioBusy ? $('#player-status').textContent : recordBusy ? '正在装入唱片…' : '');
    feedback.dataset.state = playbackError ? 'error' : audioBusy || recordBusy ? 'loading' : 'ready';
    onboarding?.update({ loaded: Boolean(loadedTrackId), playing, busy: audioBusy || recordBusy,
      face: appShell.dataset.face, demo: Boolean(typingReplay) });
    showVinylInfo();
    updateFrontPerformance();
    updateOrchestraMonitor();
  }

  function makeScore() {
    // Preferences can be used before a lazy score is loaded; apply them on first playback.
    if (!activeTrack?.plan?.events?.length) return;
    score = new OrchestraScore({
      plan: activeTrack?.plan,
      mixProfile,
      onLoading(done, total) {
        $('#player-status').textContent = `准备管弦乐音色 ${done}/${total}`;
        $('#playback-feedback').textContent = `乐团入场 ${done}/${total}`;
      },
      onSection(label) {
        $('#section-title').textContent = `${activeTrack.shortTitle} · ${label}`;
      },
      onVisualBar(frame) {
        scoreRail.enqueue(frame);
        hall?.enqueue(frame);
      },
      onVisualWindow(window) {
        scoreRail.enqueueWindow(window);
      },
      onProgress({ bar, totalBars, bpm, program }) {
        currentProgramPhase = program?.phase || 'performance';
        if (program?.phase === 'performance') {
          $('#bar-value').textContent = `${program.item.position} / ${program.item.total}`;
          $('#program-position').textContent = `乐章 ${program.item.position} / ${program.item.total}`;
          $('#program-title').textContent = program.item.label;
          concertClock = { elapsed: program.elapsedSeconds, remaining: program.remainingSeconds,
            updatedAt: Date.now() };
          if (!transport) showConcertClock(program.elapsedSeconds, program.remainingSeconds);
        } else if (program?.phase === 'intermission') {
          $('#program-position').textContent = '乐章间呼吸';
          $('#program-title').textContent = '下一乐章即将开始';
          concertClock = { elapsed: program.elapsedSeconds, remaining: program.remainingSeconds,
            updatedAt: Date.now() };
          if (!transport) showConcertClock(program.elapsedSeconds, program.remainingSeconds);
        } else {
          $('#bar-value').textContent = `${bar} / ${totalBars}`;
          const elapsed = activeTrack.plan.estimatedDurationSeconds * bar / totalBars;
          concertClock = { elapsed, remaining: activeTrack.plan.estimatedDurationSeconds - elapsed,
            updatedAt: Date.now() };
          if (!transport) showConcertClock(elapsed, concertClock.remaining);
        }
        $('#bpm-display').textContent = `${bpm.toFixed(1)} BPM`;
        showVinylInfo();
        updateFrontPerformance();
      },
      onComplete() {
        const total = activeTrack.plan.estimatedDurationSeconds || 0;
        concertClock = { elapsed: total, remaining: 0, updatedAt: Date.now() };
        showConcertClock(total, 0);
        $('#program-position').textContent = '演出结束';
        $('#program-title').textContent = '谢幕 · 本轮专注完成';
        $('#section-title').textContent = `${activeTrack.shortTitle} · 谢幕`;
        currentProgramPhase = 'complete';
        scoreRail.complete();
        updatePlayback();
      },
      onAdaptation({ phase, plan, phrase, stage, actual }) {
        if (!emotionSimulationActive) return;
        if (actual) {
          const tempo = `${actual.tempoScale >= 1 ? '+' : ''}${Math.round((actual.tempoScale - 1) * 1000) / 10}%`;
          const dynamic = `${actual.dynamicDb >= 0 ? '+' : ''}${actual.dynamicDb.toFixed(1)} dB`;
          const density = `${actual.densityBias >= 0 ? '+' : ''}${Math.round(actual.densityBias * 100)}% 密度`;
          $('#emotion-actual').textContent = `${tempo} · ${dynamic} · ${density}`;
        }
        if (phase === 'applied') {
          $('#emotion-stage').textContent = stage || plan.motion.stages[0].label;
          showEmotionPlan(`${plan.label}已在“${phrase}”开始生效 · 正用 ${plan.transitionBeats} 拍进入“${stage}”`);
        } else if (phase === 'motion') {
          $('#emotion-stage').textContent = stage;
          showEmotionPlan(`${plan.label}正在“${stage}”阶段 · 速度、织体和声部重心继续平滑演化`);
        }
      },
    });
    score.setVolume(Number(volumeSlider.value) / 100);
    score.setMuted(pendingMuted);
    score.setPerformanceControl(activeModel().snapshot);
    score.setLocked($('#hold-btn').getAttribute('aria-pressed') === 'true');
    score.setQuieter($('#quiet-btn').getAttribute('aria-pressed') === 'true');
    if (emotionSimulationActive) score.queueAdaptation(emotionPlan);
  }

  async function changeTrack(id) {
    const next = tracks.find((track) => track.id === id);
    if (!next || next === activeTrack || audioBusy) return;
    audioBusy = true;
    audition?.stop();
    hall?.resetFrames();
    musicSelect.disabled = true;
    scoreRail.clear();
    scoreStage.reset();
    currentProgramPhase = null;
    try {
      $('#player-status').textContent = '正在装入完整乐谱…';
      await window.ensureTrackPlan?.(id);
      if (score?.playing) await score.pause();
      if (score?.context?.close) await score.context.close();
      score = null;
      concertClock = null;
      activeTrack = next;
      albumTrace = []; albumTransport = []; albumSessionStartedAt = null; lastAlbumFrameAt = -Infinity;
      write(keys.track, next.id);
      showTrack();
      updatePlayback();
    } catch (error) {
      console.error(error);
      $('#player-status').textContent = `切换失败：${error.message || '未知错误'}`;
      playbackError = '乐谱加载失败，请重新选择唱片重试';
    } finally {
      audioBusy = false;
      musicSelect.disabled = false;
      updatePlayback();
    }
  }

  async function loadRecord(id) {
    const next = tracks.find((track) => track.id === id);
    if (!next || audioBusy) return false;
    const request = ++recordRequest;
    transport?.cancel();
    if (typingReplay) restoreTypingReplay();
    if (albumReplay) stopAlbumReplay('换片后已停止原轨迹演绎');
    recordBusy = true;
    playbackError = '';
    updatePlayback();
    try {
      await window.ensureTrackPlan?.(id);
      if (request !== recordRequest) return false;
      if (score?.playing) await score.pause();
      if (loadedTrackId && loadedTrackId !== id
        && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        turntable.stage.classList.add('is-ejecting');
        await vinylLibrary.returnToFolder(tracks.find((track) => track.id === loadedTrackId));
      }
      if (request !== recordRequest) return false;
      await changeTrack(id);
      if (activeTrack !== next) return false;
      loadedTrackId = id;
      write(loadedTrackKey, id);
      turntable.setLoaded(next);
      vinylLibrary.setLoaded(id);
      showConcertClock(0, next.plan.estimatedDurationSeconds || 0);
      showVinylInfo();
      return true;
    } catch (error) {
      if (request !== recordRequest) return false;
      playbackError = '装载失败，请重新选择唱片';
      console.error(error);
      return false;
    } finally {
      if (request === recordRequest) {
        turntable.stage.classList.remove('is-ejecting');
        recordBusy = false;
        updatePlayback();
      }
    }
  }

  async function togglePlayback() {
    if (audioBusy || recordBusy || !loadedTrackId) return;
    if (transport?.session) return;
    if (albumReplay) stopAlbumReplay('已停止轨迹演绎');
    audition?.stop();
    hall?.resetFrames();
    if (score?.playing) {
      try { await score.pause(); recordTransport('pause'); } catch (error) { console.error(error); }
      updatePlayback();
      return;
    }
    audioBusy = true;
    guideMusic.stop();
    if (guideActive) {
      scoreRail.clear();
      scoreRail.travelTime = 6;
      scoreRail.setClock(() => Number(score?.context?.currentTime) || 0);
      $('#score-rail').dataset.clockSource = 'audio';
    }
    playbackError = '';
    playButton.disabled = true;
    $('#player-status').textContent = activeTrack.kind === 'concert' ? '乐团入场，准备音色…' : '准备管弦乐音色…';
    updatePlayback();
    try {
      await window.ensureTrackPlan?.(activeTrack.id);
      if (!score) makeScore();
      scoreRail.clear(); scoreRail.primeSeekWindow?.();
      await score.play();
      recordTransport('play');
    } catch (error) {
      console.error(error);
      $('#player-status').textContent = `播放失败：${error.message || '未知错误'}`;
      playbackError = '播放失败，请再落针一次';
      if (score?.context && !score.loaded) {
        await score.context.close().catch(() => {});
        score = null;
      }
    } finally {
      audioBusy = false;
      playButton.disabled = false;
      updatePlayback();
    }
  }

  function restoreTypingReplay() {
    if (!typingReplay) return;
    clearInterval(typingReplay.timer);
    score?.setLocked(typingReplay.originalLocked);
    holdButton.setAttribute('aria-pressed', String(typingReplay.originalLocked));
    holdButton.textContent = typingReplay.originalLocked ? '继续跟随' : '保持当前';
    editor.value = typingReplay.originalDraft;
    title.value = typingReplay.originalTitle;
    title.readOnly = false;
    focusSeconds = typingReplay.originalFocusSeconds;
    showFocusTime();
    previousText = editor.value;
    editor.readOnly = false;
    downloadButton.disabled = false;
    typingReplay = null;
    typingStartButton.textContent = '开始回放';
    typingResetButton.disabled = true;
    $('#typing-test-status').textContent = '已还原原草稿 · 可再次回放';
    $('#typing-test-progress').style.width = '0%';
    updateCount();
    updateDemoButtons();
    const snapshot = model.sample();
    score?.setPerformanceControl(snapshot);
    showForecast(snapshot);
    updatePlayback();
  }

  function updateTypingReplay() {
    if (!typingReplay || typingReplay.done) return;
    if (!score?.playing) {
      $('#showcase-stage').textContent = '唱针抬起 · 演示已暂停';
      return;
    }
    const frame = typingReplay.scenario.advanceTo(Math.max(0, (score.context.currentTime - typingReplay.audioStartedAt) * 1000));
    if (frame.typedCount !== typingReplay.displayedCount) {
      editor.value = frame.text;
      editor.scrollTop = editor.scrollHeight;
      typingReplay.displayedCount = frame.typedCount;
      updateCount();
    }
    if (frame.snapshot !== typingReplay.displayedSnapshot) {
      typingReplay.displayedSnapshot = frame.snapshot;
      score?.setPerformanceControl(frame.snapshot);
      showForecast(frame.snapshot);
    }
    $('#typing-test-progress').style.width = `${frame.typedCount / frame.total * 100}%`;
    $('#typing-test-status').textContent = `${frame.stage.label} · ${frame.typedCount} / ${frame.total} 字`;
    $('#showcase-stage').textContent = `${frame.stage.label} · ${frame.typedCount} / ${frame.total} 字`;
    $('#showcase-progress').value = frame.typedCount;
    if (frame.done) {
      clearInterval(typingReplay.timer);
      typingReplay.done = true;
      $('#typing-test-status').textContent = '回放完成 · 500 / 500 字 · 点击“停止并还原”返回草稿';
      $('#showcase-stage').textContent = '演出完成 · 500 字';
      updateDemoButtons();
    }
  }

  async function startTypingReplay() {
    if (typingReplayStarting) return;
    typingReplayStarting = true;
    updateDemoButtons();
    typingStartButton.disabled = true;
    $('#typing-test-status').textContent = '正在准备音乐与测试文字…';
    let originalLocked = null;
    try {
      if (typingReplay) restoreTypingReplay();
      stopAlbumReplay();
      if (!loadedTrackId) await loadRecord('original-novel-suite-v1');
      if (!score?.playing) await togglePlayback();
      if (!score?.playing) {
        $('#typing-test-status').textContent = '音乐未能启动，请检查播放器后重试';
        return;
      }
      const scenario = new TypingScenario();
      originalLocked = score.locked;
      score.setLocked(false);
      holdButton.setAttribute('aria-pressed', 'false');
      holdButton.textContent = '保持当前';
      score.setPerformanceControl(scenario.snapshot);
      await score.restart();
      clearTimeout(saveTimer);
      saveDraft();
      model.setDemoMode(null);
      typingReplay = { scenario, originalDraft: editor.value, originalTitle: title.value, originalFocusSeconds: focusSeconds,
        originalLocked, audioStartedAt: score.context.currentTime, displayedCount: 0,
        displayedSnapshot: scenario.snapshot, done: false, timer: null };
      editor.value = '';
      title.value = '雨停后的车站';
      title.readOnly = true;
      editor.readOnly = true;
      downloadButton.disabled = true;
      typingResetButton.disabled = false;
      typingStartButton.textContent = '重新回放';
      updateCount();
      updateDemoButtons();
      onboarding?.update({ demo: true });
      showForecast(scenario.snapshot);
      typingReplay.timer = setInterval(updateTypingReplay, 80);
      updateTypingReplay();
    } catch (error) {
      console.error(error);
      if (!typingReplay && originalLocked !== null) {
        score?.setLocked(originalLocked);
        holdButton.setAttribute('aria-pressed', String(originalLocked));
        holdButton.textContent = originalLocked ? '继续跟随' : '保持当前';
      }
      restoreTypingReplay();
      $('#typing-test-status').textContent = `回放失败：${error.message || '未知错误'}`;
    } finally {
      typingReplayStarting = false;
      typingStartButton.disabled = false;
      updateDemoButtons();
    }
  }

  const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

  function setAlbumStatus(message, kind = '') {
    const status = $('#album-status');
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function showAlbumFingerprint(fingerprint) {
    $('#album-fingerprint').textContent = fingerprint
      ? `SHA-256 · ${SonataAlbumCodec.formatFingerprint(fingerprint)}` : '尚未导入或导出';
  }

  function conductorFrame(snapshot = activeModel().snapshot) {
    const emotion = emotionSnapshot.smoothed || {};
    const energy = round(snapshot?.energy ?? snapshot?.charge);
    const beat = score ? score.absoluteBarStartBeat(score.currentBar) : 0;
    const performance = score?.performanceAtBeat(beat);
    const mix = score?.currentGestureMix;
    return {
      at: 0,
      energy,
      charge: energy,
      level: round(snapshot?.level),
      trend: round(snapshot?.trend, 6),
      forecast: round(snapshot?.forecast),
      confidence: round(snapshot?.confidence),
      pauseSeconds: round(snapshot?.pauseSeconds, 2),
      narrativeMode: emotionPlan.mode || 'neutral',
      calmMode: Boolean(emotionPlan.calmMode),
      emotion: {
        valence: round(emotion.valence), arousal: round(emotion.arousal),
        tension: round(emotion.tension), confidence: round(emotionPlan.confidence),
      },
      music: {
        tempoScale: round(performance?.tempoScale ?? 1),
        dynamicDb: round(mix?.dynamicDb ?? 0, 2),
        densityBias: round(mix?.densityBias ?? 0),
        familyGainsDb: { ...(mix?.familyGainsDb || {}) },
      },
    };
  }

  function recordTransport(action) {
    if (typingReplay || albumReplay || albumReplayStarting || !score?.getPlaybackPosition) return;
    const now = performance.now();
    if (albumSessionStartedAt === null) albumSessionStartedAt = now;
    const position = score.getPlaybackPosition();
    albumTransport.push({ at: round((now - albumSessionStartedAt) / 1000, 3),
      action, seconds: position.seconds, playing: score.playing });
    if (albumTransport.length > 20000) albumTransport.shift();
  }

  function recordAlbumFrame(force = false, snapshot = activeModel().snapshot) {
    if (albumReplay || albumReplayStarting) return;
    const now = performance.now();
    if (albumSessionStartedAt === null) albumSessionStartedAt = now;
    const at = Math.max(0, (now - albumSessionStartedAt) / 1000);
    if (!force && at - lastAlbumFrameAt < 0.9) return;
    const frame = conductorFrame(snapshot);
    frame.at = round(at, 3);
    albumTrace.push(frame);
    if (albumTrace.length > 20_000) albumTrace.splice(0, albumTrace.length - 20_000);
    lastAlbumFrameAt = at;
  }

  function showFocusTime() {
    const minutes = Math.floor(focusSeconds / 60);
    const seconds = Math.floor(focusSeconds % 60);
    $('#focus-time').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function makeAlbumPayload() {
    recordAlbumFrame(true);
    return {
      schemaVersion: 'sonata-album/1.0',
      title: title.value.trim() || '未命名的故事',
      text: editor.value,
      trackId: activeTrack?.id || '',
      volume: Number(volumeSlider.value),
      focusSeconds: round(focusSeconds, 1),
      exportedAt: new Date().toISOString(),
      performance: {
        format: 'conductor-trace/2',
        durationSeconds: round(albumTrace.at(-1)?.at || 0, 2),
        transport: albumTransport.map(event => ({ ...event })),
        trace: albumTrace.map((frame) => ({ ...frame, emotion: { ...frame.emotion } })),
        preferences: {
          calmMode: calmEmotionMode,
          locked: Boolean(score?.locked),
          quieter: Boolean(score?.quieter),
        },
      },
    };
  }

  async function exportAlbum() {
    if (typingReplay) return;
    downloadButton.disabled = true;
    setAlbumStatus('正在保存文字与这场演奏…');
    try {
      const payload = makeAlbumPayload();
      const encoded = await SonataAlbumCodec.encode(payload);
      const blob = new Blob([encoded.text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${payload.title.replace(/[\\/:*?"<>|]/g, '_')}.sonata.txt`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 1000);
      importedAlbum = { payload, fingerprint: encoded.fingerprint };
      albumReplayButton.disabled = false;
      showAlbumFingerprint(encoded.fingerprint);
      setAlbumStatus('已保存文字与演奏轨迹 · 可以再次演绎', 'success');
      toast('已留存文字与这场演出');
    } catch (error) {
      console.error(error);
      setAlbumStatus(`导出失败：${error.message || '未知错误'}`, 'error');
      toast('留存失败，请重试');
    } finally {
      downloadButton.disabled = false;
    }
  }

  function stopAlbumReplay(message = '') {
    const replay = albumReplay;
    if (replay?.timer) clearInterval(replay.timer);
    albumReplay = null;
    if (replay?.payload) {
      albumTrace = replay.payload.performance.trace.map(frame => ({ ...frame }));
      albumTransport = (replay.payload.performance.transport || []).map(event => ({ ...event }));
      const duration = Math.max(Number(replay.payload.performance.durationSeconds) || 0,
        Number(albumTrace.at(-1)?.at) || 0, Number(albumTransport.at(-1)?.at) || 0);
      albumSessionStartedAt = performance.now() - duration * 1000;
      lastAlbumFrameAt = duration;
      recordTransport('seek');
    }
    albumReplayButton.textContent = '再次演绎';
    albumReplayButton.disabled = !importedAlbum;
    if (message) setAlbumStatus(message, 'success');
  }

  function applyAlbumFrame(frame) {
    const charge = clamp(frame.energy ?? frame.charge, 0, 1);
    score?.setPerformanceControl({
      format: 'typing-dynamics/2',
      energy: charge,
      charge,
      level: clamp(frame.level ?? charge, 0, 1),
      trend: Number(frame.trend) || 0,
      forecast: clamp(frame.forecast, 0, 1),
      confidence: clamp(frame.confidence, 0, 1),
      pauseSeconds: Math.max(0, Number(frame.pauseSeconds) || 0),
    });
    showForecast({
      format: 'typing-dynamics/2',
      energy: charge,
      charge,
      forecast: clamp(frame.forecast, 0, 1),
      confidence: clamp(frame.confidence, 0, 1),
      pauseSeconds: Math.max(0, Number(frame.pauseSeconds) || 0),
    });
    const emotion = {
      narrativeMode: typeof frame.narrativeMode === 'string' ? frame.narrativeMode : 'neutral',
      valence: clamp(frame.emotion?.valence, -1, 1),
      arousal: clamp(frame.emotion?.arousal, 0, 1),
      tension: clamp(frame.emotion?.tension, 0, 1),
      confidence: clamp(frame.emotion?.confidence, 0, 1),
    };
    const emotionKey = `${emotion.narrativeMode}:${round(emotion.valence, 2)}:${round(emotion.arousal, 2)}:${round(emotion.tension, 2)}:${Boolean(frame.calmMode)}`;
    if (albumReplay && emotionKey !== albumReplay.lastEmotionKey) {
      albumReplay.lastEmotionKey = emotionKey;
      emotionPlan = orchestrationPlanner.plan(emotion, { engagement: charge, calmMode: Boolean(frame.calmMode) });
      emotionSnapshot = {
        ...emotionSnapshot,
        observation: emotion,
        smoothed: { valence: emotion.valence, arousal: emotion.arousal, tension: emotion.tension },
        forecast: emotion,
      };
      score?.queueAdaptation(emotionPlan);
      showEmotionPlan(`数字专辑 · ${emotionPlan.label} · 等待乐句边界`);
    }
  }

  async function replayImportedAlbum() {
    if (albumReplayStarting) return;
    if (!importedAlbum || albumReplay) {
      if (albumReplay) stopAlbumReplay('已停止专辑演绎');
      return;
    }
    if (typingReplay) restoreTypingReplay();
    const { payload } = importedAlbum;
    albumReplayStarting = true;
    try {
    const availableTrack = tracks.some((track) => track.id === payload.trackId);
    if (availableTrack && !await loadRecord(payload.trackId)) throw new Error('专辑乐谱加载失败，请重试');
    if (!score?.playing) await togglePlayback();
    else await score.restart();
    if (!score?.playing) throw new Error('音乐未能启动，请先检查播放器');
    const trace = payload.performance.trace.length
      ? payload.performance.trace : [conductorFrame(model.snapshot)];
    albumReplay = { payload, trace, index: -1, audioStartedAt: score.context.currentTime, timer: null, lastEmotionKey: '' };
    albumReplayButton.textContent = '停止演绎';
    setAlbumStatus(`正在按原轨迹演绎 · 00:00 / ${formatClock(payload.performance.durationSeconds)}`);
    albumReplay.transport = payload.performance.transport || [];
    albumReplay.transportIndex = 0;
    albumReplay.wallStartedAt = performance.now();
    if (albumReplay.transport.length) await score.pause();
    const update = async () => {
      const replay = albumReplay;
      if (!replay || replay.updating) return;
      const elapsed = replay.transport.length ? (performance.now() - replay.wallStartedAt) / 1000
        : Math.max(0, score.context.currentTime - replay.audioStartedAt);
      if (!replay.transport.length && !score?.playing) return;
      replay.updating = true;
      try {
        while (replay.transportIndex < replay.transport.length && replay.transport[replay.transportIndex].at <= elapsed) {
          const event = replay.transport[replay.transportIndex++];
          scoreRail.clear(); scoreRail.primeSeekWindow?.(); hall?.resetFrames();
          await score.seekTo(event.seconds, { resume: event.playing });
          if (albumReplay !== replay) return;
          updatePlayback();
        }
      while (albumReplay.index + 1 < trace.length && Number(trace[albumReplay.index + 1].at) <= elapsed) {
        albumReplay.index += 1;
        applyAlbumFrame(trace[albumReplay.index]);
      }
      setAlbumStatus(`正在按原轨迹演绎 · ${formatClock(elapsed)} / ${formatClock(payload.performance.durationSeconds)}`);
      if (albumReplay.index >= trace.length - 1 && replay.transportIndex >= replay.transport.length && elapsed >= Number(trace.at(-1)?.at || 0)) {
        stopAlbumReplay('指挥轨迹回放完成 · 音乐会继续演奏');
      }
      } catch (error) { stopAlbumReplay(`演绎失败：${error.message}`); }
      finally { replay.updating = false; }
    };
    albumReplay.timer = setInterval(update, 180);
    update();
    } finally { albumReplayStarting = false; transport?.sync(); }
  }

  async function confirmReplacement(payload, heading = '换一本故事？') {
    const dialog = $('#import-confirm-dialog');
    dialog.returnValue = 'cancel';
    $('#import-confirm-title').textContent = heading;
    $('#import-preview').textContent = `${payload.title || '未命名的故事'} · ${length(payload.text.replace(/\s/g, ''))} 字`;
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'import'), { once: true });
      dialog.showModal();
    });
  }

  async function importAlbumFile(file) {
    if (!file) return;
    if (audioBusy || recordBusy || typingReplayStarting) throw new Error('播放器正在准备，请稍后导入');
    if (file.size > 8 * 1024 * 1024) throw new Error('专辑超过 8 MB，请选择较小文件');
    setAlbumStatus('正在校验数字指纹…');
    const decoded = await SonataAlbumCodec.decode(await file.text());
    const { payload } = decoded;
    if (editor.value.trim() && editor.value !== payload.text) {
      const accepted = await confirmReplacement(payload);
      if (!accepted) { setAlbumStatus('已取消导入 · 当前草稿保留'); return; }
    }
    // Commit the current draft before replacing it; the next save keeps it as recovery.
    if (!saveDraft()) throw new Error('当前草稿未能保存，请先留存后再导入');
    if (typingReplay) restoreTypingReplay();
    stopAlbumReplay();
    title.value = (payload.title || '未命名的故事').slice(0, 80);
    editor.value = payload.text;
    previousText = editor.value;
    focusSeconds = Math.max(0, Number(payload.focusSeconds) || 0);
    showFocusTime();
    applyVolume(payload.volume);
    const availableTrack = tracks.some((track) => track.id === payload.trackId);
    if (availableTrack && !await loadRecord(payload.trackId)) throw new Error('专辑乐谱加载失败，请重试');
    albumTransport = (payload.performance.transport || []).map(event => ({ ...event }));
    albumTrace = payload.performance.trace.map((frame) => ({ ...frame, emotion: { ...frame.emotion } }));
    albumSessionStartedAt = performance.now() - (Number(payload.performance.durationSeconds) || 0) * 1000;
    lastAlbumFrameAt = Number(albumTrace.at(-1)?.at || 0);
    importedAlbum = { payload, fingerprint: decoded.fingerprint };
    albumReplayButton.disabled = false;
    updateCount();
    saveDraft();
    showAlbumFingerprint(decoded.fingerprint);
    setAlbumStatus(availableTrack
      ? '文件校验通过 · 已恢复演奏轨迹'
      : '校验通过 · 原曲不在本机曲库，已保留当前曲目', 'success');
  }

  const initialDraft = draftStore.load();
  editor.value = initialDraft.text;
  title.value = initialDraft.title;
  focusSeconds = initialDraft.focusSeconds;
  showFocusTime();
  appShell.dataset.sandbox = String(sandbox);
  if (sandbox) $('#save-status').textContent = '演示空间 · 不写入草稿';
  if (initialDraft.recovered) toast('已从上一版恢复草稿，请留存备份');
  if (initialDraft.unavailable) {
    $('#save-status').textContent = '本机存储不可用，请留存文字';
    $('#save-status').dataset.state = 'error';
  }
  const storedVolume = Number(read(keys.volume, '62'));
  syncVolumeControls(Number.isFinite(storedVolume) ? clamp(storedVolume, 0, maxVolume) : 62);
  previousText = editor.value;
  if (loadedTrackId) {
    turntable.setLoaded(activeTrack);
    vinylLibrary.setLoaded(loadedTrackId);
  }
  updateCount();
  $('#draft-recovery-btn').disabled = !draftStore.previous();
  updateDemoButtons();
  showForecast(model.snapshot);
  showEmotionPlan();
  showTrack();
  hall = new ConcertHall({ onSelect: selectInstrument });
  audition = new InstrumentAudition({ onState(state) {
    hall.setAuditionState(state);
  } });
  buildOrchestraSeats();
  hall.showClock(0, loadedTrackId ? activeTrack.plan.estimatedDurationSeconds || 0 : 0);
  updatePlayback();
  setFace('front');
  onboarding = new FirstNotes({ editor, storage,
    onStart({ replay }) {
      if (typingReplay) restoreTypingReplay();
      if (albumReplay) stopAlbumReplay();
      setFace('front');
      if (replay) {
        saveDraft();
        guidePractice = { text: editor.value, title: title.value, focusSeconds, lastEditAt };
        editor.value = '';
        previousText = '';
        updateCount();
      }
      guideActive = true;
      guideMusic.setVolume(Number(volumeSlider.value) / 100);
      void guideMusic.preload();
      if (score?.playing) void score.pause().then(updatePlayback);
      vinylLibrary.setOpen?.(false);
      vinylLibrary.setTeaching?.(true);
      scoreRail.clear();
    },
    onFinish() {
      guideActive = false;
      guideMusic.stop();
      if (!score?.playing) scoreRail.clear();
      scoreRail.travelTime = 6;
      scoreRail.setClock(() => Number(score?.context?.currentTime) || 0);
      $('#score-rail').dataset.clockSource = 'audio';
      vinylLibrary.setOpen?.(false);
      vinylLibrary.setTeaching?.(false);
      if (guidePractice) {
        editor.value = guidePractice.text;
        title.value = guidePractice.title;
        focusSeconds = guidePractice.focusSeconds;
        lastEditAt = guidePractice.lastEditAt;
        guidePractice = null;
        previousText = editor.value;
        updateCount();
        showFocusTime();
      }
      saveDraft();
      appShell.classList.add('is-guide-arriving');
      setTimeout(() => appShell.classList.remove('is-guide-arriving'), 800);
      updateFrontPerformance();
    },
    openLibrary: () => vinylLibrary.setOpen?.(true),
    layoutLibrary: () => { if (!$('#record-library-panel').hidden) vinylLibrary.positionPanel?.(); },
    unlockAudio: () => {
      void guideMusic.unlock().then((ready) => {
        $('#guide-audio-btn').hidden = ready || !guideActive || guideMusic.state !== 'blocked';
        if (ready && onboarding?.active && onboarding.flow.stage.endsWith('-reward') && !guideMusic.audible) onboarding.flow.reward();
      });
    },
    onReward(stage, done) {
      const cancel = guideMusic.play(stage, () => { scoreRail.setPlaying(false); done(); });
      const generation = guideMusic.generation;
      return () => { if (generation === guideMusic.generation) { cancel(); scoreRail.clear(); } };
    },
  });
  updatePlayback();
  updateOrchestraMonitor();

  faceToggleButton.addEventListener('click', () => {
    setFace(appShell.dataset.face === 'front' ? 'back' : 'front');
  });
  $('#guide-restart-btn').addEventListener('click', () => setFace('front'));
  const timingModifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock',
    'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  const ignoreTimingKey = (event) => timingModifierKeys.has(event.key)
    || event.ctrlKey || event.metaKey || event.altKey;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appShell.dataset.face === 'back') {
      setFace('front');
      faceToggleButton.focus();
    }
  });
  editor.addEventListener('keydown', (event) => {
    onboarding?.key?.(event);
    if (!typingReplay && !guideActive) model.recordKeyDown({ repeat: event.repeat, ignored: ignoreTimingKey(event) });
  });
  editor.addEventListener('keyup', (event) => {
    onboarding?.keyUp?.();
    if (!typingReplay && !guideActive) model.recordKeyUp({ ignored: ignoreTimingKey(event) });
  });
  editor.addEventListener('compositionstart', () => {
    composing = true;
    if (onboarding) onboarding.composing = true;
    compositionBase = editor.value;
    clearTimeout(compositionTimer);
    compositionTimer = null;
  });
  editor.addEventListener('compositionend', (event) => {
    composing = false;
    compositionTimer = setTimeout(() => {
      const delta = length(editor.value) - length(compositionBase);
      if (onboarding) onboarding.composing = false;
      onboarding?.input?.({ text: editor.value, inserted: delta > 0 ? delta
        : editor.value !== compositionBase ? length(event.data || '') : 0, kind: 'insert' });
      if (delta > 0) recordInput(delta);
      else if (delta < 0) recordInput(Math.abs(delta), { deleted: true });
      previousText = editor.value;
      updateCount();
      queueSave();
      if (!guideActive) void analyzeLiveSemantic();
      compositionTimer = null;
    }, 0);
  });
  editor.addEventListener('input', handleTextInput);
  title.addEventListener('input', queueSave);
  playButton.addEventListener('click', togglePlayback);
  $('#hall-play').addEventListener('click', togglePlayback);
  $('#hall-return').addEventListener('click', () => setFace('front'));
  $('#hall-mute').addEventListener('click', () => $('#mute-btn').click());
  $('#tonearm-btn').addEventListener('click', togglePlayback);
  musicSelect.addEventListener('change', (event) => loadRecord(event.currentTarget.value));
  importButton.addEventListener('click', () => albumFileInput.click());
  $('#album-import-back-btn').addEventListener('click', () => albumFileInput.click());
  albumFileInput.addEventListener('change', () => {
    const [file] = albumFileInput.files || [];
    importAlbumFile(file).catch((error) => {
      console.error(error);
      setAlbumStatus(`导入失败：${error.message || '未知错误'}`, 'error');
    }).finally(() => { albumFileInput.value = ''; });
  });
  albumReplayButton.addEventListener('click', () => replayImportedAlbum().catch((error) => {
    console.error(error);
    stopAlbumReplay();
    setAlbumStatus(`演绎失败：${error.message || '未知错误'}`, 'error');
  }));
  typingStartButton.addEventListener('click', startTypingReplay);
  typingResetButton.addEventListener('click', restoreTypingReplay);
  $('#showcase-stop-btn').addEventListener('click', restoreTypingReplay);
  $('#draft-recovery-btn').addEventListener('click', async () => {
    const previous = draftStore.previous();
    if (!previous || typingReplay) return;
    if (!await confirmReplacement(previous, '恢复上一版？')) return;
    if (!saveDraft()) { toast('当前草稿未能保存，请先留存'); return; }
    stopAlbumReplay();
    title.value = previous.title;
    editor.value = previous.text;
    previousText = editor.value;
    focusSeconds = previous.focusSeconds;
    updateCount();
    showFocusTime();
    saveDraft();
    toast('已恢复上一版 · 可再次切回');
  });
  $('#showcase-btn').addEventListener('click', () => {
    if (typingReplay) { restoreTypingReplay(); return; }
    $('#showcase-dialog').showModal();
  });
  $('#showcase-start-btn').addEventListener('click', async () => {
    $('#showcase-dialog').close();
    setFace('front');
    await startTypingReplay();
    if (!typingReplay) toast('演示未能启动，请检查唱片后重试');
  });
  $('#typing-baseline-reset').addEventListener('click', () => {
    model.resetBaseline();
    showForecast(model.sample());
    $('#typing-baseline-status').textContent = '已重置 · 正在重新学习';
  });

  $('#mute-btn').addEventListener('click', () => {
    if (!score) makeScore();
    pendingMuted = !(score?.muted ?? pendingMuted);
    score?.setMuted(pendingMuted);
    audition.configure({ muted: pendingMuted });
    updatePlayback();
  });
  volumeSlider.addEventListener('input', () => {
    applyVolume(volumeSlider.value);
  });
  $('#hall-volume').value = volumeSlider.value;
  $('#hall-volume').addEventListener('input', (event) => {
    volumeSlider.value = event.currentTarget.value;
    volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#vinyl-volume').value = volumeSlider.value;
  $('#vinyl-volume').addEventListener('input', (event) => {
    volumeSlider.value = event.currentTarget.value;
    volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#hold-btn').addEventListener('click', (event) => {
    const pressed = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(pressed));
    event.currentTarget.textContent = pressed ? '继续跟随' : '保持当前';
    score?.setLocked(pressed);
  });
  $('#quiet-btn').addEventListener('click', (event) => {
    const pressed = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(pressed));
    event.currentTarget.textContent = pressed ? '恢复音量' : '更安静';
    score?.setQuieter(pressed);
  });

  for (const button of document.querySelectorAll('[data-demo]')) {
    button.addEventListener('click', () => {
      if (typingReplay) restoreTypingReplay();
      model.setDemoMode(button.dataset.demo === 'off' ? null : button.dataset.demo);
      updateDemoButtons();
      showForecast(model.sample());
      score?.setPerformanceControl(model.snapshot);
    });
  }

  for (const button of document.querySelectorAll('[data-emotion]')) {
    button.addEventListener('click', () => simulateEmotion(button.dataset.emotion).catch((error) => {
      console.error(error);
      $('#emotion-status').textContent = `模拟失败：${error.message || '未知错误'}`;
    }));
  }
  $('#live-semantic-toggle').addEventListener('change', (event) => {
    liveSemanticEnabled = Boolean(event.currentTarget.checked);
    liveSemanticProvider.enabled = liveSemanticEnabled;
    $('#privacy-mode').textContent = liveSemanticEnabled ? '最近段落 · 按需分析' : '仅在本机';
    if (!liveSemanticEnabled) {
      $('#emotion-status').textContent = '实时分析已关闭 · 正文不再发送，本地 Mock 仍可用';
      return;
    }
    firstLiveSemanticAnalysis = true;
    semanticController.textWindow.lastAnalyzedText = '';
    semanticController.textWindow.lastAnalyzedAt = Number.NEGATIVE_INFINITY;
    $('#emotion-status').textContent = '实时分析已开启 · 正在检查最近完整段落';
    void analyzeLiveSemantic({ paragraphCompleted: true, announceHeld: true });
  });
  $('#calm-emotion-btn').addEventListener('click', () => {
    calmEmotionMode = !calmEmotionMode;
    $('#calm-emotion-btn').setAttribute('aria-pressed', String(calmEmotionMode));
    if (!emotionSimulationActive) {
      $('#emotion-status').textContent = calmEmotionMode
        ? '平静限制已开启 · 选择一种情绪开始测试' : '平静限制已关闭 · 尚未改变演奏';
      return;
    }
    emotionPlan = orchestrationPlanner.plan(emotionSnapshot.forecast,
      { engagement: activeModel().snapshot.energy ?? activeModel().snapshot.charge,
        calmMode: calmEmotionMode });
    $('#emotion-stage').textContent = '等待生效';
    $('#emotion-actual').textContent = '等待乐句边界';
    if (!score) makeScore();
    else score.queueAdaptation(emotionPlan);
    showEmotionPlan(`${calmEmotionMode ? '平静限制已开启' : '完整情绪范围已恢复'} · 新计划等待下一乐句`);
  });

  downloadButton.addEventListener('click', exportAlbum);
  $('#album-export-back-btn').addEventListener('click', exportAlbum);

  setInterval(() => {
    if (typingReplay || albumReplay || albumReplayStarting || guideActive) return;
    const snapshot = model.sample();
    score?.setPerformanceControl(snapshot);
    showForecast(snapshot);
    if (lastEditAt || score?.playing) recordAlbumFrame(false, snapshot);
    if (appShell.dataset.face === 'back') hall.showReview(albumTrace, title.value, length(editor.value));
  }, 1000);
  setInterval(() => {
    const now = Date.now();
    const elapsed = Math.min(2, Math.max(0, (now - lastClockAt) / 1000));
    if (!document.hidden && (score?.playing || (lastEditAt && now - lastEditAt < 5 * 60 * 1000))) {
      focusSeconds += elapsed;
      showFocusTime();
    }
    lastClockAt = now;
    if (score?.playing) $('#bpm-display').textContent = `${score.currentBpm().toFixed(1)} BPM`;
    if (score?.getPlaybackPosition && !transport?.session) {
      const position = score.getPlaybackPosition();
      showConcertClock(position.seconds, position.remainingSeconds);
    }
  }, 1000);
  if (window.RecordTransport) {
    transport = new RecordTransport({
      status: $('#seek-status'),
      state: () => {
        const position = score?.getPlaybackPosition?.();
        return { seconds: position?.seconds || 0,
          durationSeconds: position?.durationSeconds || activeTrack?.plan?.estimatedDurationSeconds || 0,
          playing: Boolean(score?.playing), trackId: loadedTrackId,
          program: activeTrack?.plan?.program?.items,
          disabled: !loadedTrackId || audioBusy || recordBusy || Boolean(typingReplay || typingReplayStarting || albumReplay || albumReplayStarting),
          reason: albumReplay || albumReplayStarting ? '停止演绎后可调整进度' : typingReplay || typingReplayStarting ? '演示期间暂不调整进度' : '' };
      },
      begin: async animate => {
        guideMusic.stop(); audition?.stop();
        scoreRail.dissolve?.({ animate }); hall?.resetFrames();
        if (score?.playing) await score.pause();
      },
      commit: async (seconds, resume, trackId) => {
        if (recordBusy || loadedTrackId !== trackId) return;
        if (!score) { await window.ensureTrackPlan?.(trackId); if (loadedTrackId !== trackId) return; makeScore(); }
        scoreRail.clear(); scoreRail.primeSeekWindow?.();
        scoreRail.setClock(() => Number(score?.context?.currentTime) || 0);
        hall?.resetFrames();
        await score.seekTo(seconds, { resume });
        recordTransport('seek');
        updatePlayback();
      },
      render: (seconds, remaining) => {
        concertClock = { elapsed: seconds, remaining, updatedAt: Date.now() };
        showConcertClock(seconds, remaining);
        if (score?.getPlaybackPosition && !transport?.session) {
          const position = score.getPlaybackPosition();
          const item = position.item;
          if (activeTrack.kind === 'concert' && !position.completed) {
            $('#program-position').textContent = item ? `乐章 ${item.position} / ${item.total}` : '乐章间呼吸';
            $('#program-title').textContent = item?.label || '下一乐章即将开始';
            $('#vinyl-program-position').textContent = $('#program-position').textContent;
          }
        }
      },
    });
    transport.sync();
    setInterval(() => transport.sync(), 100);
  }
  setInterval(updateOrchestraMonitor, 600);
  document.addEventListener?.('visibilitychange', () => {
    model.setVisibility(document.hidden);
    if (document.hidden) saveDraft();
    if (document.hidden) audition?.stop();
  });
  window.addEventListener('pagehide', () => { void audition?.dispose(); });
  window.addEventListener('pagehide', saveDraft);
  window.addEventListener('beforeunload', saveDraft);
  void checkSemanticService();
})();

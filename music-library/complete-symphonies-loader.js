(function (global) {
  'use strict';
  const library = global.PLAYABLE_MUSIC_LIBRARY;
  const pending = new Map();
  const loaded = global.COMPLETE_SYMPHONY_PLANS ||= {};
  const metadataById = new Map();
  const concertWorks = new Map();
  const artRoot = './assets/images/vinyl-player/';
  for (const track of library.filter(track => track.id.endsWith('-focus'))) {
    track.libraryGroup = '写作选段';
    track.composerLabel += ' · 选段';
  }
  function summary(work, movements) {
    let seconds = 0, beats = 0, bars = 0;
    const items = movements.map((plan, i) => {
      const item = { id: plan.id, title: plan.movement, label: plan.movement, position: i + 1,
        total: movements.length, startBar: bars + 1, startBeat: beats, startSecond: seconds };
      bars += plan.totalBars; beats += plan.totalBeats; seconds += plan.estimatedDurationSeconds;
      Object.assign(item, { endBar: bars, endBeat: beats, endSecond: seconds, durationSeconds: plan.estimatedDurationSeconds });
      const gap = work.gaps[i] || 0;
      if (gap) { seconds += gap; beats += gap; bars += 1; }
      return item;
    });
    return { id: `${work.id}-complete`, title: work.title, composer: work.composer,
      totalBars: bars, totalBeats: beats, estimatedDurationSeconds: seconds,
      baseTempoBpm: movements[0].baseTempoBpm, repeat: false,
      program: { title: `${work.title} · 完整作品`, itemCount: items.length, items, intermissions: [] } };
  }
  for (const work of global.COMPLETE_SYMPHONIES || []) {
    const artwork = { src: artRoot + work.image, dominantColor: work.color, alt: `${work.title}封面`,
      catalogNumber: work.code, creator: work.prefix.startsWith('mozart') ? '本项目排版' : '原曲库封面',
      license: work.prefix.startsWith('mozart') ? '项目原创' : '见原曲库来源记录' };
    const rights = `${work.movements[0].editionLabel} · 项目采样实时演奏`;
    const concert = { id: `${work.id}-complete`, label: `${work.title} · 完整作品`, shortTitle: work.title,
      composerLabel: work.composer, kind: 'concert', libraryGroup: '完整音乐会', artwork, rights,
      plan: summary(work, work.movements), lazy: true,
      description: `${work.movements.length} 个完整乐章。${work.movements.map((m, i) => `${i + 1}. ${m.movement.replace(/^第 \d+ 乐章 · /, '')}`).join('；')}。${work.prefix === 'beethoven-6' ? '第三至第五乐章连续演出。' : '乐章间保留 8 秒呼吸。'}` };
    concertWorks.set(concert.id, work);
    library.push(concert);
    for (const plan of work.movements) {
      metadataById.set(plan.id, plan);
      library.push({ id: plan.id, label: `${work.title} · ${plan.movement}`, shortTitle: plan.movement,
        composerLabel: work.composer, kind: 'piece', libraryGroup: `${work.title} · 完整乐章`,
        artwork, rights, plan, lazy: true, description: `${plan.movement}，完整乐章，约 ${Math.round(plan.estimatedDurationSeconds / 60)} 分钟。` });
    }
  }
  for (const track of global.PATHETIQUE_MOVEMENT_TRACKS || []) {
    const parent = library.find(item => item.plan?.program?.items.some(m => m.id === track.id));
    if (parent && !library.some(item => item.id === track.id)) library.push({ ...track,
      artwork: parent.artwork, composerLabel: parent.composerLabel, kind: 'piece' });
  }
  for (const album of library.filter(track => track.kind === 'concert')) {
    album.movementIds = album.plan.program.items.map(item => item.id);
    for (const id of album.movementIds) {
      const movement = library.find(track => track.id === id);
      if (movement) { movement.albumId = album.id; movement.plan.repeat = false; }
    }
  }
  // Full works precede individual movements; keep the existing default concert first.
  library.sort((a, b) => Number(b.kind === 'concert') - Number(a.kind === 'concert'));
  function loadMovement(id) {
    if (loaded[id]) return Promise.resolve(loaded[id]);
    if (pending.has(id)) return pending.get(id);
    if (!metadataById.has(id)) return Promise.reject(new Error('曲目不存在'));
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `./music-library/playable/${id}.inline.js`;
      let timer;
      const finish = (error) => {
        clearTimeout(timer); script.remove();
        if (error) reject(error);
        else if (loaded[id]?.events?.length) resolve(loaded[id]);
        else reject(new Error('乐谱内容不完整'));
      };
      script.onload = () => finish();
      script.onerror = () => finish(new Error('乐谱加载失败，请重试'));
      timer = setTimeout(() => finish(new Error('乐谱加载超时，请重试')), 30000);
      document.head.append(script);
    }).finally(() => pending.delete(id));
    pending.set(id, promise);
    return promise;
  }
  global.ensureTrackPlan = async function ensureTrackPlan(id) {
    const track = library.find(track => track.id === id);
    if (!track) throw new Error('曲目不存在');
    if (track.plan?.events?.length) return track.plan;
    const work = concertWorks.get(id);
    let plan;
    if (work) {
      const movements = [];
      // Bound script parsing and allocation; movement cache is shared with single-track playback.
      for (const meta of work.movements) movements.push({ id: meta.id, label: meta.movement,
        shortTitle: meta.movement, plan: await loadMovement(meta.id) });
      plan = global.buildConcertPlan(id, work.title, movements, { transitionSecondsByBoundary: work.gaps,
        programMeta: { format: 'complete-symphony', provenance: '公开数字总谱 · 项目实时演奏' } });
      plan.sectionNames.score = '原谱演奏';
      plan.ensemble.sourceParts = Math.max(...movements.map(m => m.plan.ensemble.sourceParts));
    } else plan = await loadMovement(id);
    track.plan = plan;
    return plan;
  };
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
  'use strict';

  const publicDomainTrack = (id, label, shortTitle, plan, rights = 'OpenScore Orchestra CC0') => ({
    id, label, shortTitle, plan, kind: 'piece',
    rights: `公版作品 · ${rights} · VSCO 2 CE CC0 音色`,
    description: `${plan.movement}，当前版本 ${plan.totalBars} 小节，约 ${Math.round(plan.estimatedDurationSeconds / 6) / 10} 分钟。浏览器按原谱音高、节奏、移调、力度和基本奏法实时调度管弦乐采样。`,
  });

  const original = {
    id: 'original-novel-suite-v1', label: '原创 · 小说写作交响序曲', shortTitle: '小说序曲',
    kind: 'piece', plan: global.ORCHESTRA_PERFORMANCE,
    rights: '项目原创 · VSCO 2 CE CC0 音色',
    description: '32 小节原创中型交响乐团序曲，以 80 人编制为目标，由 15 条可独立调度的弦乐、木管、铜管、打击乐与竖琴声部构成。',
  };
  if (!Number.isFinite(original.plan.estimatedDurationSeconds)) {
    original.plan.estimatedDurationSeconds = original.plan.totalBars * 4 * 60 / original.plan.baseTempoBpm;
  }
  const pathetique = publicDomainTrack('tchaikovsky-symphony-6-op74-m1-focus',
    '柴可夫斯基 · 第六交响曲《悲怆》I', '《悲怆》第一乐章',
    global.ORCHESTRA_PATHETIQUE_M1, 'MCTL 数据集 MIT');
  pathetique.description = '第一乐章第 1–100 小节，约 4 分 34 秒。保留 21 个原始总谱声部的音高、节奏、速度、力度、连音与基础奏法，结尾停在第 101 小节快板回归之前。';

  const beethoven = [
    publicDomainTrack('beethoven-symphony-1-op21-m2-focus', '贝多芬 · 第一交响曲 II',
      '第一交响曲 II', global.ORCHESTRA_BEETHOVEN_SYMPHONY_1_OP21_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-2-op36-m2-focus', '贝多芬 · 第二交响曲 II',
      '第二交响曲 II', global.ORCHESTRA_BEETHOVEN_SYMPHONY_2_OP36_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-3-op55-m2-focus', '贝多芬 · 第三交响曲《英雄》II',
      '《英雄》第二乐章', global.ORCHESTRA_BEETHOVEN_SYMPHONY_3_OP55_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-4-op60-m2-focus', '贝多芬 · 第四交响曲 II',
      '第四交响曲 II', global.ORCHESTRA_BEETHOVEN_SYMPHONY_4_OP60_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-5-op67-m2-focus', '贝多芬 · 第五交响曲 II',
      '第五交响曲 II', global.ORCHESTRA_BEETHOVEN_SYMPHONY_5_OP67_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-6-op68-m2-focus', '贝多芬 · 第六交响曲《田园》II',
      '《田园》第二乐章', global.ORCHESTRA_BEETHOVEN_SYMPHONY_6_OP68_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-7-op92-m2-focus', '贝多芬 · 第七交响曲 II',
      '第七交响曲 II', global.ORCHESTRA_BEETHOVEN_SYMPHONY_7_OP92_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-8-op93-m2-focus', '贝多芬 · 第八交响曲 II',
      '第八交响曲 II', global.ORCHESTRA_BEETHOVEN_SYMPHONY_8_OP93_M2_FOCUS),
    publicDomainTrack('beethoven-symphony-9-op125-m3-focus', '贝多芬 · 第九交响曲 III',
      '第九交响曲 III', global.ORCHESTRA_BEETHOVEN_SYMPHONY_9_OP125_M3_FOCUS),
  ];

  function buildConcertPlan(id, title, tracks, options = {}) {
    const transitionSeconds = options.transitionSeconds ?? 4;
    const bars = [];
    const phrases = [];
    const tempoMap = [];
    const events = [];
    const items = [];
    const intermissions = [];
    let beatOffset = 0;
    let barOffset = 0;
    let secondOffset = 0;

    tracks.forEach((track, trackIndex) => {
      const source = track.plan;
      const startBar = barOffset + 1;
      const startBeat = beatOffset;
      const startSecond = secondOffset;
      const sourceBars = source.bars || Array.from({ length: source.totalBars }, (_, index) => ({
        number: index + 1, startBeat: index * 4, durationBeats: 4,
      }));
      for (const bar of sourceBars) {
        bars.push({ ...bar, number: bars.length + 1, sourceNumber: bar.sourceNumber ?? bar.number,
          startBeat: bar.startBeat + beatOffset });
      }
      for (const phrase of source.phrases) {
        const firstBar = phrase.bars?.[0] ?? phrase.startBar;
        const lastBar = phrase.bars?.[1] ?? phrase.endBar;
        phrases.push({ ...phrase, id: `${track.id}:${phrase.id}`,
          ...(phrase.permissionMask ? { permissionMask: { ...phrase.permissionMask, phraseId: `${track.id}:${phrase.id}` } } : {}),
          bars: [firstBar + barOffset, lastBar + barOffset],
          startBeat: (phrase.startBeat ?? (firstBar - 1) * 4) + beatOffset,
          endBeat: (phrase.endBeat ?? lastBar * 4) + beatOffset });
      }
      const sourceTempo = source.tempoMap?.length
        ? source.tempoMap : [{ beat: 0, bpm: source.baseTempoBpm, transitionBeats: 0 }];
      for (const point of sourceTempo) tempoMap.push({ ...point, beat: point.beat + beatOffset });
      for (const event of source.events) events.push({ ...event,
        phrase: `${track.id}:${event.phrase}`, bar: event.bar + barOffset, beat: event.beat + beatOffset });

      beatOffset += source.totalBeats || source.totalBars * 4;
      barOffset += source.totalBars;
      secondOffset += source.estimatedDurationSeconds || 0;
      items.push({ id: track.id, title: track.shortTitle, label: track.label,
        position: trackIndex + 1, total: tracks.length, startBar, endBar: barOffset,
        startBeat, endBeat: beatOffset, startSecond,
        endSecond: secondOffset, durationSeconds: source.estimatedDurationSeconds || 0 });

      const gapSeconds = options.transitionSecondsByBoundary?.[trackIndex] ?? transitionSeconds;
      if (trackIndex < tracks.length - 1 && gapSeconds > 0) {
        const intermissionStartBar = barOffset + 1;
        bars.push({ number: intermissionStartBar, sourceNumber: '乐章间呼吸', startBeat: beatOffset,
          durationBeats: gapSeconds, meter: `${gapSeconds}/4` });
        phrases.push({ id: `intermission-${trackIndex + 1}`, section: 'intermission',
          function: `第 ${trackIndex + 1} 乐章结束 · 乐团呼吸`, bars: [intermissionStartBar, intermissionStartBar],
          startBeat: beatOffset, endBeat: beatOffset + gapSeconds,
          dynamicArc: [[0, 0], [1, 0]], tempoArc: [[0, 1], [1, 1]], accents: [] });
        tempoMap.push({ beat: beatOffset, bpm: 60, transitionBeats: 0 });
        intermissions.push({ startBar: intermissionStartBar, endBar: intermissionStartBar,
          startSecond: secondOffset, endSecond: secondOffset + gapSeconds });
        beatOffset += gapSeconds;
        barOffset += 1;
        secondOffset += gapSeconds;
      }
    });

    return {
      schemaVersion: '2.0', id, title, composer: tracks[0]?.plan?.composer || '交响专注音乐会',
      movement: `${tracks.length} 个完整乐章`,
      baseTempoBpm: tempoMap[0].bpm, tempoMap, totalBars: bars.length,
      totalBeats: beatOffset, estimatedDurationSeconds: secondOffset, bars, phrases, events,
      repeat: false,
      sectionNames: { introduction: '序奏', exposition: '铺陈', development: '发展',
        transition: '过渡', secondary: '抒情段', return: '回归', coda: '尾声', intermission: '换场' },
      interactionPolicy: { maxTempoOffsetBpm: 5, maxDynamicOffsetDb: 3,
        decisionWindowSeconds: 20, applicationRampSeconds: 24 },
      ensemble: { targetPlayers: 80, sourceParts: 21 },
      rights: { composition: 'public-domain-program',
        rendering: 'project render with VSCO 2 CE CC0 samples' },
      program: { title, itemCount: tracks.length, items, intermissions, ...options.programMeta },
    };
  }

  const pathetiqueMovements = [
    publicDomainTrack('tchaikovsky-symphony-6-op74-m1-full',
      'I. Adagio—Allegro non troppo', '第一乐章', global.ORCHESTRA_PATHETIQUE_M1_FULL,
      'MCTL S3 数据集 MIT'),
    publicDomainTrack('tchaikovsky-symphony-6-op74-m2-full',
      'II. Allegro con grazia', '第二乐章', global.ORCHESTRA_PATHETIQUE_M2_FULL,
      'MCTL S3 数据集 MIT'),
    publicDomainTrack('tchaikovsky-symphony-6-op74-m3-full',
      'III. Allegro molto vivace', '第三乐章', global.ORCHESTRA_PATHETIQUE_M3_FULL,
      'MCTL S3 数据集 MIT'),
    publicDomainTrack('tchaikovsky-symphony-6-op74-m4-full',
      'IV. Adagio lamentoso', '第四乐章', global.ORCHESTRA_PATHETIQUE_M4_FULL,
      'MCTL S3 数据集 MIT'),
  ];
  const concertPlan = buildConcertPlan(
    'pathetique-complete-concert-41',
    '柴可夫斯基《悲怆》完整交响音乐会',
    pathetiqueMovements,
    {
      transitionSeconds: 8,
      programMeta: {
        format: 'complete-symphony',
        sourceConcertId: 'concertgebouw-essentials-pathetique-2025',
        provenance: '实际音乐会曲目复刻；完整四乐章，乐章间仅保留自然呼吸',
      },
    },
  );
  const concert = {
    id: concertPlan.id, label: '41 分钟 · 柴可夫斯基《悲怆》完整音乐会', shortTitle: '《悲怆》完整音乐会',
    kind: 'concert', plan: concertPlan,
    rights: '柴可夫斯基公版作品 · MCTL S3 MIT 数字总谱 · VSCO 2 CE CC0 音色',
    description: '按照真实音乐会的“完整交响曲”形式连续演出《悲怆》四个完整乐章，约 40 分 52 秒。乐章内部不剪切、不重排，乐章间保留 8 秒自然呼吸；终乐章结束后谢幕而不循环。',
  };

  const artRoot = './assets/images/vinyl-player/';
  const commons = 'https://commons.wikimedia.org/wiki/File:';
  const cover = (file, color, alt, sourceUrl, creator, license) => ({
    src: `${artRoot}${file}`, dominantColor: color, alt, sourceUrl, creator, license,
  });
  concert.artwork = cover('source-tchaikovsky.jpg', '#9d6a5d', '柴可夫斯基肖像',
    `${commons}Portret_van_Pyotr_Ilyich_Tchaikovsky,_RP-F-F00667-AE.jpg`, 'Rijksmuseum', 'CC0');
  concert.artwork.catalogNumber = 'T/00';
  concert.composerLabel = '柴可夫斯基 · 四乐章音乐会';
  concert.libraryGroup = '完整音乐会';
  original.artwork = cover('cover-original-v1.png', '#76979b', '原创交响序曲抽象封面',
    '', 'ImageGen · 本项目原创', '项目原创');
  original.artwork.catalogNumber = 'S/01';
  original.composerLabel = '原创 · 小说写作交响序曲';
  original.libraryGroup = '单曲试听';
  pathetique.artwork = cover('source-tchaikovsky.jpg', '#846b99', '柴可夫斯基肖像',
    `${commons}Portret_van_Pyotr_Ilyich_Tchaikovsky,_RP-F-F00667-AE.jpg`, 'Rijksmuseum', 'CC0');
  pathetique.artwork.catalogNumber = 'T/01';
  pathetique.composerLabel = '柴可夫斯基 · 第六交响曲';
  pathetique.libraryGroup = '单曲试听';
  const beethovenArt = [
    ['source-beethoven.jpg', '#a58773', '贝多芬肖像', 'Beethoven.jpg'],
    ['source-wanderer.jpg', '#778b9a', '弗里德里希《雾海上的旅人》', 'Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg'],
    ['source-eroica.jpg', '#9f7569', '《英雄》交响曲手稿扉页', 'Eroica_Beethoven_title.jpg'],
    ['source-beethoven.jpg', '#838a72', '贝多芬肖像', 'Beethoven.jpg'],
    ['source-beethoven-5.jpg', '#a97965', '贝多芬第五交响曲手稿', 'BeethovenSinfonia5autografo.jpg'],
    ['source-pastoral.jpg', '#95a68d', '弗里德里希《北方风景·春》', 'Caspar_David_Friedrich,_Northern_Landscape,_Spring,_c._1825,_NGA_130555.jpg'],
    ['source-wanderer.jpg', '#8e82a0', '弗里德里希《雾海上的旅人》', 'Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg'],
    ['source-beethoven.jpg', '#9b8b76', '贝多芬肖像', 'Beethoven.jpg'],
    ['source-beethoven-9.jpg', '#7b879c', '贝多芬第九交响曲手稿', 'Beethoven_ninth_symphony_manuscript.jpg'],
  ];
  beethoven.forEach((track, index) => {
    const [file, color, alt, source] = beethovenArt[index];
    const landscape = file === 'source-pastoral.jpg' || file === 'source-wanderer.jpg';
    const creator = landscape ? 'Caspar David Friedrich' : file === 'source-beethoven.jpg'
      ? '肖像作者见来源页面' : 'Ludwig van Beethoven';
    track.artwork = cover(file, color, alt, `${commons}${source}`, creator,
      file === 'source-pastoral.jpg' ? 'CC0' : 'Public domain');
    track.artwork.catalogNumber = `B/${String(index + 1).padStart(2, '0')}`;
    track.composerLabel = `贝多芬 · 第${['一','二','三','四','五','六','七','八','九'][index]}交响曲`;
    track.libraryGroup = '单曲试听';
  });
  global.PATHETIQUE_MOVEMENT_TRACKS = pathetiqueMovements;
  global.ORCHESTRA_FOCUS_CONCERT = concertPlan;
  global.buildConcertPlan = buildConcertPlan;
  global.PLAYABLE_MUSIC_LIBRARY = [concert, original, pathetique, ...beethoven]
    .filter((track) => track.plan?.events?.length);
})(typeof window !== 'undefined' ? window : globalThis);

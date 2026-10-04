(function (global) {
  'use strict';

  const families = {
    strings: { label: '弦乐组', members: ['violin1', 'violin2', 'viola', 'cello', 'doubleBass'] },
    woodwinds: { label: '木管组', members: ['flute', 'oboe', 'clarinet', 'bassoon'] },
    brass: { label: '铜管组', members: ['horn', 'trumpet', 'trombone', 'tuba'] },
    percussion: { label: '打击乐组', members: ['timpani', 'bassDrum', 'cymbal', 'tamTam'] },
    color: { label: '色彩乐器', members: ['harp'] },
  };
  const strings = [['琴弓', '弓毛摩擦琴弦，也可以用手指拨弦。'], ['琴弦', '振动产生声音，按弦改变音高。'], ['琴身', '琴桥传递振动，共鸣箱让声音更丰满。']];
  const doubleReed = [['双簧哨片', '两片簧片随气流一起振动。'], ['管身', '管内空气共鸣，赋予声音独特的质感。'], ['音孔与按键', '开合音孔，改变空气柱的有效长度。']];
  const brass = [['号嘴', '嘴唇在号嘴内振动，激起管内空气。'], ['管身', '空气柱共鸣，管子越长，基础音区越低。'], ['喇叭口', '帮助声音向外辐射。']];
  const guide = {};
  function add(id, name, asset, family, timbre, role, together, midi, parts, note = '') {
    guide[id] = { id, name, asset, family, timbre, role, together, midi, parts, note,
      articulation: family === 'percussion' ? 'strike' : id === 'harp' ? 'pluck' : 'sustain' };
  }
  add('violin1', '第一小提琴', 'violin.png', 'strings', '明亮 · 灵巧 · 歌唱感', '常带领旋律，也能编织细密的伴奏。', '与第二小提琴呼应，由中低弦乐托住和声。', 67, strings, '第一、第二小提琴是同一种乐器，区别主要在声部与演奏分工。');
  add('violin2', '第二小提琴', 'violin.png', 'strings', '明亮 · 灵巧 · 歌唱感', '常提供和声、节奏与对答，也会接过旋律。', '与第一小提琴交织，让弦乐的层次更丰富。', 67, strings, '两组小提琴共用同一种持续音采样；你听到的区别来自配器与奏法。');
  add('viola', '中提琴', 'viola.png', 'strings', '温润 · 内敛 · 略带沙哑', '连接高低声部，填充和声的中间层。', '把小提琴的亮与大提琴的深连在一起。', 60, strings);
  add('cello', '大提琴', 'cello.png', 'strings', '温暖 · 厚实 · 歌唱感', '托住低声部，也能独自唱出旋律。', '与低音提琴建立底座，与中提琴衔接和声。', 48, strings);
  add('doubleBass', '低音提琴', 'double-bass.png', 'strings', '深沉 · 宽厚 · 有重量', '稳住低音和节奏，让整个乐团有落脚点。', '常与大提琴一起支撑，也与低音管乐呼应。', 33, strings);
  add('flute', '长笛', 'flute.png', 'woodwinds', '清亮 · 轻盈 · 通透', '唱出高音旋律，为乐句带来空气与亮光。', '与弦乐叠出亮色，也与其他木管交换旋律。', 72, [['吹孔', '气流撞向吹孔边缘，激起管内空气振动。'], ['笛管', '管内空气柱共鸣；长笛不使用簧片。'], ['按键', '开合音孔，改变音高。']]);
  add('oboe', '双簧管', 'oboe.png', 'woodwinds', '集中 · 清晰 · 带鼻音', '让旋律鲜明地浮出来，也能带来柔软的诉说。', '与长笛、单簧管交接旋律，在弦乐上方描线。', 65, doubleReed);
  add('clarinet', '单簧管', 'clarinet.png', 'woodwinds', '圆润 · 柔和 · 音区多变', '连接不同音区，既能温柔歌唱，也能灵巧奔跑。', '与木管融合，或为弦乐旋律添上圆润的轮廓。', 62, [['单簧片', '一片簧片在吹嘴上振动。'], ['管身', '管内空气共鸣，不同音区呈现不同色彩。'], ['音孔与按键', '控制空气柱长度，配合气息改变音高。']]);
  add('bassoon', '巴松', 'bassoon.png', 'woodwinds', '醇厚 · 木质 · 低音温和', '支撑木管低声部，也能说出诙谐或深情的旋律。', '与低弦乐一起托底，补全木管和声。', 48, doubleReed);
  add('horn', '圆号', 'horn.png', 'brass', '圆融 · 温厚 · 悠远', '铺开宽阔的和声，也能吹出悠长的旋律。', '连接木管、弦乐与铜管，让合奏更融合。', 48, [brass[0], ['阀键与盘管', '切换气流路径，改变管长与音高。'], brass[2]]);
  add('trumpet', '小号', 'trumpet.png', 'brass', '明亮 · 集中 · 有穿透力', '强调重要旋律与节奏，让高潮更鲜明。', '与铜管合奏撑开亮度，也能独奏清晰的线条。', 65, [brass[0], ['活塞与管身', '切换管路长度，配合嘴唇振动改变音高。'], brass[2]]);
  add('trombone', '长号', 'trombone.png', 'brass', '宽阔 · 厚重 · 庄严', '支撑和声，带来有重量的节奏与强奏。', '与圆号、小号组成铜管和声，与大号连接低音。', 48, [brass[0], ['伸缩管', '推拉滑管改变管长，可连续滑过音高。'], brass[2]]);
  add('tuba', '大号', 'tuba.png', 'brass', '深厚 · 圆实 · 稳重', '承担铜管的低音基础。', '与长号、低音提琴一起托住整个乐团。', 38, [brass[0], ['阀键与长管', '很长的管路提供低音，阀键改变气流路径。'], brass[2]]);
  add('timpani', '定音鼓', 'timpani.png', 'percussion', '浑厚 · 有音高 · 有弹性', '用有音高的鼓声强调节奏与和声支点。', '常与低声部同落，推动乐句的起伏。', 38, [['鼓槌', '不同槌头与敲击位置改变音色。'], ['鼓皮', '振动发声，张力决定音高。'], ['鼓腔与踏板', '鼓腔参与共鸣，踏板调节鼓皮张力。']]);
  add('bassDrum', '大鼓', 'bass-drum.png', 'percussion', '低沉 · 宽广 · 无固定音高', '强调重拍与高潮，增加低频重量。', '与铜管和钹一起放大重要的落点。', 36, [['鼓槌', '柔软槌头激起宽厚的冲击。'], ['鼓皮', '大面积鼓皮振动，产生深低的声音。'], ['鼓腔', '让声音更宽广，通常没有明确的固定音高。']]);
  add('cymbal', '钹', 'cymbal.png', 'percussion', '闪亮 · 扩散 · 无固定音高', '点亮高潮、强调转折，留下宽阔的余响。', '常与大鼓、铜管一起勾出高潮的轮廓。', 49, [['两片金属钹', '相互撞击，激起复杂的振动。'], ['弧形钹面', '形状、厚度与接触方式影响音色。'], ['余振', '金属持续振动，也可用手或身体止音。']]);
  add('tamTam', '锣', 'tam-tam.png', 'percussion', '深远 · 朦胧 · 无固定音高', '铺开低沉的余响，为转折与收束增添空间。', '与低弦乐、铜管融合，让余音慢慢散开。', 57, [['软槌', '温和敲击或滚奏，逐渐激起振动。'], ['锣面', '金属面产生复杂泛音；这里使用无固定音高的 tam-tam。'], ['悬挂点', '允许锣面自由振动，保留悠长的余响。']]);
  add('harp', '竖琴', 'harp.png', 'color', '清澈 · 晶莹 · 轻柔衰减', '用拨弦与琶音点染和声，连接乐句。', '与弦乐、木管一起添上细小的光泽。', 69, [['琴弦', '手指拨弦，振动很快变成柔和余音。'], ['共鸣箱', '接收琴弦振动，使声音向外辐射。'], ['踏板', '交响乐团常用踏板竖琴，踏板改变各组琴弦的音高。']]);

  const roleNames = { lead: '奏出旋律', counter: '编织对旋律', reply: '回应旋律', bass: '托住低音',
    brassBass: '托住铜管低音', inner: '填充内声部', orchestralBody: '铺开和声', woodwindChoir: '木管合奏',
    brassChoir: '铜管合奏', percussion: '强调节奏', color: '点染音色', technique: '奏出细节' };
  function currentRole(notes = [], { playing = false, muted = false } = {}) {
    if (!playing) return '演出暂停 · 等待合奏';
    const roles = [...new Set(notes.map((note) => roleNames[note.role] || '参与合奏'))];
    return `${muted ? '静音中 · ' : ''}${roles.length ? roles.slice(0, 2).join('、') : '暂时休息 · 等待下一句'}`;
  }

  // Summarize bounded real trace data without inventing a performance history.
  function summarizeTrace(trace = [], limit = 48) {
    const frames = trace.filter((frame) => Number.isFinite(frame.at) && Number.isFinite(frame.energy))
      .slice(-20000).sort((a, b) => a.at - b.at);
    if (!frames.length) return { duration: 0, points: [], moments: [] };
    const count = Math.min(Math.max(1, Math.floor(limit)), frames.length);
    const points = Array.from({ length: count }, (_, index) => {
      const from = Math.floor(index * frames.length / count);
      const to = Math.floor((index + 1) * frames.length / count);
      const group = frames.slice(from, to);
      return { at: group[0].at, energy: Math.max(0, Math.min(1,
        group.reduce((sum, frame) => sum + frame.energy, 0) / group.length)),
      paused: group.some((frame) => frame.pauseSeconds >= 8) };
    });
    const moments = [{ at: frames[0].at, label: '演奏轨迹开始' }];
    let previous = '';
    for (const frame of frames) {
      const state = frame.pauseSeconds >= 8 ? '停笔构思' : frame.energy >= .65 ? '笔触渐密' : frame.energy < .35 ? '节奏舒展' : '';
      if (state && state !== previous) moments.push({ at: frame.at, label: state });
      previous = state;
    }
    return { duration: frames.at(-1).at, points, moments: [moments[0], ...moments.slice(1).slice(-3)] };
  }
  global.OrchestraInstrumentGuide = { instruments: guide, families, currentRole, summarizeTrace };
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
  'use strict';

  // An original, deliberately neutral novel excerpt for repeatable interaction tests.
  const PASSAGE = `雨停后的车站像一只缓慢醒来的钟。林秋站在第三站台，手里攥着一张没有日期的车票。售票员说末班车已经离开，可远处的铁轨仍轻轻发响，像有人把一段未讲完的话藏进夜色。她把行李箱放在脚边，听见檐下的水滴逐渐稀疏。她本来准备回城，去参加母亲的生日晚宴，却在出门前收到一封旧信。信封上写着父亲的字，只有一句：如果想知道那年冬天发生了什么，就到这里等我。

钟面指向九点四十，站台上的灯忽然一盏接一盏地亮了。林秋沿着光走，鞋底踩过积水，映出许多倒着的窗。她记得小时候也来过这里，那时父亲总让她数路边的白杨，数到第七棵就会看见河。后来河道改了，白杨砍了，父亲也再没有提起那段路。她以为记忆早已沉下去，此刻却能清楚想起他袖口的墨迹，以及他讲故事前习惯性的停顿。

一阵风穿过空站，候车室的门轻轻合上。林秋回头，玻璃上只有自己的影子。她忽然不想立刻寻找答案，便坐到长椅上，慢慢展开那封信。纸背还有一行极浅的铅笔字，像写信的人犹豫了很久才添上去：别怪你母亲。她盯着这几个字，听见自己的呼吸一点点放缓。原来那些被她当成沉默的年岁，也可能藏着另一个人用尽力气守住的秘密。

远处传来列车进站的声音，先是细微的震动，接着是窗框和广告牌一起颤响。林秋站起身，却发现轨道尽头没有灯。声音越近，风却越安静，连水滴都像停在半空。她知道答案正在向自己走来。`;

  const STAGES = [
    { kind: 'write', label: '平稳开篇', count: 75, seconds: 14, dwellMs: 96 },
    { kind: 'write', label: '快速推进', count: 120, seconds: 14, dwellMs: 62 },
    { kind: 'pause', label: '停笔构思', count: 0, seconds: 6 },
    { kind: 'write', label: '缓慢斟酌与删改', count: 45, seconds: 22, dwellMs: 145, deletions: 10 },
    { kind: 'write', label: '再次提速', count: 145, seconds: 14, dwellMs: 58 },
    { kind: 'write', label: '从容收束', count: 115, seconds: 24, dwellMs: 112, deletions: 4 },
    { kind: 'pause', label: '写完后长停笔', count: 0, seconds: 8 },
  ];
  const TIME_SCALE = 4;
  const isHan = (character) => /\p{Script=Han}/u.test(character);

  function splitIntoCharacters(text) {
    const units = [];
    for (const character of Array.from(text)) {
      if (isHan(character)) units.push(character);
      else if (units.length) units[units.length - 1] += character;
      else throw new Error('测试文字不能以标点开头');
    }
    return units;
  }

  class TypingScenario {
    constructor() {
      this.units = splitIntoCharacters(PASSAGE);
      this.total = this.units.length;
      if (this.total !== 500) throw new Error(`测试文字应为 500 字，当前为 ${this.total}`);
      if (STAGES.reduce((sum, stage) => sum + stage.count, 0) !== this.total) {
        throw new Error('测试阶段字数之和必须是 500');
      }
      this.virtualNow = 0;
      this.model = new global.PredictiveConductor({ clock: () => this.virtualNow, storage: null });
      this.snapshot = this.model.snapshot;
      this.nextSampleAt = 1000;
      this.eventIndex = 0;
      this.typedCount = 0;
      this.text = '';
      this.events = [];
      this.stageEnds = [];
      let elapsed = 0;
      let cursor = 0;
      for (const stage of STAGES) {
        const duration = stage.seconds * 1000;
        const stageStart = elapsed * TIME_SCALE;
        if (stage.kind === 'write') {
          for (let index = 0; index < stage.count; index++) {
            const at = (elapsed + (index + 1) * duration / stage.count) * TIME_SCALE;
            const dwell = stage.dwellMs + (index % 3 - 1) * 8;
            this.events.push({ at: Math.max(stageStart, at - dwell), kind: 'down' });
            this.events.push({ at, kind: 'up' });
            this.events.push({ at, kind: 'insert', unit: this.units[cursor++] });
          }
          for (let index = 0; index < (stage.deletions || 0); index++) {
            const at = (elapsed + duration * (index + 1) / ((stage.deletions || 0) + 1)) * TIME_SCALE + 7;
            this.events.push({ at: at - 88, kind: 'down' });
            this.events.push({ at, kind: 'up' });
            this.events.push({ at, kind: 'delete' });
          }
        }
        elapsed += duration;
        this.stageEnds.push(elapsed);
      }
      this.events.sort((left, right) => left.at - right.at
        || ['down', 'up', 'delete', 'insert'].indexOf(left.kind)
          - ['down', 'up', 'delete', 'insert'].indexOf(right.kind));
      this.durationMs = elapsed;
    }

    stageAt(realElapsedMs) {
      const index = this.stageEnds.findIndex((end) => realElapsedMs < end);
      return STAGES[index < 0 ? STAGES.length - 1 : index];
    }

    applyEvent(event) {
      if (event.kind === 'down') this.model.recordKeyDown();
      else if (event.kind === 'up') this.model.recordKeyUp();
      else if (event.kind === 'delete') this.model.record({ characters: 1, deleted: true });
      else {
        this.model.record({ characters: 1 });
        this.text += event.unit;
        this.typedCount += 1;
      }
    }

    advanceTo(realElapsedMs) {
      const elapsed = Math.max(0, Math.min(this.durationMs, realElapsedMs));
      const target = elapsed * TIME_SCALE;
      if (target < this.virtualNow) throw new Error('测试回放时间不能倒退');
      while (true) {
        const nextEvent = this.events[this.eventIndex];
        const eventTime = nextEvent?.at ?? Infinity;
        const nextTime = Math.min(eventTime, this.nextSampleAt);
        if (nextTime > target) break;
        this.virtualNow = nextTime;
        if (eventTime <= this.nextSampleAt) {
          this.applyEvent(nextEvent);
          this.eventIndex += 1;
        } else {
          this.snapshot = this.model.sample();
          this.nextSampleAt += 1000;
        }
      }
      this.virtualNow = target;
      return {
        text: this.text,
        typedCount: this.typedCount,
        total: this.total,
        stage: this.stageAt(elapsed),
        snapshot: this.snapshot,
        done: elapsed >= this.durationMs,
        elapsedMs: elapsed,
        durationMs: this.durationMs,
      };
    }
  }

  global.TypingScenario = TypingScenario;
  global.TYPING_SCENARIO_META = {
    characters: 500,
    seconds: STAGES.reduce((sum, stage) => sum + stage.seconds, 0),
    stages: STAGES.map((stage) => ({ ...stage })),
    timeScale: TIME_SCALE,
  };
})(typeof window !== 'undefined' ? window : globalThis);

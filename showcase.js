(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const all = selector => [...document.querySelectorAll(selector)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const content = window.SHOWCASE_CONTENT;
  function changeText(node, value) { if (node.textContent !== value) node.textContent = value; }
  function arrive(node) {
    if (reduced.matches || document.documentElement.classList.contains('keyboard-input')) return;
    node.classList.remove('content-arrive');
    requestAnimationFrame(() => node.classList.add('content-arrive'));
  }
  document.addEventListener('keydown', () => document.documentElement.classList.add('keyboard-input'));
  document.addEventListener('pointerdown', () => document.documentElement.classList.remove('keyboard-input'));
  for (const button of all('.button')) {
    button.addEventListener('pointerdown', () => { if (!reduced.matches) button.setAttribute('data-pressed', ''); });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave', 'keydown', 'blur']) {
      button.addEventListener(event, () => button.removeAttribute('data-pressed'));
    }
  }

  const select = $('#record-select'), recordExpand = $('#record-expand');
  const library = content.library;
  const duration = seconds => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;
  function selectRecord(id) {
    const track = library.find(item => item.id === id);
    if (!track) return;
    select.value = id;
    all('[data-record]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.record === id)));
    changeText($('#record-title'), track.title); changeText($('#record-composer'), track.composer);
    changeText($('#record-description'), track.description);
    changeText($('#record-format'), `${track.kind === 'album' ? '完整专辑' : '独立单曲'} · ${duration(track.durationSeconds)}`);
    recordExpand.hidden = track.kind !== 'album';
    recordExpand.setAttribute('aria-expanded', 'false');
    recordExpand.setAttribute('aria-label', `展开${track.title}的乐章`);
    $('#record-movements').hidden = true;
    $('#record-movements').replaceChildren(...track.movements.map((movement, index) => {
      const item = document.createElement('li');
      const title = document.createElement('span'); title.textContent = `${['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ'][index] || index + 1} · ${movement.title}`;
      const detail = document.createElement('small'); detail.textContent = `${duration(movement.durationSeconds)} · 可独立装载`;
      item.append(title, detail); return item;
    }));
    arrive($('.record-info'));
  }
  function selectCategory(kind, preferredId) {
    const entries = library.filter(track => track.kind === kind);
    all('[data-library-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.libraryKind === kind)));
    select.replaceChildren(...entries.map(track => {
      const option = document.createElement('option'); option.value = track.id; option.textContent = track.title; return option;
    }));
    const featuredIds = ['mozart-symphony-41-k551', 'beethoven-symphony-3-op55', 'beethoven-symphony-6-op68', 'tchaikovsky-symphony-6-op74'];
    const featured = kind === 'album' ? featuredIds.map(id => entries.find(track => track.id === id)).filter(Boolean).slice(0,3) : entries.slice(0,3);
    $('.record-shelf').replaceChildren(...featured.map(track => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'record-choice'; button.dataset.record = track.id;
      const img = document.createElement('img'); img.src = `/sheng-sui-bi-xing-demo/assets/showcase/rebuild/${track.image}`; img.alt = `${track.title}封面`; img.width = img.height = 400; img.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = track.title;
      button.append(img, label); return button;
    }));
    selectRecord(preferredId || entries[0].id);
  }
  $('.record-shelf').addEventListener('click', event => {
    const button = event.target.closest('[data-record]'); if (button) selectRecord(button.dataset.record);
  });
  recordExpand.addEventListener('click', () => {
    const open = recordExpand.getAttribute('aria-expanded') !== 'true';
    recordExpand.setAttribute('aria-expanded', String(open)); $('#record-movements').hidden = !open;
  });
  for (const button of all('[data-library-kind]')) button.addEventListener('click', () => selectCategory(button.dataset.libraryKind));
  select.addEventListener('change', () => selectRecord(select.value));
  selectCategory('album', 'mozart-symphony-41-k551');

  const albumButton=$('#album-toggle'), albumContents=$('#album-contents'), albumObject=$('#album-object');
  albumButton.addEventListener('click',()=>{
    const open=albumButton.getAttribute('aria-expanded')!=='true';
    albumButton.setAttribute('aria-expanded',String(open)); albumContents.hidden=!open;
    albumObject.classList.toggle('is-open',open);
    changeText(albumButton,open?'合上专辑':'展开专辑，看看里面');
  });

  const demo=$('#demo'), workspace=$('#demo-workspace'), playButton=$('#demo-play');
  const recordPlayButton=$('#demo-record-play');
  const replayButton=$('#demo-replay'), silentButton=$('#demo-silent');
  let player=null, rail=null, demoTransport=null;
  const audioFocus=window.initShowcaseExperiences({pauseDemo:()=>player?.pause('另一段试听已开启')});
  const stageLabels = {
    begin:'落下第一句，音乐慢慢出现。', flow:'故事连贯向前，乐团逐渐展开。',
    think:'停下来想一想，音乐先保留呼吸。', release:'留白长一些，演奏逐渐收束。',
    resume:'再写一句，节奏重新积累。', ended:'故事先停在这里，下一句交给你。',
  };
  const inView=node=>{const box=node.getBoundingClientRect();return box.bottom>0&&box.top<innerHeight;};
  const visible=()=>!document.hidden&&inView(demo);
  const time=ms=>{const seconds=Math.floor(ms/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
  function render(state) {
    workspace.dataset.state=state.state;
    recordPlayButton.setAttribute('aria-pressed',String(state.state==='playing'));
    recordPlayButton.setAttribute('aria-label',state.state==='playing'?'暂停唱片预览':state.state==='loading'?'取消准备唱片':'播放唱片预览');
    changeText($('#demo-record-status'),state.state==='loading'?'正在准备…':state.state==='playing'?'暂停唱片':state.state==='error'?'重试播放':'播放唱片');
    const labels={idle:'播放有声演示',loading:'暂停准备',playing:'暂停演示',
      paused:state.silent?'继续静音观看':'继续有声演示',ended:'再看一次',error:'重试有声演示'};
    changeText(playButton,labels[state.state]);
    replayButton.disabled=['idle','loading'].includes(state.state);
    silentButton.hidden=state.silent&&state.state!=='error';
    silentButton.disabled=state.state==='loading';
    const mode=state.state==='loading'?'正在准备音色':state.silent?'静音演示':state.state==='playing'?'有声演示进行中':state.state==='paused'?'有声演示已暂停':state.state==='ended'?'演示结束':'点击后开启声音';
    changeText($('#demo-mode'),mode);
    const detail=state.state==='loading'
      ? state.loading ? '正在准备乐团音色 · '+state.loading.done+' / '+state.loading.total : '正在准备乐团音色…'
      :state.state==='error'?'音色未能准备好。可以重试，或选择静音观看。'
      :state.state==='idle'?'准备好，听一个故事。'
      :state.state==='paused'?'演示已暂停'+(state.reason?' · '+state.reason:'')
      :stageLabels[state.stage];
    changeText($('#demo-phase'),detail);
    changeText($('#demo-words'),state.text||'点击下方播放，跟随一段文字的诞生。');
    changeText($('#demo-time'),time(state.elapsed)+' / 01:00');
    if (!demoTransport?.session) $('#demo-progress').value=state.elapsed/1000;
    changeText($('#demo-help'),state.silent?'静音观看展示文字与节奏过程；动态演奏谱面需有声播放。'
      :state.state==='error'?'无法开启音频时，静音观看也能了解演示。页面其他介绍可照常浏览。'
      :state.state==='paused'?'点击继续，从暂停的位置接着看。'
      :'示例写作 · 原速节奏。可拖动进度回看；离开演示区域或切到后台时暂停。');
    $('#score-empty').hidden=!state.silent&&state.elapsed>0;
    if(state.silent) changeText($('#score-empty'),'静音演示 · 观察文字与节奏说明');
    else changeText($('#score-empty'),'落针之后，音符会来到这里。');
    for(const item of all('[data-demo-phase]')){
      const stage=state.stage==='release'?'think':state.stage;
      item.classList.toggle('is-active',item.dataset.demoPhase===stage&&state.state!=='idle');
    }
    demoTransport?.sync();
    if(rail){
      rail.setEnergy(state.snapshot?.energy||0);
      if(['idle','loading'].includes(state.state)) rail.clear();
      if(rail.playing!==(state.state==='playing'&&!state.silent)) rail.setPlaying(state.state==='playing'&&!state.silent);
    }
  }
  function createPlayer() {
    player=new window.ShowcasePresentation({onChange:render,canPlay:visible,
      onFrame:frame=>rail?.enqueue(frame),onWindow:data=>rail?.enqueueWindow(data)});
  }
  try {
    rail=new window.ScoreRailVisualizer($('#demo-score'),{clock:()=>player?.engine?.context?.currentTime||0});
    createPlayer();
    demoTransport = new window.RecordTransport({
      inputs: [$('#demo-progress')], status: $('#demo-seek-status'),
      state: () => {
        playButton.disabled = Boolean(demoTransport?.session);
        recordPlayButton.disabled = Boolean(demoTransport?.session);
        replayButton.disabled = Boolean(demoTransport?.session) || ['idle','loading'].includes(player.state);
        silentButton.disabled = Boolean(demoTransport?.session) || player.state === 'loading';
        return { seconds: player.elapsed / 1000, durationSeconds: 60, playing: player.state === 'playing', trackId: 'showcase-60s',
          disabled: ['idle','loading','error'].includes(player.state), reason: '' };
      },
      begin: async animate => { rail.dissolve({animate}); await player.pause('调整演示进度'); },
      commit: async (seconds, resume) => {
        rail.clear(); rail.primeSeekWindow();
        await player.seekTo(seconds, {resume: resume && visible()});
      },
      render: seconds => { $('#demo-time').textContent = `${time(seconds * 1000)} / 01:00`; },
    });
    demoTransport.sync();
    playButton.disabled=false; silentButton.disabled=false; recordPlayButton.disabled=false;
    recordPlayButton.addEventListener('click',()=>{
      if(!['playing','loading'].includes(player.state)) audioFocus.claim('demo');
      const action=['playing','loading'].includes(player.state)?player.pause():player.play({silent:false});
      action.catch(()=>{$('#demo-init-error').hidden=false;});
    });
    playButton.addEventListener('click',()=>{
      if(!['playing','loading'].includes(player.state)) workspace.scrollIntoView({block:'start',behavior:'instant'});
      if(!['playing','loading'].includes(player.state)) audioFocus.claim('demo');
      const action=['playing','loading'].includes(player.state)?player.pause():player.play();
      action.catch(()=>{$('#demo-init-error').hidden=false;});
    });
    replayButton.addEventListener('click',()=>{audioFocus.claim('demo');workspace.scrollIntoView({block:'start',behavior:'instant'});player.restart().catch(()=>{$('#demo-init-error').hidden=false;});});
    silentButton.addEventListener('click',async()=>{
      audioFocus.claim('demo');
      workspace.scrollIntoView({block:'start',behavior:'instant'});
      await player.pause(); await player.reset(); await player.play({silent:true});
    });
  } catch { $('#demo-init-error').hidden=false; }
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(entry.target===demo&&!entry.isIntersecting) player?.pause('离开演示区域');
        if(entry.target.id==='rhythm'&&entry.isIntersecting) entry.target.classList.add('is-present');
      }
    },{threshold:0});
    observer.observe(demo); observer.observe($('#rhythm'));
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)player?.pause('页面已切到后台');});
  all('.app-entry').forEach(link=>link.addEventListener('click',()=>{player?.pause('进入写作空间');}));
  addEventListener('pagehide',()=>{player?.dispose();rail?.clear();});
  addEventListener('pageshow',event=>{if(event.persisted&&player?.disposed){createPlayer();}});
  reduced.addEventListener('change',()=>{
    if(rail){rail.reducedMotion=reduced.matches;rail.clear();}
    all('[data-pressed]').forEach(node=>node.removeAttribute('data-pressed'));
  });
  let scrollFrame=null;
  function syncScroll(){
    scrollFrame=null;
    if(!visible())player?.pause('离开演示区域');
    if(!reduced.matches)$('.hero').style.setProperty('--hero-progress',String(Math.min(1,scrollY/650)));
  }
  addEventListener('scroll',()=>{if(scrollFrame===null)scrollFrame=requestAnimationFrame(syncScroll);},{passive:true});
})();

(function (global) {
  'use strict';
  let pending = null;
  global.loadOrchestraSamples = function () {
    if (global.ORCHESTRA_SAMPLES?.length) return Promise.resolve();
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { global.ORCHESTRA_SAMPLES_CANCEL?.(); script.remove(); reject(error); } else resolve();
      };
      const timer = setTimeout(() => finish(new Error('音色加载超时，请重新落针')), 30000);
      script.src = './assets/audio/samples-inline.js?v=rounded-1';
      script.onload = () => {
        Promise.resolve(global.ORCHESTRA_SAMPLES_LOADER_PROMISE).then(() =>
          finish(global.ORCHESTRA_SAMPLES?.length ? null : new Error('音色文件无效')),
        () => finish(new Error('音色加载失败，请检查网络并重新落针')));
      };
      script.onerror = () => finish(new Error('音色加载失败，请检查网络并重新落针'));
      document.head.append(script);
    }).catch((error) => { pending = null; throw error; });
    return pending;
  };
})(typeof window !== 'undefined' ? window : globalThis);

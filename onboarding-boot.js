// Runs in the head, before the first paint. No draft contents are rendered or sent.
(function () {
  // <base href="/"> keeps app assets at the root. Resolve the in-page link
  // as soon as the parser creates it, before the deferred app can receive focus.
  const resolveSkipLink = () => {
    const link = document.querySelector('.skip-link');
    if (!link) return false;
    link.setAttribute('href', `${location.pathname}${location.search}#editor`);
    return true;
  };
  if (typeof document.querySelector === 'function' && !resolveSkipLink() && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => { if (resolveSkipLink()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  const parse = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };
  let stage = null;
  try {
    if (new URLSearchParams(location.search).get('demo') === '1') stage = 'welcome';
    else {
      const progress = parse(localStorage.getItem('sonata-first-notes-v2'));
      const allowed = ['welcome', 'first-reward', 'slow', 'slow-reward', 'fast', 'fast-reward', 'library', 'needle'];
      if (progress?.version === 2 && allowed.includes(progress.stage)) stage = progress.stage;
      else if (!(progress?.version === 2 && progress.stage === 'complete') && localStorage.getItem('sonata-first-notes-v1') !== 'done') {
        const primary = parse(localStorage.getItem('sonata-workspace-v1'));
        const backup = parse(localStorage.getItem('sonata-workspace-v1-previous'));
        if (!(primary?.text || backup?.text || localStorage.getItem('sonata-novel-draft') || '').trim()) stage = 'welcome';
      }
    }
  } catch { stage = 'welcome'; }
  if (stage) {
    document.documentElement.dataset.firstNotes = stage;
    document.documentElement.dataset.guideEmpty = 'true';
  }
})();

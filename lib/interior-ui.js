/* Credits panel toggle — used by The Office homepage (index.html) */
(function () {
  const panel = document.getElementById('creditsPanel');
  const btn = document.getElementById('btnCredits');
  if (!panel || !btn) return;

  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();

/* When an interior page is shown inside The Office overlay iframe, back /
   logo links ask the parent to close the overlay instead of navigating to /.
   Standalone visits (direct URL) keep normal href="/" behavior. */
(function () {
  const MSG = 'coworking:close-interior';
  const STOP_AUDIO_MSG = 'coworking:stop-interior-audio';
  const START_AUDIO_MSG = 'coworking:start-interior-audio';

  function stopInteriorAudio() {
    try { window.stopInteriorAudio?.(); } catch (_) {}
  }

  window.addEventListener('pagehide', stopInteriorAudio);

  function isEmbedded() {
    try {
      if (window.self !== window.top) return true;
    } catch {
      return true;
    }
    return new URLSearchParams(location.search).get('embed') === '1';
  }

  if (!isEmbedded()) return;

  document.documentElement.classList.add('interior-embed');

  function closeInterior(e) {
    if (e) e.preventDefault();
    stopInteriorAudio();
    try {
      parent.postMessage({ type: MSG }, location.origin);
    } catch {
      location.assign('/');
    }
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    if (ev.data && ev.data.type === STOP_AUDIO_MSG) stopInteriorAudio();
    if (ev.data && ev.data.type === START_AUDIO_MSG) {
      try { window.startInteriorAudio?.(); } catch (_) {}
    }
  });

  function goesToLobby(href) {
    if (!href) return false;
    if (href === '/' || href === '/index.html' || href === 'index.html') return true;
    try {
      const u = new URL(href, location.origin);
      return u.origin === location.origin && (u.pathname === '/' || u.pathname === '/index.html');
    } catch {
      return false;
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (!goesToLobby(a.getAttribute('href'))) return;
    closeInterior(e);
  });
})();

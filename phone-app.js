// Store Ops app on a phone, board page: if the computer signed in to this
// profile opens an order in phone mode (Lanjut on the computer), jump to the
// camera scanner. Also keeps the phone marked as connected for that computer.
document.addEventListener('DOMContentLoaded', () => {
  if (!window.JGStoreDevice?.isPhone()) return;
  const root = '../'; // Board page lives in /dashboard/.
  const endpoint = `${root}api/mobile-scanner/`;
  let known = '';
  let controller = null;
  let stopped = false;

  const poll = async () => {
    while (!stopped && document.visibilityState === 'visible') {
      controller = new AbortController();
      try {
        const query = new URLSearchParams({ action: 'phone_state', wait: '10', known });
        const response = await fetch(`${endpoint}?${query}`, {
          cache: 'no-store', credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json' }
        });
        const state = await response.json();
        if (!response.ok || state.ok === false) throw new Error('unavailable');
        known = String(state.signature || '');
        // Don't pull someone out of an order they are working on here.
        const busy = document.querySelector('[data-fulfillment-modal]:not([hidden]), [data-store-settings-modal]:not([hidden])');
        if (state.active && !busy) {
          window.location.href = `${root}mobile-scanner/`;
          return;
        }
      } catch (_error) {
        if (controller.signal.aborted) return;
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
    }
  };

  // Not running as the installed app (Chrome's bar is showing): offer it.
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
  const dismissKey = 'jg-store-app-install-dismissed-at';
  const dismissedRecently = () => {
    try { return Date.now() - Number(window.localStorage.getItem(dismissKey) || 0) < 3 * 24 * 60 * 60 * 1000; } catch (_error) { return false; }
  };
  if (!standalone && !dismissedRecently()) {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const bar = document.createElement('div');
    bar.className = 'admin-app-install-bar';
    bar.innerHTML = `
      <img src="${root}mobile-scanner/icons/icon-192.png" alt="">
      <span><strong>Install the Store Ops app</strong><small data-install-hint>${isIos
        ? 'Tap Share, then Add to Home Screen.'
        : 'Full screen, no browser bar. Already installed? Remove the old icon and install again.'}</small></span>
      <button type="button" class="admin-primary-btn" data-install-app hidden>Install</button>
      <button type="button" class="admin-app-install-close" data-install-close aria-label="Not now">×</button>`;
    const host = document.querySelector('.admin-store-workspace') || document.body;
    host.prepend(bar);
    const installButton = bar.querySelector('[data-install-app]');
    let prompt = null;
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      prompt = event;
      installButton.hidden = false;
    });
    installButton.addEventListener('click', async () => {
      if (!prompt) return;
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      prompt = null;
      if (choice?.outcome === 'accepted') bar.remove();
      else bar.querySelector('[data-install-hint]').textContent = 'Or open the browser menu ⋮ and tap Install app.';
    });
    bar.querySelector('[data-install-close]').addEventListener('click', () => {
      try { window.localStorage.setItem(dismissKey, String(Date.now())); } catch (_error) { /* Shows again next time. */ }
      bar.remove();
    });
  }

  // An Instant order scrolled out of view: show "↑ Instant order".
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'admin-instant-jump';
  jump.hidden = true;
  jump.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span>Instant order</span>';
  document.body.appendChild(jump);
  const hiddenInstantCards = () => Array.from(document.querySelectorAll('.admin-order-card.is-instant'))
    .filter((card) => card.getBoundingClientRect().bottom < 60);
  const updateJump = () => {
    const hidden = hiddenInstantCards();
    jump.hidden = hidden.length === 0;
    jump.querySelector('span').textContent = hidden.length > 1 ? `${hidden.length} Instant orders` : 'Instant order';
  };
  let jumpFrame = 0;
  const scheduleJump = () => {
    if (jumpFrame) return;
    jumpFrame = window.requestAnimationFrame(() => { jumpFrame = 0; updateJump(); });
  };
  window.addEventListener('scroll', scheduleJump, { passive: true });
  window.addEventListener('resize', scheduleJump);
  const board = document.querySelector('[data-order-board]') || document.querySelector('.admin-order-board');
  if (board) new MutationObserver(scheduleJump).observe(board, { childList: true, subtree: true });
  jump.addEventListener('click', () => {
    const target = hiddenInstantCards()[0];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { known = ''; poll(); }
    else controller?.abort();
  });
  window.addEventListener('pagehide', () => { stopped = true; controller?.abort(); });
  poll();
});

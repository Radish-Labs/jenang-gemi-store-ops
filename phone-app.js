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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { known = ''; poll(); }
    else controller?.abort();
  });
  window.addEventListener('pagehide', () => { stopped = true; controller?.abort(); });
  poll();
});

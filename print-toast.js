// After a label prints, the orders board shows "Printed <order>" with a
// Reprint button instead of asking whether it printed. It stays until it is
// closed or the next label replaces it.
document.addEventListener('DOMContentLoaded', () => {
  const storageKey = 'jg-store-last-print';
  const dismissedKey = 'jg-store-last-print-dismissed';
  const mobileEndpoint = '../api/mobile-scanner/';

  const toast = document.createElement('div');
  toast.className = 'admin-print-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  toast.innerHTML = `
    <span class="admin-print-toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span>
    <span class="admin-print-toast-copy"><strong data-toast-title></strong><small data-toast-detail></small></span>
    <button type="button" class="admin-print-toast-reprint" data-toast-reprint>Reprint</button>
    <button type="button" class="admin-print-toast-close" data-toast-close aria-label="Dismiss">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>`;
  document.body.appendChild(toast);
  const title = toast.querySelector('[data-toast-title]');
  const detail = toast.querySelector('[data-toast-detail]');
  const reprintButton = toast.querySelector('[data-toast-reprint]');
  let current = null;
  let run = 0;

  const read = () => {
    try { return JSON.parse(window.localStorage.getItem(storageKey) || 'null'); } catch (_error) { return null; }
  };
  const hide = () => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => { if (!toast.classList.contains('is-visible')) toast.hidden = true; }, 220);
  };
  // Closed by hand: don't bring it back after a reload.
  const dismiss = () => {
    run += 1;
    try { window.localStorage.setItem(dismissedKey, String(current?.at || '')); } catch (_error) { /* Optional. */ }
    hide();
  };
  const setText = (heading, text = '', tone = 'ok') => {
    title.textContent = heading;
    detail.textContent = text;
    detail.hidden = !text;
    toast.dataset.tone = tone;
  };

  const show = (record) => {
    if (!record || !record.orderId) return;
    try {
      if (window.localStorage.getItem(dismissedKey) === String(record.at)) return;
    } catch (_error) { /* Show it. */ }
    current = record;
    run += 1;
    setText(record.orderId, 'Printed. Didn\'t come out right?');
    reprintButton.hidden = false;
    reprintButton.disabled = false;
    toast.hidden = false;
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));
  };

  // Phone: send the same job to the packing computer again and follow it.
  const reprintFromPhone = async (record) => {
    const thisRun = ++run;
    setText(record.orderId, 'Sending to the computer again…', 'info');
    const response = await fetch(mobileEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'print_again', job: record.job })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false || !payload.job) throw new Error(payload.error || 'Store Ops could not be reached.');
    const job = payload.job;
    let known = '';
    const started = Date.now();
    while (thisRun === run && Date.now() - started < 120000) {
      const query = new URLSearchParams({ action: 'print_job', job: String(job), known, wait: '10' });
      const state = await (await fetch(`${mobileEndpoint}?${query}`, { cache: 'no-store', credentials: 'same-origin' })).json().catch(() => ({}));
      known = String(state.signature || '');
      if (thisRun !== run) return;
      const status = String(state.status || '');
      if (status === 'printed') {
        setText(record.orderId, 'Reprinted.');
        current = { ...record, job, at: Date.now() };
        reprintButton.hidden = false;
        reprintButton.disabled = false;
        return;
      }
      if (['failed', 'expired', 'cancelled', 'missing'].includes(status)) {
        throw new Error(state.detail || 'The computer could not print it. Check the printer.');
      }
      setText(record.orderId, status === 'attention'
        ? (state.detail || 'The printer needs attention at the computer.')
        : status === 'queued'
        ? (state.station_online ? 'Waiting for the computer…' : 'No computer is ready. Open Store Ops on the packing computer.')
        : 'Printing on the computer…', 'info');
    }
    if (thisRun === run) throw new Error('No answer from the computer yet. Check it, or press Reprint again.');
  };

  reprintButton.addEventListener('click', () => {
    const record = current;
    if (!record) return;
    reprintButton.disabled = true;
    if (Number(record.job) > 0) {
      reprintButton.hidden = true;
      reprintFromPhone(record).catch((error) => {
        setText(`Not reprinted: ${record.orderId}`, error instanceof Error ? error.message : 'Try again.', 'error');
        reprintButton.hidden = false;
        reprintButton.disabled = false;
      });
      return;
    }
    // Computer: open the label page, which prints straight away.
    const query = new URLSearchParams({ order: record.orderId, reprint: '1', auto: '1' });
    if (record.account) query.set('account', record.account);
    if (record.platform) query.set('platform', record.platform);
    if (record.package) query.set('package', record.package);
    const url = `./print-label/?${query}`;
    reprintButton.disabled = false;
    if (!window.open(url, '_blank')) window.location.href = url;
  });
  toast.querySelector('[data-toast-close]').addEventListener('click', dismiss);

  show(read());
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) show(read());
  });
});

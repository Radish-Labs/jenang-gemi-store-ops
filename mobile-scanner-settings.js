// Settings > Scanner > "Use mobile scanner": shows the phone link as a QR code
// and whether a phone is currently signed in to this profile.
document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-mobile-scanner-settings]');
  if (!root) return;

  const qrLibraryUrl = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const openButton = root.querySelector('[data-mobile-scanner-open]');
  const card = root.querySelector('[data-mobile-scanner-card]');
  const qrNode = root.querySelector('[data-mobile-scanner-qr]');
  const linkNode = root.querySelector('[data-mobile-scanner-link]');
  const copyButton = root.querySelector('[data-mobile-scanner-copy]');
  const phoneNode = root.querySelector('[data-mobile-scanner-phone]');
  const profileNode = root.querySelector('[data-mobile-scanner-profile]');
  const url = new URL(root.dataset.mobileScannerUrl || '../mobile-scanner/', window.location.href).href;
  const endpoint = root.dataset.mobileScannerEndpoint || '../api/mobile-scanner/';
  let statusTimer = 0;
  let qrRendered = false;

  linkNode.textContent = url;

  const loadQrLibrary = () => new Promise((resolve, reject) => {
    if (window.qrcode) { resolve(); return; }
    const script = document.createElement('script');
    script.src = qrLibraryUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('QR code unavailable'));
    document.head.appendChild(script);
  });

  const renderQr = async () => {
    if (qrRendered) return;
    try {
      await loadQrLibrary();
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrNode.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      qrRendered = true;
    } catch (_error) {
      qrNode.textContent = 'Open the link below on the phone.';
    }
  };

  const checkPhone = async () => {
    window.clearTimeout(statusTimer);
    if (card.hidden || !root.isConnected) return;
    try {
      const response = await fetch(`${endpoint}?action=status`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Unavailable');
      if (profileNode) profileNode.textContent = payload.profile_name ? ` (${payload.profile_name})` : '';
      phoneNode.classList.toggle('is-connected', Boolean(payload.phone_connected));
      phoneNode.textContent = payload.phone_connected
        ? 'Phone connected. Press Lanjut on an order to start scanning.'
        : 'No phone connected yet.';
    } catch (error) {
      phoneNode.classList.remove('is-connected');
      phoneNode.textContent = error instanceof Error && error.message !== 'Unavailable'
        ? error.message
        : 'Unable to check the phone right now.';
    }
    statusTimer = window.setTimeout(checkPhone, 3000);
  };

  openButton.addEventListener('click', () => {
    card.hidden = !card.hidden;
    openButton.setAttribute('aria-expanded', String(!card.hidden));
    if (!card.hidden) {
      renderQr();
      checkPhone();
    }
  });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyButton.textContent = 'Copied';
    } catch (_error) {
      const range = document.createRange();
      range.selectNodeContents(linkNode);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      copyButton.textContent = 'Selected';
    }
    window.setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1600);
  });
});

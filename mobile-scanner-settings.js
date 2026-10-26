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
  const usbButton = root.querySelector('[data-mobile-scanner-usb]');
  const modeNode = root.querySelector('[data-mobile-scanner-mode]');
  // Scanner choice is per computer (shared with the scan page).
  const modeKey = 'jg-store-scanner-mode';
  const readMode = () => {
    try { return window.localStorage.getItem(modeKey) === 'phone' ? 'phone' : 'usb'; } catch (_error) { return 'usb'; }
  };
  const writeMode = (mode) => {
    try { window.localStorage.setItem(modeKey, mode); } catch (_error) { /* Falls back to USB. */ }
  };
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
      // Draw a solid image where every module is the same whole number of
      // screen pixels (also under Windows 125%/150% scaling). Scaled vector
      // modules can show faint seams or uneven widths that some phone
      // scanners reject. The tile's white padding is the margin.
      const modules = qr.getModuleCount();
      const quiet = 0;
      const total = modules + quiet * 2;
      const ratio = window.devicePixelRatio || 1;
      const cell = Math.max(3, Math.floor((152 * ratio) / total));
      const canvas = document.createElement('canvas');
      canvas.width = total * cell;
      canvas.height = total * cell;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
          if (qr.isDark(row, col)) context.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
        }
      }
      const image = new Image();
      image.alt = 'QR code for the mobile scanner link';
      image.src = canvas.toDataURL('image/png');
      image.width = canvas.width / ratio;
      image.height = canvas.height / ratio;
      qrNode.replaceChildren(image);
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

  const renderMode = () => {
    const phone = readMode() === 'phone';
    modeNode.innerHTML = phone
      ? 'This computer uses the <strong>phone</strong>: the phone scans, and orders finished on the phone print here. Keep a Store Ops tab open. The USB scanner also still works.'
      : 'This computer uses the <strong>USB scanner</strong>.';
    usbButton.hidden = !phone;
    card.hidden = !phone;
    openButton.setAttribute('aria-expanded', String(phone));
    if (phone) {
      renderQr();
      checkPhone();
    }
  };

  openButton.addEventListener('click', () => {
    writeMode('phone');
    renderMode();
  });

  usbButton.addEventListener('click', () => {
    writeMode('usb');
    window.clearTimeout(statusTimer);
    renderMode();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === modeKey) renderMode();
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

  renderMode();
});

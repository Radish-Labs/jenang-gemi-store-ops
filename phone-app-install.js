// Sidebar "Phone app": a pop-up with a QR code and link that open the Store Ops
// app on a phone (it starts on the orders board). On a phone that isn't
// running the installed app yet, it also offers Chrome's Install button.
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('[data-open-phone-app]');
  if (!buttons.length) return;

  const appUrl = new URL('/dashboard/', window.location.origin).href;
  const qrLibraryUrl = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const isPhone = document.documentElement.dataset.device === 'phone';
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;

  // Already inside the installed app on this phone: nothing to install.
  if (isPhone && installed) {
    buttons.forEach((button) => { button.hidden = true; });
    return;
  }

  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  const shell = document.createElement('div');
  shell.className = 'admin-modal-shell admin-phone-app-modal';
  shell.hidden = true;
  shell.innerHTML = `
    <div class="admin-modal-backdrop" data-close-phone-app></div>
    <section class="admin-modal-card admin-phone-app-card" role="dialog" aria-modal="true" aria-labelledby="phone-app-title">
      <div class="admin-modal-head">
        <div>
          <span class="admin-panel-kicker">Phone</span>
          <h3 id="phone-app-title">Get the phone app</h3>
        </div>
        <button type="button" class="admin-ghost-btn" data-close-phone-app>Close</button>
      </div>
      <div class="admin-phone-app-body">
        <div class="admin-mobile-scanner-qr" data-phone-app-qr aria-hidden="true"></div>
        <div class="admin-mobile-scanner-steps">
          <ol>
            <li>Scan this QR code with the phone camera, or open the link below.</li>
            <li>Sign in with your profile.</li>
            <li>In Chrome tap <strong>⋮ → Install app</strong> (not “Add to Home screen”). iPhone: Share, then Add to Home Screen.</li>
            <li>Open <strong>Store Ops</strong> from the new icon. It opens on the orders, full screen.</li>
          </ol>
          <p class="admin-phone-app-note">Had the old Scanner app? Delete its icon first, then install again.</p>
          <div class="admin-mobile-scanner-link">
            <code data-phone-app-link></code>
            <button type="button" class="admin-ghost-btn" data-phone-app-copy>Copy link</button>
          </div>
          <button type="button" class="admin-primary-btn" data-phone-app-install hidden>Install on this phone</button>
        </div>
      </div>
    </section>`;
  document.body.appendChild(shell);

  const qrNode = shell.querySelector('[data-phone-app-qr]');
  const linkNode = shell.querySelector('[data-phone-app-link]');
  const copyButton = shell.querySelector('[data-phone-app-copy]');
  const installButton = shell.querySelector('[data-phone-app-install]');
  linkNode.textContent = appUrl;
  if (isPhone) qrNode.hidden = true;

  let qrDrawn = false;
  const loadQrLibrary = () => new Promise((resolve, reject) => {
    if (window.qrcode) { resolve(); return; }
    const script = document.createElement('script');
    script.src = qrLibraryUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('QR code unavailable'));
    document.head.appendChild(script);
  });
  // Same pixel-exact drawing as Settings > Scanner, so phone cameras read it.
  const drawQr = async () => {
    if (qrDrawn || isPhone) return;
    try {
      await loadQrLibrary();
      const qr = window.qrcode(0, 'M');
      qr.addData(appUrl);
      qr.make();
      const modules = qr.getModuleCount();
      const ratio = window.devicePixelRatio || 1;
      const cell = Math.max(3, Math.floor((152 * ratio) / modules));
      const canvas = document.createElement('canvas');
      canvas.width = modules * cell;
      canvas.height = modules * cell;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
          if (qr.isDark(row, col)) context.fillRect(col * cell, row * cell, cell, cell);
        }
      }
      const image = new Image();
      image.alt = 'QR code for the Store Ops phone app';
      image.src = canvas.toDataURL('image/png');
      image.width = canvas.width / ratio;
      image.height = canvas.height / ratio;
      qrNode.replaceChildren(image);
      qrDrawn = true;
    } catch (_error) {
      qrNode.textContent = 'Open the link below on the phone.';
    }
  };

  const open = () => {
    installButton.hidden = !(isPhone && installPrompt && !isIos);
    shell.hidden = false;
    drawQr();
  };
  const close = () => { shell.hidden = true; };

  buttons.forEach((button) => button.addEventListener('click', open));
  shell.querySelectorAll('[data-close-phone-app]').forEach((node) => node.addEventListener('click', close));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !shell.hidden) close();
  });
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      copyButton.textContent = 'Copied';
    } catch (_error) {
      copyButton.textContent = 'Copy failed';
    }
    window.setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1600);
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    if (choice?.outcome === 'accepted') close();
    else installButton.hidden = true;
  });
});

// Phone side of the mobile scanner. Waits for the desktop scan page of the same
// profile, then opens the camera and sends every barcode it reads. The desktop
// checks each barcode against the order exactly like a USB scan.
document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-mobile-scanner]');
  if (!root) return;

  const endpoint = root.dataset.endpoint || '../api/mobile-scanner/';
  const zxingUrl = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  const $ = (selector) => root.querySelector(selector);
  const waitingNode = $('[data-ms-waiting]');
  const activeNode = $('[data-ms-active]');
  const errorNode = $('[data-ms-error]');
  const orderNode = $('[data-ms-order]');
  const progressNode = $('[data-ms-progress]');
  const cameraNode = $('[data-ms-camera]');
  const video = $('[data-ms-video]');
  const cameraMsg = $('[data-ms-camera-msg]');
  const cameraText = $('[data-ms-camera-text]');
  const startCameraButton = $('[data-ms-start-camera]');
  const permissionBox = $('[data-ms-camera-permission]');
  const allowCameraButton = $('[data-ms-allow-camera]');
  const resultNode = $('[data-ms-result]');
  const resultTitle = $('[data-ms-result-title]');
  const resultDetail = $('[data-ms-result-detail]');
  const itemsNode = $('[data-ms-items]');
  const manualForm = $('[data-ms-manual]');
  const manualInput = $('[data-ms-manual-input]');
  const installNode = $('[data-ms-install]');
  const installButton = $('[data-ms-install-button]');
  const installDismiss = $('[data-ms-install-dismiss]');
  const installText = $('[data-ms-install-text]');
  const installIos = $('[data-ms-install-ios]');
  const installMenu = $('[data-ms-install-menu]');
  const installDismissKey = 'jg-mobile-scanner-install-dismissed-at';

  let session = '';
  let pollTimer = 0;
  let polling = false;
  let pollController = null;
  let knownSignature = '';
  let currentSummary = null;
  let stream = null;
  let detector = null;
  let zxingReader = null;
  let detectTimer = 0;
  let cameraStarting = false;
  let lastCode = '';
  let lastCodeAt = 0;
  let lastAnyAt = 0;
  let lastStatusSeq = -1;
  let wakeLock = null;
  let audioContext = null;
  let installPrompt = null;
  let installOffered = false;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const setError = (message) => {
    errorNode.textContent = message;
    errorNode.hidden = !message;
  };

  const setResult = (title, detail, tone = 'info') => {
    resultNode.hidden = !title;
    resultTitle.textContent = title;
    resultDetail.textContent = detail;
    resultNode.classList.toggle('is-ok', tone === 'ok');
    resultNode.classList.toggle('is-error', tone === 'error');
  };

  // Feedback ------------------------------------------------------------------
  const unlockAudio = () => {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!audioContext) audioContext = new Context();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  };

  const beep = (frequencies, duration = 0.16) => {
    const context = unlockAudio();
    if (!context) return;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(context.destination);
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.05);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.05);
      oscillator.stop(now + duration + 0.02);
    });
  };

  const vibrate = (pattern) => {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_error) { /* Optional. */ }
  };

  const keepAwake = async () => {
    if (!navigator.wakeLock?.request || wakeLock || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_error) {
      wakeLock = null;
    }
  };

  // Server --------------------------------------------------------------------
  const api = async (method, body = null, options = {}) => {
    const query = new URLSearchParams({ action: 'phone_state', wait: String(options.wait || 0), known: options.known || '' });
    const response = await fetch(method === 'GET' ? `${endpoint}?${query}` : endpoint, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: options.signal,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (response.status === 401) {
      window.location.href = '../?return=mobile-scanner/';
      throw new Error('Signed out.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false && payload.error) {
      throw new Error(payload.error || 'Mobile scanner is unavailable.');
    }
    return payload;
  };

  // Camera --------------------------------------------------------------------
  const showCameraMessage = (text, buttonLabel = '') => {
    cameraText.textContent = text;
    startCameraButton.textContent = buttonLabel || 'Turn on camera';
    startCameraButton.hidden = !buttonLabel;
    cameraMsg.hidden = false;
  };

  const stopCamera = () => {
    window.clearTimeout(detectTimer);
    detectTimer = 0;
    if (zxingReader) {
      try { zxingReader.reset(); } catch (_error) { /* Already stopped. */ }
      zxingReader = null;
    }
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) video.srcObject = null;
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && window.ZXing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load the barcode reader. Check the phone connection.'));
    document.head.appendChild(script);
  });

  const nativeDetector = async () => {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code'];
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = wanted.filter((format) => supported.includes(format));
      return formats.length ? new window.BarcodeDetector({ formats }) : null;
    } catch (_error) {
      return null;
    }
  };

  const detectLoop = async () => {
    detectTimer = 0;
    if (!stream || !detector) return;
    if (video.readyState >= 2) {
      try {
        const codes = await detector.detect(video);
        if (codes.length) onBarcode(codes[0].rawValue);
      } catch (_error) {
        // Frame not ready; try the next one.
      }
    }
    if (stream) detectTimer = window.setTimeout(detectLoop, 120);
  };

  const startCamera = async () => {
    if (stream || cameraStarting || !session) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showCameraMessage('This browser cannot open the camera. Use Chrome on Android or Safari on iPhone.');
      return;
    }
    cameraStarting = true;
    showCameraMessage('Opening camera…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      permissionBox.hidden = true;
      if (!session) { stopCamera(); return; }
      detector = detector || await nativeDetector();
      if (detector) {
        video.srcObject = stream;
        await video.play().catch(() => {});
        detectLoop();
      } else {
        await loadScript(zxingUrl);
        zxingReader = new window.ZXing.BrowserMultiFormatReader();
        zxingReader.decodeFromStream(stream, video, (result) => {
          if (result) onBarcode(result.getText());
        }).catch(() => {});
      }
      cameraMsg.hidden = true;
      keepAwake();
    } catch (error) {
      stopCamera();
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      showCameraMessage(
        denied ? 'Camera access is blocked. Allow the camera for this site in the browser settings, then tap below.' : (error?.message || 'Unable to open the camera.'),
        'Try again'
      );
    } finally {
      cameraStarting = false;
    }
  };

  // Scanning ------------------------------------------------------------------
  // Same barcode -> SKU rule as the computer's scan page.
  const skuFromBarcode = (value) => {
    const barcode = String(value || '').trim().toUpperCase();
    const sku = barcode.slice(0, -1);
    return /^\d{11}$/.test(sku) ? `0${sku}` : sku;
  };

  const sendCode = async (code) => {
    if (!session) return;
    // Show the matching product immediately; the computer's verdict follows.
    const sku = skuFromBarcode(code);
    const upper = code.trim().toUpperCase();
    const match = (currentSummary?.items || []).find((item) => {
      const itemCode = String(item.code || '').toUpperCase();
      return itemCode && (itemCode === sku || itemCode === upper);
    });
    setResult(match ? match.name || match.code : `Read ${code}`, 'Checking with the computer…');
    try {
      const payload = await api('POST', { action: 'scan', session, code });
      if (!payload.active) {
        setResult('Order closed', 'This order is no longer open on the computer.', 'error');
        pollNow({ restart: true });
      }
    } catch (error) {
      setResult('Not sent', error.message || 'Scan again.', 'error');
      vibrate([90, 60, 90]);
    }
  };

  const onBarcode = (raw) => {
    const code = String(raw || '').trim();
    if (!code || !session) return;
    const now = Date.now();
    // Cameras read the same label many times per second. One scan per item:
    // the same code must leave the view for 0.9 s, any code needs 0.3 s.
    if (code === lastCode && now - lastCodeAt < 900) { lastCodeAt = now; return; }
    if (now - lastAnyAt < 300) return;
    lastCode = code;
    lastCodeAt = now;
    lastAnyAt = now;
    cameraNode.classList.add('is-hit');
    window.setTimeout(() => cameraNode.classList.remove('is-hit'), 250);
    beep([1040, 1560]);
    vibrate(120);
    sendCode(code);
  };

  // Session state -------------------------------------------------------------
  const renderSummary = (summary) => {
    if (!summary) return;
    currentSummary = summary;
    progressNode.textContent = `${summary.scanned || 0}/${summary.required || 0}`;
    itemsNode.innerHTML = (summary.items || []).map((item) => {
      const done = item.required > 0 && item.scanned >= item.required;
      return `<li class="${done ? 'is-done' : ''}"><span>${escapeHtml(item.name || item.code)}<small>${escapeHtml(item.code)}</small></span><b>${item.scanned}/${item.required}</b></li>`;
    }).join('');
    const status = summary.status || {};
    // Only scan outcomes (accepted / problem) are shown; routine computer
    // status lines would just take up space.
    // The first status seen for an order is from before the phone joined, so
    // it is only remembered, not shown.
    if (status.seq !== lastStatusSeq) {
      const isNew = lastStatusSeq !== -1;
      lastStatusSeq = status.seq;
      if (isNew && status.title && (status.tone === 'ok' || status.tone === 'error')) {
        setResult(status.title, status.detail || '', status.tone);
        if (status.tone === 'error') {
          beep([330, 220], 0.32);
          vibrate([200, 80, 200, 80, 200]);
        }
      }
    }
  };

  const applyState = (state) => {
    const active = Boolean(state.active && state.session);
    if (!active) {
      if (session) {
        session = '';
        stopCamera();
        lastStatusSeq = -1;
      }
      activeNode.hidden = true;
      waitingNode.hidden = false;
      renderInstall();
      return;
    }
    if (state.session !== session) {
      session = state.session;
      lastStatusSeq = -1;
      lastCode = '';
      setResult('', '');
      vibrate(60);
    }
    waitingNode.hidden = true;
    activeNode.hidden = false;
    renderInstall();
    orderNode.textContent = state.order_id || 'Order';
    renderSummary(state.summary);
    startCamera();
  };

  const schedulePoll = (delay) => {
    window.clearTimeout(pollTimer);
    if (document.visibilityState !== 'visible') return;
    pollTimer = window.setTimeout(pollNow, delay);
  };

  // The server holds this request open until something changes (new order,
  // new result) or 10 s pass, so updates arrive immediately.
  async function pollNow(options = {}) {
    if (options.restart && pollController) pollController.abort();
    if (polling && !options.restart) return;
    polling = true;
    const controller = new AbortController();
    pollController = controller;
    let failed = false;
    try {
      const state = await api('GET', null, {
        wait: options.restart ? 0 : 10,
        known: options.restart ? '' : knownSignature,
        signal: controller.signal
      });
      if (pollController !== controller) return;
      knownSignature = String(state.signature || '');
      applyState(state);
      setError('');
    } catch (error) {
      if (controller.signal.aborted) return;
      failed = true;
      setError(error.message || 'Connection lost. Retrying…');
    } finally {
      if (pollController === controller) {
        pollController = null;
        polling = false;
        schedulePoll(failed ? 1500 : 0);
      }
    }
  }

  // Ask for camera access once while waiting, so the camera can open by
  // itself when the first order arrives.
  const checkPermission = async () => {
    try {
      const status = await navigator.permissions?.query({ name: 'camera' });
      permissionBox.hidden = !status || status.state === 'granted';
      status?.addEventListener?.('change', () => { permissionBox.hidden = status.state === 'granted'; });
    } catch (_error) {
      permissionBox.hidden = false;
    }
  };

  allowCameraButton.addEventListener('click', async () => {
    unlockAudio();
    try {
      const test = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      test.getTracks().forEach((track) => track.stop());
      permissionBox.hidden = true;
    } catch (_error) {
      setError('Camera access is blocked. Allow the camera for this site in the browser settings.');
    }
  });

  startCameraButton.addEventListener('click', () => {
    unlockAudio();
    startCamera();
  });

  manualForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = manualInput.value.trim();
    if (!code) return;
    manualInput.value = '';
    manualInput.blur();
    sendCode(code);
  });

  // Any tap unlocks sound on phones that block audio until the user interacts.
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      keepAwake();
      pollNow({ restart: true });
    } else {
      window.clearTimeout(pollTimer);
      if (pollController) pollController.abort();
      pollController = null;
      polling = false;
      stopCamera();
    }
  });
  window.addEventListener('pagehide', stopCamera);

  // Home screen app ---------------------------------------------------------
  const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installDismissedRecently = () => {
    try {
      const at = Number(window.localStorage.getItem(installDismissKey) || 0);
      return Date.now() - at < 7 * 24 * 60 * 60 * 1000;
    } catch (_error) {
      return false;
    }
  };

  function renderInstall() {
    installNode.hidden = !installOffered || Boolean(session) || isInstalled() || installDismissedRecently();
  }

  const offerInstall = (mode) => {
    installOffered = true;
    installButton.hidden = mode !== 'prompt';
    installIos.hidden = mode !== 'ios';
    installMenu.hidden = mode !== 'menu';
    installText.hidden = mode === 'ios' || mode === 'menu';
    renderInstall();
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    offerInstall('prompt');
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installNode.hidden = true;
  });

  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    if (choice?.outcome !== 'accepted') offerInstall('menu');
    else installNode.hidden = true;
  });

  installDismiss.addEventListener('click', () => {
    try { window.localStorage.setItem(installDismissKey, String(Date.now())); } catch (_error) { /* Optional. */ }
    installNode.hidden = true;
  });

  if (!isInstalled()) {
    if (isIos()) {
      offerInstall('ios');
    } else {
      // Browsers without an install prompt still have "Add to Home screen".
      window.setTimeout(() => { if (!installPrompt) offerInstall('menu'); }, 2500);
    }
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }

  checkPermission();
  keepAwake();
  pollNow();
});

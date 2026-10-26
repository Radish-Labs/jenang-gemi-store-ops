// Shared phone camera barcode reader (remote scanner page and phone scan page).
// Android Chrome uses the built-in BarcodeDetector; other browsers (iPhone
// Safari) load ZXing. Reports one read per item: the same barcode must leave
// the view for 0.9 s, and any two reads are at least 0.3 s apart.
(() => {
  const zxingUrl = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  let audioContext = null;
  let wakeLock = null;

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

  const loadZxing = () => new Promise((resolve, reject) => {
    if (window.ZXing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = zxingUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load the barcode reader. Check the phone connection.'));
    document.head.appendChild(script);
  });

  let nativeDetectorPromise = null;
  const nativeDetector = () => {
    if (!nativeDetectorPromise) {
      nativeDetectorPromise = (async () => {
        if (!('BarcodeDetector' in window)) return null;
        try {
          const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code'];
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = wanted.filter((format) => supported.includes(format));
          return formats.length ? new window.BarcodeDetector({ formats }) : null;
        } catch (_error) {
          return null;
        }
      })();
    }
    return nativeDetectorPromise;
  };

  /**
   * @param {{video: HTMLVideoElement, onCode: (code: string) => void, onState?: (state: string, message?: string) => void}} options
   * onState receives 'opening', 'on', 'off', or 'error' with a message.
   */
  const create = ({ video, onCode, onState = () => {} }) => {
    let stream = null;
    let zxingReader = null;
    let detectTimer = 0;
    let starting = false;
    let wanted = false;
    let lastCode = '';
    let lastCodeAt = 0;
    let lastAnyAt = 0;

    const read = (raw) => {
      const code = String(raw || '').trim();
      if (!code) return;
      const now = Date.now();
      if (code === lastCode && now - lastCodeAt < 900) { lastCodeAt = now; return; }
      if (now - lastAnyAt < 300) return;
      lastCode = code;
      lastCodeAt = now;
      lastAnyAt = now;
      beep([1040, 1560]);
      vibrate(120);
      onCode(code);
    };

    const stop = () => {
      wanted = false;
      window.clearTimeout(detectTimer);
      detectTimer = 0;
      if (zxingReader) {
        try { zxingReader.reset(); } catch (_error) { /* Already stopped. */ }
        zxingReader = null;
      }
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
      if (video) video.srcObject = null;
      onState('off');
    };

    const start = async () => {
      wanted = true;
      if (stream || starting) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        onState('error', 'This browser cannot open the camera. Use Chrome on Android or Safari on iPhone.');
        return;
      }
      starting = true;
      onState('opening');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (!wanted) { stop(); return; }
        const detector = await nativeDetector();
        if (detector) {
          video.srcObject = stream;
          await video.play().catch(() => {});
          const loop = async () => {
            detectTimer = 0;
            if (!stream) return;
            if (video.readyState >= 2) {
              try {
                const codes = await detector.detect(video);
                if (codes.length) read(codes[0].rawValue);
              } catch (_error) {
                // Frame not ready; try the next one.
              }
            }
            if (stream) detectTimer = window.setTimeout(loop, 120);
          };
          loop();
        } else {
          await loadZxing();
          if (!stream) return;
          zxingReader = new window.ZXing.BrowserMultiFormatReader();
          zxingReader.decodeFromStream(stream, video, (result) => {
            if (result) read(result.getText());
          }).catch(() => {});
        }
        onState('on');
        keepAwake();
      } catch (error) {
        const keep = wanted;
        stop();
        wanted = keep;
        const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        onState('error', denied
          ? 'Camera access is blocked. Allow the camera for this site in the browser settings, then tap below.'
          : (error?.message || 'Unable to open the camera.'));
      } finally {
        starting = false;
      }
    };

    return { start, stop, isOn: () => Boolean(stream), forget: () => { lastCode = ''; } };
  };

  document.addEventListener('pointerdown', unlockAudio, { once: true });
  window.JGCameraScanner = { create, beep, vibrate, unlockAudio, keepAwake };
})();

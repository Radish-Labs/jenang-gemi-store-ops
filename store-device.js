// Is this Store Ops screen a phone (camera scanning, prints on the packing
// computer) or a computer (USB scanner and printer)? Phones are detected by a
// touch screen whose short side is at most 600 px. Override per device with
// localStorage 'jg-store-device' = 'phone' or 'computer'.
window.JGStoreDevice = {
  isPhone() {
    try {
      const forced = window.localStorage.getItem('jg-store-device');
      if (forced === 'phone') return true;
      if (forced === 'computer') return false;
    } catch (_error) {
      // Fall back to detection.
    }
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const shortSide = Math.min(window.screen?.width || 9999, window.screen?.height || 9999);
    return Boolean(coarse && shortSide <= 600);
  }
};

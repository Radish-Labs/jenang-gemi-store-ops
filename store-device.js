// Is this Store Ops screen a phone (camera scanning, prints on the packing
// computer) or a computer (USB scanner and printer)? theme-init.php decides
// early and stores it on <html data-device>; see there for the rule.
window.JGStoreDevice = {
  isPhone() {
    const decided = document.documentElement.dataset.device;
    if (decided) return decided === 'phone';
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

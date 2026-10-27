// On a phone, Settings only shows what a phone uses (theme, platform colors).
// The USB scanner and the print helper are set up on the packing computer.
document.addEventListener('DOMContentLoaded', () => {
  if (document.documentElement.dataset.device !== 'phone') return;
  const modal = document.querySelector('[data-store-settings-modal]');
  const panels = modal?.querySelector('.admin-settings-panels');
  if (!modal || !panels) return;

  // Pages whose Settings only has computer tabs: nothing to set on a phone.
  const phoneTabs = modal.querySelectorAll('[data-settings-tab]:not([data-settings-tab="scanner"]):not([data-settings-tab="printer"])');
  if (!phoneTabs.length) {
    document.querySelectorAll('[data-open-store-settings]').forEach((button) => { button.hidden = true; });
    return;
  }

  const note = document.createElement('p');
  note.className = 'admin-settings-phone-note';
  note.textContent = 'The barcode scanner and the label printer are set up in Settings on the packing computer.';
  panels.appendChild(note);

  const computerOnly = ['scanner', 'printer'];
  const showPhoneTab = () => {
    if (modal.hidden) return;
    const active = modal.querySelector('[data-settings-tab].is-active');
    if (!active || computerOnly.includes(active.dataset.settingsTab)) {
      phoneTabs[0].click();
    }
  };
  new MutationObserver(showPhoneTab).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
});

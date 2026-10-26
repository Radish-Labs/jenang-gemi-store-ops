// Compact check-off list of the products to scan (scan page and phone).
// items: [{ key, name, code, scanned, required, skipped, note, soldOut }]
window.JGScanChecklist = (() => {
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

  const render = (items, options = {}) => {
    const flashKey = options.flashKey || '';
    if (!items.length) return `<p class="jg-checklist-empty">${escapeHtml(options.empty || 'No products to scan.')}</p>`;
    return `<ol class="jg-checklist">${items.map((item) => {
      const required = Math.max(0, Number(item.required || 0));
      const scanned = Math.min(required, Math.max(0, Number(item.scanned || 0)));
      const complete = required > 0 && scanned >= required;
      const progress = required > 0 ? scanned / required : 0;
      const pips = required > 1 && required <= 8
        ? `<span class="jg-check-pips" aria-hidden="true">${Array.from({ length: required }, (_unused, index) => `<i class="${index < scanned ? 'is-on' : ''}"></i>`).join('')}</span>`
        : '';
      const classes = ['jg-check', complete ? 'is-complete' : '', scanned > 0 && !complete ? 'is-partial' : '',
        item.soldOut ? 'is-sold-out' : '', flashKey && item.key === flashKey ? 'is-flash' : ''].filter(Boolean).join(' ');
      return `
        <li class="${classes}" aria-label="${escapeHtml(`${item.name}: ${scanned} of ${required} scanned`)}">
          <span class="jg-check-box" style="--jg-progress:${progress.toFixed(3)}">${complete ? check : ''}</span>
          <span class="jg-check-text">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.code)}${item.skipped ? ' · Skip Scan' : ''}</small>
            ${item.soldOut ? '<em class="jg-check-alert"><b>SOLD OUT</b> Stock is 0 · Update PO amount received</em>' : ''}
            ${item.note ? `<em class="jg-check-note">${escapeHtml(item.note)}</em>` : ''}
          </span>
          <span class="jg-check-count">${pips}<b>${scanned}<span>/${required}</span></b></span>
        </li>`;
    }).join('')}</ol>`;
  };

  return { render };
})();

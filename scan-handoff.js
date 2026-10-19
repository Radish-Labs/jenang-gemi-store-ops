window.JGStoreScanHandoff = {
  async load(params, endpoint) {
    const token = params.get('handoff');
    if (!token) return null; // Support scan tabs opened by older builds.
    const query = new URLSearchParams({ scan_handoff: token, order_id: params.get('order') || '' });
    const response = await fetch(`${endpoint}?${query}`, {
      credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000)
    });
    let payload;
    try { payload = await response.json(); } catch (_error) {
      throw new Error('Unable to load this order. Reload this page to retry.');
    }
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Unable to load this order. Reload this page to retry.');
    }
    if (String(payload.order?.id || '') !== params.get('order') || !Array.isArray(payload.order?.items)) {
      throw new Error('Order details do not match. Return to the board and start the order again.');
    }
    return payload.order;
  }
};

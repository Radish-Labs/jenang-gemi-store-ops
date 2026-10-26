(function exposeStoreOrderPresentation(global) {
  const normalizedSourceKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  const requiredMarketplaceSources = new Set([
    'shopee:jenang-gemi-shopee',
    'shopee:zero-shopee',
    'tiktok:jenang-gemi-tiktok',
    'tiktok:zero-tiktok'
  ]);
  const isRequiredMarketplaceSourceError = (value) => {
    const match = String(value || '').trim().toLowerCase().match(/^(shopee|tiktok):([^:]+):/);
    return Boolean(match && requiredMarketplaceSources.has(`${match[1]}:${match[2]}`));
  };
  const normalizedMarketplaceStatus = (order) => String(
    order?.marketplaceStatus || order?.marketplace_status || order?.orderStatus || order?.order_status || ''
  ).trim().toUpperCase();
  const sourceLabelFromOrder = (order) => {
    const platform = normalizedSourceKey(order?.platform || '');
    const account = String(order?.account || '').trim();
    const accountKey = String(order?.sourceAccountKey || order?.account_key || '').trim();
    if (platform === 'whatsapp') return 'Whatsapp';
    if (platform === 'partner') {
      const partnerName = String(order?.partnerName || order?.partner_name || '').trim();
      const partnerCode = String(order?.partnerCode || order?.partner_code || '').trim();
      if (partnerName) return partnerName;
      if (account && account.toLowerCase() !== 'partner') return account;
      if (partnerCode) return partnerCode;
    }
    if (accountKey === 'jenang-gemi-shopee') return 'JG Shopee';
    if (accountKey === 'zero-shopee') return 'ZERO Shopee';
    if (accountKey === 'zfit-shopee') return 'ZFIT Shopee';
    if (accountKey === 'jenang-gemi-tiktok') return 'JG TikTok';
    if (accountKey === 'zero-tiktok') return 'ZERO TikTok';
    if (accountKey === 'zfit-tiktok') return 'ZFIT TikTok';
    if (account) return account;
    return accountKey || String(order?.platform || 'Source');
  };
  const isMarketplaceShipmentArranged = (order) => {
    if (order?.shipmentArranged || order?.shipment_arranged || order?.labelBacked || order?.label_backed) return true;
    return ['PROCESSED', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'SHIPPED', 'DELIVERED', 'COMPLETED']
      .includes(normalizedMarketplaceStatus(order));
  };
  const isDelayedMarketplaceOrder = (order) => {
    const platform = String(order?.platform || '').trim().toLowerCase();
    const deadlineType = String(order?.deadlineType || order?.deadline_type || '').trim().toLowerCase();
    const deadlineSource = String(order?.deadlineSource || order?.deadline_source || '').trim().toLowerCase();
    const arrangementState = String(order?.shopeeArrangementState || order?.shopee_arrangement_state || '')
      .trim()
      .toLowerCase();
    const arrangementError = String(order?.shopeeArrangementError || order?.shopee_arrangement_error || '')
      .trim()
      .toLowerCase();
    return platform === 'shopee'
      && !isMarketplaceShipmentArranged(order)
      && (deadlineType === 'estimated' || deadlineSource === 'created_plus_24h')
      && arrangementState === 'failed'
      && arrangementError.includes('shipping parameters can only be obtained when package is ready to be shipped');
  };
  const normalizeDeadline = (order, now = Date.now()) => {
    const deadlineAt = Number(order?.deadlineAt || order?.deadline_at || 0);
    const deadlineType = String(order?.deadlineType || order?.deadline_type || 'deadline');
    const deadlineLabel = String(order?.deadlineLabel || order?.deadline_label || 'Deadline');
    const deadlineSource = String(order?.deadlineSource || order?.deadline_source || '');
    const platform = String(order?.platform || '').trim().toLowerCase();
    const preArrangementDeadline = ['ship_by', 'ship_by_date', 'shipping_due', 'arrange_by', 'arrange_due', 'handover_fallback']
      .includes(deadlineType.trim().toLowerCase())
      || ['ship_by_date', 'shipping_due_time', 'rts_sla_time'].includes(deadlineSource.trim().toLowerCase());
    const deadlineSatisfied = ['shopee', 'tiktok'].includes(platform)
      && isMarketplaceShipmentArranged(order)
      && preArrangementDeadline;
    const deadlineDelayed = isDelayedMarketplaceOrder(order);
    return {
      deadlineAt: Number.isFinite(deadlineAt) && deadlineAt > 0 ? deadlineAt : now + 86400000,
      deadlineType,
      deadlineLabel: deadlineSatisfied || deadlineDelayed ? '' : deadlineLabel,
      deadlineSatisfied,
      deadlineDelayed
    };
  };

  const minutesRemaining = (order, now = Date.now()) => Math.ceil((Number(order?.deadlineAt || 0) - now) / 60000);
  const isCriticalOrder = (order, now = Date.now()) => !order?.deadlineSatisfied
    && !order?.deadlineDelayed
    && Number(order?.deadlineAt || 0) - now < 60 * 60000;
  const shouldSoundSiren = (order, now = Date.now()) => {
    if (order?.deadlineSatisfied || order?.deadlineDelayed) return false;
    const thresholdMs = order?.instant ? 2 * 60 * 60000 : 60 * 60000;
    const remainingMs = Number(order?.deadlineAt || 0) - now;
    return remainingMs > 0 && remainingMs < thresholdMs;
  };
  const formatDeadline = (order, now = Date.now()) => {
    if (order?.deadlineDelayed || isDelayedMarketplaceOrder(order)) return 'Delayed';
    if (order?.deadlineSatisfied) {
      const hours = Math.max(0, Math.ceil((Number(order?.deadlineAt || 0) - now) / 3600000));
      return `${hours}h`;
    }
    const minutes = minutesRemaining(order, now);
    if (minutes <= 0) return 'Overdue';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  };

  const normalizeHandoverMethod = (order) => {
    const value = String(order?.handoverMethod || order?.handover_method || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (value === 'DROPOFF') return 'DROP_OFF';
    return ['PICKUP', 'DROP_OFF'].includes(value) ? value : '';
  };
  const isDropOff = (order) => normalizeHandoverMethod(order) === 'DROP_OFF';
  const isCancellationRequested = (order) => {
    if (Boolean(order?.cancellationRequested || order?.cancellation_requested)) return true;
    const status = String(order?.marketplaceStatus || order?.marketplace_status || order?.orderStatus || order?.order_status || '')
      .trim()
      .toUpperCase();
    return ['IN_CANCEL', 'CANCEL_REQUESTED', 'CANCELLATION_REQUESTED', 'CANCEL_PENDING', 'CANCELLATION_PENDING'].includes(status);
  };
  const requiresManualInstantArrangement = (order) => {
    if (!order?.instant) return false;
    if (order?.manualArrangementRequired || order?.manual_arrangement_required) return true;
    return !isMarketplaceShipmentArranged(order);
  };
  const isInstantManualLifecycle = (order) => {
    if (!order?.instant) return false;
    if (requiresManualInstantArrangement(order)) return true;
    const state = String(order?.instantArrangementState || order?.instant_arrangement_state || '').trim().toLowerCase();
    return ['display_only', 'required', 'requested', 'retry', 'label_pending', 'failed', 'big_set_off'].includes(state);
  };
  const instantArrangementAction = (order, { enabled = true, locked = false, submitting = false } = {}) => {
    const state = String(order?.instantArrangementState || '').trim().toLowerCase();
    const error = String(order?.instantArrangementError || '').trim();
    return {
      disabled: !enabled || locked || submitting,
      label: !enabled ? 'Big Set locked' : (submitting ? 'Arranging…'
        : (state === 'label_pending' ? 'Retry label'
          : (['requested', 'retry', 'failed'].includes(state) || error ? 'Retry arrange' : 'Accept + arrange'))),
      error
    };
  };
  const formatHandoverSlot = (order) => {
    const supplied = String(order?.handoverSlotLabel || order?.handover_slot_label || '').trim();
    if (supplied) return supplied;
    const start = new Date(order?.handoverScheduledStartAt || order?.handover_scheduled_start_at || '');
    if (Number.isNaN(start.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta'
    }).format(start);
  };
  const filterOrdersByHandover = (orders, dropOffOnly = false) => {
    const rows = Array.isArray(orders) ? orders : [];
    return dropOffOnly ? rows.filter((order) => isDropOff(order)) : rows.slice();
  };
  const shouldShowOrderLoading = (snapshotReady) => !snapshotReady;
  const columnFirstBoardFlow = (orderCount, boardWidth, options = {}) => {
    const count = Math.max(0, Number(orderCount) || 0);
    const width = Math.max(0, Number(boardWidth) || 0);
    const minimumCardWidth = Math.max(1, Number(options.minimumCardWidth) || 190);
    const gap = Math.max(0, Number(options.gap) || 8);
    const minimumRows = Math.max(1, Number(options.minimumRows) || 6);
    const columns = Math.max(1, Math.floor((width + gap) / (minimumCardWidth + gap)));
    return {
      columns,
      rows: Math.max(minimumRows, Math.ceil(count / columns) || 1)
    };
  };
  const sortOrdersByUrgency = (orders) => (Array.isArray(orders) ? orders : [])
    .slice()
    .sort((a, b) => Number(Boolean(b?.instant)) - Number(Boolean(a?.instant))
      || Number(Boolean(b?.weekendDependent)) - Number(Boolean(a?.weekendDependent))
      || Number(Boolean(a?.deadlineDelayed)) - Number(Boolean(b?.deadlineDelayed))
      || Number(a?.deadlineAt || Number.MAX_SAFE_INTEGER) - Number(b?.deadlineAt || Number.MAX_SAFE_INTEGER));
  const canCurrentEmployeeUnclaim = (order, currentEmployeeId) => {
    const claimant = String(order?.claimedBy || order?.claimed_by || '').trim();
    const employeeId = String(currentEmployeeId || '').trim();
    const status = String(order?.fulfillmentStatus || order?.fulfillment_status || order?.status || '').trim().toUpperCase();
    return claimant !== '' && employeeId !== '' && claimant === employeeId && status !== 'FULFILLED';
  };
  const canCurrentEmployeeRemove = (currentEmployeeId) => String(currentEmployeeId || '').trim().toLowerCase() === 'branch-vincent';
  const canOpenOrderContextMenu = (order, currentEmployeeId) => canCurrentEmployeeUnclaim(order, currentEmployeeId)
    || canCurrentEmployeeRemove(currentEmployeeId);
  const previewActionState = (order, context = {}) => {
    const platform = String(order?.platform || '').trim().toLowerCase();
    const pausedUnarranged = Boolean(context.automaticArrangementPaused)
      && ['shopee', 'tiktok'].includes(platform)
      && !order?.labelBacked;
    const claimedBySelf = Boolean(order?.claimedBy && order.claimedBy === context.currentEmployeeId);

    if (isCancellationRequested(order)) {
      return {
        disabled: true,
        label: 'Cannot start this order',
        note: `Cancellation requested — do not process. Resolve it in ${String(order?.platform || 'the marketplace')}.`
      };
    }
    if (isInstantManualLifecycle(order) && !order?.labelBacked) {
      return {
        disabled: true,
        label: 'Shipment arrangement required',
        note: 'Accept and arrange the shipment from the order card before starting fulfillment.'
      };
    }
    if (pausedUnarranged) {
      return {
        disabled: true,
        label: 'Shipment not arranged',
        note: 'Automatic arrangement is paused. Arrange this order in the marketplace first.'
      };
    }
    if (order?.locked && order?.currentEmployeeCanWork === false) {
      return {
        disabled: true,
        label: 'Order is locked',
        note: order?.claimedByName
          ? `${order.claimedByName} is currently working on this order.`
          : 'Another operator is currently working on this order.'
      };
    }
    return {
      disabled: false,
      label: order?.claimStale ? 'Reclaim order' : (claimedBySelf ? 'Resume order' : 'Start order'),
      note: claimedBySelf
        ? 'Continue to the product pick list.'
        : 'Starting claims this order and opens the product pick list.'
    };
  };

  global.JGStoreOrderPresentation = Object.freeze({
    normalizeDeadline,
    isMarketplaceShipmentArranged,
    isDelayedMarketplaceOrder,
    minutesRemaining,
    isCriticalOrder,
    shouldSoundSiren,
    formatDeadline,
    normalizeHandoverMethod,
    isDropOff,
    isCancellationRequested,
    requiresManualInstantArrangement,
    isInstantManualLifecycle,
    instantArrangementAction,
    formatHandoverSlot,
    filterOrdersByHandover,
    shouldShowOrderLoading,
    columnFirstBoardFlow,
    sortOrdersByUrgency,
    canCurrentEmployeeUnclaim,
    canCurrentEmployeeRemove,
    canOpenOrderContextMenu,
    previewActionState,
    sourceLabelFromOrder,
    isRequiredMarketplaceSourceError
  });
})(typeof window !== 'undefined' ? window : globalThis);

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-store-home]');
  if (!root) return;
  const orderPresentation = window.JGStoreOrderPresentation;
  if (!orderPresentation) throw new Error('Store order deadline presentation is unavailable.');

  const adminThemes = ['dark', 'light', 'system'];
  const legacyThemeMap = {
    graphite: 'dark',
    glass: 'light',
    ivory: 'light',
    prism: 'dark'
  };

  const board = document.querySelector('[data-order-board]');
  const modal = document.querySelector('[data-fulfillment-modal]');
  const modalTitle = document.querySelector('[data-modal-title]');
  const modalStepLabel = document.querySelector('[data-modal-step-label]');
  const previewStage = document.querySelector('[data-order-preview]');
  const pickStage = document.querySelector('[data-pick-stage]');
  const orderSummary = document.querySelector('[data-order-summary]');
  const pickList = document.querySelector('[data-pick-list]');
  const listedCount = document.querySelector('[data-listed-count]');
  const productsLeftCount = document.querySelector('[data-products-left-count]');
  const criticalCount = document.querySelector('[data-critical-count]');
  const startedCount = document.querySelector('[data-started-count]');
  const fulfillingCount = document.querySelector('[data-fulfilling-count]');
  const boardDensity = document.querySelector('[data-board-density]');
  const boardOverflow = document.querySelector('[data-board-overflow]');
  const boardClock = document.querySelector('[data-board-clock]');
  const dropOffFilter = document.querySelector('[data-dropoff-filter]');
  const automationPauseNotice = document.querySelector('[data-automation-pause-notice]');
  const automationPauseTitle = document.querySelector('[data-automation-pause-title]');
  const automationPauseCopy = document.querySelector('[data-automation-pause-copy]');
  const orderContextMenu = document.querySelector('[data-order-context-menu]');
  const unclaimOrderButton = document.querySelector('[data-unclaim-order]');
  const removeOrderButton = document.querySelector('[data-remove-order]');
  const removeOrderModal = document.querySelector('[data-remove-order-modal]');
  const removeOrderForm = document.querySelector('[data-remove-order-form]');
  const removeOrderId = document.querySelector('[data-remove-order-id]');
  const removeOrderStockAudit = document.querySelector('[data-remove-order-stock-audit]');
  const removeOrderSkuMapping = document.querySelector('[data-remove-sku-mapping]');
  const removeOrderSkuMappingSummary = document.querySelector('[data-remove-sku-mapping-summary]');
  const removeOrderSkuMappingList = document.querySelector('[data-remove-sku-mapping-list]');
  const removeOrderSkuOptions = document.querySelector('[data-remove-sku-options]');
  const removeOrderError = document.querySelector('[data-remove-order-error]');
  const removeOrderSubmit = document.querySelector('[data-remove-order-submit]');
  const shopeeArrangementModal = document.querySelector('[data-shopee-arrangement-modal]');
  const shopeeArrangementForm = document.querySelector('[data-shopee-arrangement-form]');
  const shopeeArrangementOrder = document.querySelector('[data-shopee-arrangement-order]');
  const shopeeArrangementOptions = document.querySelector('[data-shopee-arrangement-options]');
  const shopeeArrangementError = document.querySelector('[data-shopee-arrangement-error]');
  const shopeeArrangementSubmit = document.querySelector('[data-shopee-arrangement-submit]');
  const shopeeArrangementSubmitLabel = shopeeArrangementSubmit?.querySelector('span');
  const shopeeArrangementDemoMode = new URLSearchParams(window.location.search).get('shipping-ux-demo') === '1';
  const reprintModal = document.querySelector('[data-reprint-modal]');
  const reprintForm = document.querySelector('[data-reprint-form]');
  const reprintError = document.querySelector('[data-reprint-error]');
  const reprintResults = document.querySelector('[data-reprint-results]');
  const reprintSubmit = document.querySelector('[data-reprint-submit]');
  const settingsModal = document.querySelector('[data-store-settings-modal]');
  const settingsForm = document.querySelector('[data-store-settings-form]');
  const settingsError = document.querySelector('[data-store-settings-error]');
  const employeeProfilesModal = document.querySelector('[data-employee-profiles-modal]');
  const employeeProfileForm = document.querySelector('[data-employee-profile-form]');
  const employeeProfileError = document.querySelector('[data-employee-profile-error]');
  const employeeProfileList = document.querySelector('[data-employee-profile-list]');
  const sourceColorList = document.querySelector('[data-source-color-list]');
  const scannerTestScanButton = document.querySelector('[data-scanner-test-scan]');
  const scannerSelectButton = document.querySelector('[data-scanner-select]');
  const scannerSelectAction = document.querySelector('.admin-scanner-select-action');
  const selectedScannerNode = document.querySelector('[data-selected-scanner]');
  const scannerSummary = document.querySelector('[data-scanner-summary]');
  const scannerSummaryDot = document.querySelector('[data-scanner-summary-dot]');
  const settingsTitle = document.querySelector('[data-settings-title]');
  const settingsSaveLabel = document.querySelector('[data-settings-save-label]');
  const sidebarBackdrop = document.querySelector('[data-store-sidebar-backdrop]');
  const sidebarToggles = document.querySelectorAll('[data-store-sidebar-toggle]');
  const ordersStorageKey = 'jg-store-live-orders';
  const ordersStorageMetaKey = 'jg-store-live-orders-meta';
  const skuCatalogStorageKey = 'jg-store-sku-catalog';
  const printedOrderStorageKey = 'jg-store-printed-order-event';
  const activeOrderStorageKey = 'jg-store-active-order-id';
  const pendingCompletionQueueStorageKey = 'jg-store-pending-order-completions-v1';
  const themeStorageKey = 'jg-admin-theme';
  const legacySourceColorStorageKey = 'jg-store-source-colors';
  const sidebarStorageKey = 'jg-store-sidebar-expanded';
  const skuDbEndpoint = '../api/sku-db/';
  const ordersEndpoint = '../api/orders-v2/';
  const orderLookupEndpoint = '../api/order-lookup/';
  const employeeProfilesEndpoint = '../api/employees-v2/';
  const profileSettingsEndpoint = '../api/profile-settings/';
  const scanBridgeEndpoint = '../api/scan-bridge/';
  const scanSerialEndpoint = '../api/scan-serial/';
  const ordersRefreshIntervalMs = 15000;
  const ordersRefreshMinGapMs = 3500;
  const cachedStartupRefreshDelayMs = 0;
  const ordersStartupCacheMaxAgeMs = 60000;
  const clientCacheDbName = 'jg-store-ops-client-cache';
  const clientCacheStoreName = 'entries';
  const currentEmployee = {
    id: String(root.dataset.employeeId || 'shared-admin'),
    name: String(root.dataset.employeeName || 'Admin')
  };
  const sourceColorStorageKey = `${legacySourceColorStorageKey}:${currentEmployee.id}`;

  let skuCatalog = [];
  let partnerOrderSources = [];
  let employeeProfiles = [];
  let sourceColorMap = {};
  let sourceColorRevision = 0;
  let sourceColorSavesPending = 0;
  let sourceColorSaveChain = Promise.resolve();
  let scannerSettings = {
    baud_rate: 9600
  };
  let selectedScannerPort = null;
  let selectedScannerLabel = '';
  let selectedScannerVerified = false;
  let activeSettingsTab = 'scanner';
  let dropOffOnly = false;
  let bigSetEnabled = false;
  let automaticArrangementPaused = false;
  let orderSourceErrors = [];
  const startingOrderIds = new Set();
  const arrangingInstantOrderIds = new Set();
  const scannerBarcodeWaitSeconds = 6;
  const scannerBarcodeWaitMs = scannerBarcodeWaitSeconds * 1000;
  let state = {
    orders: [],
    previewOrderId: '',
    activeOrderId: '',
    scans: new Map()
  };
  let ordersRefreshPromise = null;
  let lastOrdersRefreshAt = 0;
  let ordersEtag = '';
  let ordersSnapshotReady = false;
  let skuCatalogRefreshPromise = null;
  let boardResizeTimer = 0;
  let clientCacheDbPromise = null;
  let reprintSearchTimer = 0;
  let reprintSearchController = null;
  let reprintSearchSequence = 0;
  let completionQueueFlushPromise = null;
  let reprintProfiles = [];
  let selectedReprintProfile = null;
  let shopeeArrangementOrderId = '';

  const sourceColorOptions = [
    { value: 'none', label: 'No color' },
    { value: 'aqua', label: 'Aqua' },
    { value: 'lime', label: 'Lime' },
    { value: 'amber', label: 'Amber' },
    { value: 'violet', label: 'Violet' },
    { value: 'rose', label: 'Rose' },
    { value: 'indigo', label: 'Indigo' },
    { value: 'slate', label: 'Slate' }
  ];

  const defaultSourceColors = {
    'jenang-gemi-shopee': 'aqua',
    'zero-shopee': 'lime'
  };

  const idleTask = (callback, timeout = 1200) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(callback, { timeout });
      return;
    }
    window.setTimeout(callback, 0);
  };

  const openClientCacheDb = () => {
    if (!window.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable.'));
    if (clientCacheDbPromise) return clientCacheDbPromise;
    clientCacheDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(clientCacheDbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(clientCacheStoreName)) {
          db.createObjectStore(clientCacheStoreName, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open Store Ops client cache.'));
      request.onblocked = () => reject(new Error('Store Ops client cache is blocked by another tab.'));
    });
    return clientCacheDbPromise;
  };

  const readClientCache = async (key) => {
    try {
      const db = await openClientCacheDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(clientCacheStoreName, 'readonly');
        const store = tx.objectStore(clientCacheStoreName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result?.value || null);
        request.onerror = () => reject(request.error || new Error('Unable to read Store Ops client cache.'));
      });
    } catch (_error) {
      return null;
    }
  };

  const writeClientCache = (key, value) => {
    idleTask(() => {
      openClientCacheDb()
        .then((db) => new Promise((resolve, reject) => {
          const tx = db.transaction(clientCacheStoreName, 'readwrite');
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('Unable to write Store Ops client cache.'));
          tx.objectStore(clientCacheStoreName).put({
            key,
            value,
            updatedAt: Date.now()
          });
        }))
        .catch(() => {});
    });
  };

  const normalizeSourceKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);

  const normalizeSourceColorMap = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.entries(value).reduce((colors, [sourceKey, color]) => {
      const key = normalizeSourceKey(sourceKey);
      const normalizedColor = String(color || '').trim();
      const namedColor = normalizedColor.toLowerCase();
      if (!key) return colors;
      if (sourceColorOptions.some((option) => option.value === namedColor)) {
        colors[key] = namedColor;
      } else if (/^#[0-9a-f]{6}$/i.test(normalizedColor)) {
        colors[key] = normalizedColor.toUpperCase();
      }
      return colors;
    }, {});
  };

  const readSourceColorMap = () => {
    try {
      const profileColors = window.localStorage.getItem(sourceColorStorageKey);
      const encoded = profileColors === null
        ? window.localStorage.getItem(legacySourceColorStorageKey)
        : profileColors;
      return normalizeSourceColorMap(JSON.parse(encoded || '{}'));
    } catch (_error) {
      return {};
    }
  };

  const cacheSourceColorMap = () => {
    try {
      window.localStorage.setItem(sourceColorStorageKey, JSON.stringify(sourceColorMap));
      window.localStorage.removeItem(legacySourceColorStorageKey);
    } catch (_error) {
      // Source colors are optional; keep fulfillment usable if storage is blocked.
    }
  };

  const reportSourceColorError = (error) => {
    if (!settingsError) return;
    const detail = error instanceof Error ? error.message : 'Unable to save platform colors.';
    settingsError.textContent = `Unable to sync platform colors for ${currentEmployee.name}. ${detail}`;
    settingsError.hidden = false;
  };

  const clearSourceColorError = () => {
    if (!settingsError || !settingsError.textContent.startsWith('Unable to sync platform colors')) return;
    settingsError.textContent = '';
    settingsError.hidden = true;
  };

  const saveSourceColorMap = () => {
    cacheSourceColorMap();
    const snapshot = { ...sourceColorMap };
    sourceColorSavesPending += 1;
    sourceColorSaveChain = sourceColorSaveChain
      .catch(() => {})
      .then(async () => {
        const response = await fetch(profileSettingsEndpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            action: 'save_source_colors',
            source_colors: snapshot
          })
        });
        const payload = await readJsonResponse(response, 'Unable to save platform colors.');
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || 'Unable to save platform colors.');
        }
        clearSourceColorError();
        return payload;
      })
      .finally(() => {
        sourceColorSavesPending = Math.max(0, sourceColorSavesPending - 1);
      });
    return sourceColorSaveChain;
  };

  const loadSourceColorMap = async () => {
    if (sourceColorSavesPending > 0) return sourceColorMap;
    const requestedAtRevision = sourceColorRevision;
    const response = await fetch(profileSettingsEndpoint, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const payload = await readJsonResponse(response, 'Unable to load platform colors.');
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Unable to load platform colors.');
    }
    if (sourceColorSavesPending > 0 || requestedAtRevision !== sourceColorRevision) {
      return sourceColorMap;
    }

    if (payload.has_preferences) {
      sourceColorMap = normalizeSourceColorMap(payload.source_colors);
      cacheSourceColorMap();
      renderSourceColorList();
      renderBoard();
      clearSourceColorError();
      return sourceColorMap;
    }

    // Migrate this profile's existing browser-only colors on its first global load.
    if (Object.keys(sourceColorMap).length > 0) {
      await saveSourceColorMap();
    }
    return sourceColorMap;
  };

  const sourceKeyFromOrder = (order) => {
    const platform = normalizeSourceKey(order?.platform || '');
    const accountKey = normalizeSourceKey(order?.sourceAccountKey || order?.account_key || '');
    if (accountKey) return accountKey;
    if (platform === 'partner') {
      const partnerCode = normalizeSourceKey(order?.partnerCode || order?.partner_code || order?.account || '');
      return `partner-${partnerCode || 'unknown'}`;
    }
    if (platform === 'zero_website') return 'zero_website';
    if (platform === 'jenang_gemi_website') return 'jenang_gemi_website';
    const account = normalizeSourceKey(order?.account || '');
    return account || platform || 'unknown';
  };

  const sourceLabelFromOrder = orderPresentation.sourceLabelFromOrder;

  const colorSettingForSource = (sourceKey) => {
    const configured = String(sourceColorMap[sourceKey] || '').trim();
    return configured || defaultSourceColors[sourceKey] || 'none';
  };

  const isCustomSourceColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());

  const colorForSource = (sourceKey) => {
    const setting = colorSettingForSource(sourceKey);
    return setting === 'none' ? '' : setting;
  };

  const detectOrderSources = () => {
    const sources = new Map([
      ['jenang-gemi-shopee', 'JG Shopee'],
      ['zero-shopee', 'ZERO Shopee'],
      ['zfit-shopee', 'ZFIT Shopee'],
      ['jenang-gemi-tiktok', 'JG TikTok'],
      ['zero-tiktok', 'ZERO TikTok'],
      ['zfit-tiktok', 'ZFIT TikTok']
      ,['zero_website', 'ZERO Website']
      ,['jenang_gemi_website', 'Jenang Gemi Website']
    ]);
    partnerOrderSources.forEach((source) => {
      const sourceKey = normalizeSourceKey(source.key || source.sourceKey || '');
      const label = String(source.label || source.name || '').trim();
      if (sourceKey && label) sources.set(sourceKey, label);
    });
    state.orders.forEach((order) => {
      const sourceKey = sourceKeyFromOrder(order);
      if (sourceKey && !sources.has(sourceKey)) {
        sources.set(sourceKey, sourceLabelFromOrder(order));
      }
    });
    return [...sources.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  };

  const renderSourceColorList = () => {
    if (!sourceColorList) return;
    const sources = detectOrderSources();
    sourceColorList.innerHTML = sources.length
      ? sources.map(([sourceKey, label]) => {
        const selectedColor = colorSettingForSource(sourceKey);
        const customColor = isCustomSourceColor(selectedColor) ? selectedColor.toUpperCase() : '#22D3EE';
        return `
          <div class="admin-source-color-row">
            <strong>${escapeHtml(label)}</strong>
            <div class="admin-source-color-swatches">
              ${sourceColorOptions.map((option) => `
                <button
                  type="button"
                  class="admin-source-color-btn ${selectedColor === option.value ? 'is-active' : ''}"
                  data-source-color-key="${escapeHtml(sourceKey)}"
                  data-source-color-value="${escapeHtml(option.value)}"
                  data-source-color="${escapeHtml(option.value)}"
                  title="${escapeHtml(option.label)}"
                  aria-label="${escapeHtml(label)} ${escapeHtml(option.label)}"
                  aria-pressed="${selectedColor === option.value ? 'true' : 'false'}"
                ></button>
              `).join('')}
              <label
                class="admin-source-color-custom ${isCustomSourceColor(selectedColor) ? 'is-active' : ''}"
                style="--source-swatch: ${escapeHtml(customColor)}"
                title="Custom color"
                aria-label="${escapeHtml(label)} custom color"
              >
                <span aria-hidden="true">+</span>
                <input
                  type="color"
                  value="${escapeHtml(customColor)}"
                  data-source-color-custom-key="${escapeHtml(sourceKey)}"
                  aria-label="Choose a custom color for ${escapeHtml(label)}"
                >
              </label>
            </div>
          </div>
        `;
      }).join('')
      : '<small>No order sources loaded yet.</small>';
  };

  sourceColorMap = readSourceColorMap();

  const compactSidebarQuery = window.matchMedia('(max-width: 760px)');

  const storedSidebarExpanded = () => {
    try {
      const stored = window.localStorage.getItem(sidebarStorageKey);
      return stored === null ? true : stored === '1';
    } catch (_error) {
      return true;
    }
  };

  const setSidebarExpanded = (expanded, { persist = !compactSidebarQuery.matches } = {}) => {
    const nextExpanded = Boolean(expanded);
    root.classList.toggle('is-sidebar-expanded', nextExpanded);
    sidebarToggles.forEach((button) => {
      button.setAttribute('aria-expanded', String(nextExpanded));
      button.setAttribute('aria-label', nextExpanded ? 'Collapse navigation' : 'Open navigation');
      button.title = nextExpanded ? 'Collapse navigation' : 'Open navigation';
    });
    if (sidebarBackdrop) sidebarBackdrop.hidden = !(compactSidebarQuery.matches && nextExpanded);
    if (persist) {
      try {
        window.localStorage.setItem(sidebarStorageKey, nextExpanded ? '1' : '0');
      } catch (_error) {
        // Navigation remains usable without persistence.
      }
    }
    scheduleBoardRender();
  };

  const syncSidebarForViewport = () => {
    setSidebarExpanded(compactSidebarQuery.matches ? false : storedSidebarExpanded(), { persist: false });
  };

  const normalizeThemePreference = (theme) => {
    if (adminThemes.includes(theme)) return theme;
    return legacyThemeMap[theme] || 'dark';
  };

  const resolvedTheme = (theme) => theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;

  const applyTheme = (theme, { persist = true } = {}) => {
    const nextTheme = normalizeThemePreference(theme);
    document.documentElement.dataset.adminThemePreference = nextTheme;
    document.documentElement.dataset.adminTheme = resolvedTheme(nextTheme);
    if (persist) window.localStorage.setItem(themeStorageKey, nextTheme);
    document.querySelectorAll('[data-theme-option]').forEach((button) => {
      const isActive = button.dataset.themeOption === nextTheme;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  };

  const normalizeScannerSettings = (settings) => {
    const baudRate = [9600, 19200, 38400, 57600, 115200].includes(Number(settings?.baud_rate)) ? Number(settings.baud_rate) : 9600;
    return { baud_rate: baudRate };
  };

  const readJsonResponse = async (response, fallbackMessage) => {
    const text = await response.text();
    if (text.trim() === '') {
      throw new Error(`${fallbackMessage} Empty response from ${response.url || 'server'}. HTTP ${response.status}.`);
    }
    try {
      return JSON.parse(text);
    } catch (_error) {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 220);
      throw new Error(`${fallbackMessage} Expected JSON but got HTTP ${response.status}: ${preview || 'no response body'}`);
    }
  };

  class StoreOpsAuthenticationRequiredError extends Error {}

  const redirectToStoreOpsLogin = () => {
    window.location.assign('../?reason=auth_required&return=dashboard%2F');
  };

  const serverCanSeeLocalUsb = () => {
    const host = window.location.hostname;
    return host === ''
      || host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  };

  const browserSerialSupported = () => Boolean(navigator.serial);

  const browserSerialOpenOptions = () => ({
    baudRate: Number(scannerSettings.baud_rate || 9600)
  });

  const isBrowserSerialPortOpen = (port) => Boolean(port?.readable || port?.writable);

  const browserSerialErrorMessage = (error, fallback = 'Unable to use the USB-COM scanner.') => {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!message) return fallback;
    if (/open|networkerror|busy|in use|locked/i.test(message)) {
      return `The browser could not open the scanner serial port. Close other Store Ops tabs or serial apps, unplug and reconnect the scanner, then try Find Scanner again. Browser detail: ${message}`;
    }
    return message;
  };

  const setSelectedScannerPort = (port, { verified = false } = {}) => {
    selectedScannerPort = port || null;
    selectedScannerLabel = port ? scannerPortLabel(port) : '';
    selectedScannerVerified = Boolean(port && verified);
    renderScannerSelection();
  };

  const parseScannerCodes = (buffer) => {
    const codes = String(buffer || '').split(/\r\n|\r|\n|\t/)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    return [...new Set(codes)];
  };

  const readBrowserSerialCodes = async (port, timeoutMs = 6000) => {
    if (!port?.readable) return [];
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + timeoutMs;
    let buffer = '';
    try {
      while (Date.now() < deadline) {
        const remaining = Math.max(1, deadline - Date.now());
        const result = await Promise.race([
          reader.read(),
          new Promise((resolve) => window.setTimeout(() => resolve({ timeout: true }), remaining))
        ]);
        if (result.timeout || result.done) break;
        if (result.value) {
          buffer += decoder.decode(result.value, { stream: true });
          if (/[\r\n\t]/.test(buffer)) {
            const codes = parseScannerCodes(buffer);
            if (codes.length) return codes;
          }
        }
      }
      return parseScannerCodes(buffer);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };

  const openBrowserSerialPort = async (port) => {
    if (!port) {
      throw new Error('No USB-COM scanner was selected.');
    }
    if (!isBrowserSerialPortOpen(port)) {
      try {
        await port.open(browserSerialOpenOptions());
      } catch (error) {
        if (isBrowserSerialPortOpen(port)) return false;
        throw new Error(browserSerialErrorMessage(error, 'Unable to open the USB-COM scanner.'));
      }
      return true;
    }
    return false;
  };

  const closeBrowserSerialPort = async (port) => {
    if (!isBrowserSerialPortOpen(port)) return;
    await port.close().catch(() => {});
  };

  const scannerPortLabel = (port) => {
    if (!port) return '';
    const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
    const vendorId = Number(info.usbVendorId || 0);
    const productId = Number(info.usbProductId || 0);
    if (!vendorId && !productId) return 'USB-COM scanner';
    const deviceId = [vendorId, productId]
      .map((value) => value.toString(16).toUpperCase().padStart(4, '0'))
      .join(':');
    return `USB-COM scanner (${deviceId})`;
  };

  const renderScannerSelection = () => {
    const label = selectedScannerLabel || 'No scanner selected';
    if (selectedScannerNode) selectedScannerNode.textContent = label;
    if (scannerSummary && !scannerSummary.dataset.healthMessage) scannerSummary.textContent = label;
    if (scannerSelectAction) scannerSelectAction.textContent = selectedScannerPort || selectedScannerLabel ? 'Find again' : 'Find Scanner';
    if (scannerSelectButton instanceof HTMLButtonElement) {
      scannerSelectButton.classList.toggle('is-selected', Boolean(selectedScannerPort || selectedScannerLabel));
    }
  };

  const selectScanner = async () => {
    if (!browserSerialSupported()) {
      setScannerHealth('error', 'Scanner selection unavailable', 'Use Chrome or Edge to select a USB-COM scanner from this device.');
      return null;
    }
    if (scannerSelectButton instanceof HTMLButtonElement) scannerSelectButton.disabled = true;
    try {
      setScannerHealth('checking', 'Finding scanner', `Choose the USB-COM barcode scanner. Store Ops will then listen ${scannerBarcodeWaitSeconds} seconds for a barcode.`);
      const port = await navigator.serial.requestPort();
      setSelectedScannerPort(port);
      setScannerHealth('checking', 'Waiting for barcode scan', `Scan any barcode within ${scannerBarcodeWaitSeconds} seconds to pair ${selectedScannerLabel} with Store Ops.`);
      const openedHere = await openBrowserSerialPort(port);
      try {
        const codes = await readBrowserSerialCodes(port, scannerBarcodeWaitMs);
        const code = String(codes[0] || '');
        if (!code) {
          setScannerHealth('ready', 'Scanner selected', `${selectedScannerLabel} is approved, but no barcode arrived within ${scannerBarcodeWaitSeconds} seconds. Click Test and scan any barcode to finish checking it.`);
          return port;
        }
        selectedScannerVerified = true;
        setScannerHealth('ok', 'Scanner connected', `Received ${code} from ${selectedScannerLabel}.`);
      } finally {
        if (openedHere) await closeBrowserSerialPort(port);
      }
      return port;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      setScannerHealth('error', 'Scanner selection failed', browserSerialErrorMessage(error, 'Unable to select the USB-COM scanner.'));
      return null;
    } finally {
      if (scannerSelectButton instanceof HTMLButtonElement) scannerSelectButton.disabled = false;
    }
  };

  const checkBrowserScannerHealth = async () => {
    if (!browserSerialSupported()) {
      setScannerHealth(
        'error',
        'Browser cannot access USB-COM',
        'Hostinger cannot see a scanner plugged into this laptop. Open Store Ops in Chrome or Edge and use Test Scan so the browser can talk to the local USB-COM scanner.'
      );
      return false;
    }

    const ports = await navigator.serial.getPorts();
    if (!ports.length) {
      setSelectedScannerPort(null);
      setScannerHealth(
        'ready',
        'Find Scanner',
        `Click Find Scanner, choose the USB-COM barcode scanner, then scan any barcode within ${scannerBarcodeWaitSeconds} seconds to pair it with Store Ops.`
      );
      return false;
    }

    if (!selectedScannerPort || !ports.includes(selectedScannerPort)) {
      setSelectedScannerPort(ports[0], { verified: selectedScannerVerified });
    }

    if (selectedScannerVerified) {
      setScannerHealth('ok', 'Scanner connected', `${selectedScannerLabel} is paired with this browser.`);
    } else {
      setScannerHealth(
        'ready',
        'Scanner permission ready',
        `${selectedScannerLabel} is approved. Use Test and scan a real barcode to confirm data is arriving.`
      );
    }
    return true;
  };

  const renderScannerSettings = () => {
    scannerSettings = normalizeScannerSettings(scannerSettings);
    renderScannerSelection();
  };

  const setScannerHealth = (stateName, title, detail) => {
    const card = document.querySelector('[data-scanner-health]');
    const titleNode = document.querySelector('[data-scanner-health-title]');
    const detailNode = document.querySelector('[data-scanner-health-detail]');
    if (!card) return;
    card.classList.toggle('is-ok', stateName === 'ok');
    card.classList.toggle('is-error', stateName === 'error');
    card.classList.toggle('is-checking', stateName === 'checking');
    card.classList.toggle('is-ready', stateName === 'ready');
    if (titleNode) titleNode.textContent = title;
    if (detailNode) detailNode.textContent = detail;
    if (scannerSummary) {
      scannerSummary.dataset.healthMessage = title;
      scannerSummary.textContent = stateName === 'ok' && selectedScannerLabel
        ? `${selectedScannerLabel} working`
        : title;
    }
    if (scannerSummaryDot) {
      scannerSummaryDot.classList.toggle('is-ok', stateName === 'ok');
      scannerSummaryDot.classList.toggle('is-error', stateName === 'error');
      scannerSummaryDot.classList.toggle('is-checking', stateName === 'checking');
      scannerSummaryDot.classList.toggle('is-ready', stateName === 'ready');
    }
  };

  const scannerHealthDetail = (payload) => {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const firstExisting = candidates.find((candidate) => candidate.path === payload.device)
      || candidates.find((candidate) => candidate.exists)
      || candidates[0]
      || {};
    const checks = payload.checks || {};
    if (!checks.device_exists) {
      return `No scanner serial device was found. Checked: ${candidates.map((candidate) => candidate.path).filter(Boolean).join(', ') || 'no paths'}.`;
    }
    if (!checks.device_readable) {
      const user = payload.web_user ? ` User: ${payload.web_user}.` : '';
      return `Found ${payload.device}, but it is not readable. Permissions: ${firstExisting.permissions || 'unknown'}.${user} Add the web-server user to dialout or install a udev rule for the scanner.`;
    }
    if (!checks.configured) {
      return `Found ${payload.device}, but stty configuration failed: ${payload.error || 'no command output'}`;
    }
    if (!checks.opened) {
      const user = payload.web_user ? ` User: ${payload.web_user}.` : '';
      return `Found ${payload.device}, but PHP could not open it. Permissions: ${firstExisting.permissions || 'unknown'}.${user} Add the web-server user to dialout or configure a udev rule.`;
    }
    return `Serial path is open on ${payload.device} at ${payload.baud_rate || scannerSettings.baud_rate} baud. Click Test Scan and scan any barcode to prove data is arriving.`;
  };

  const checkScannerHealth = async () => {
    setScannerHealth('checking', 'Checking scanner', 'Checking whether this browser can reach the local USB-COM scanner.');
    try {
      if (browserSerialSupported()) {
        return await checkBrowserScannerHealth();
      }

      if (!serverCanSeeLocalUsb()) {
        setScannerHealth('error', 'Browser cannot access USB-COM', 'Open Store Ops in Chrome or Edge so the browser can talk to the local USB-COM scanner.');
        return false;
      }

      const query = new URLSearchParams({
        status: '1',
        baud_rate: String(scannerSettings.baud_rate || 9600)
      });
      const response = await fetch(`${scanSerialEndpoint}?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to run USB-COM health check.');
      if (!response.ok || !payload.ok) {
        setScannerHealth('error', 'Scanner command path failed', scannerHealthDetail(payload));
        return false;
      }
      setScannerHealth('ready', 'Scanner path ready', scannerHealthDetail(payload));
      return true;
    } catch (error) {
      setScannerHealth('error', 'Scanner health check failed', error instanceof Error ? error.message : 'Unable to run USB-COM health check.');
      return false;
    }
  };

  const testScannerScan = async () => {
    setScannerHealth('checking', 'Waiting for barcode scan', `Scan any product barcode within ${scannerBarcodeWaitSeconds} seconds. Store Ops will turn green only after this browser receives barcode data from USB-COM.`);
    if (scannerTestScanButton instanceof HTMLButtonElement) scannerTestScanButton.disabled = true;
    try {
      if (browserSerialSupported()) {
        const approvedPorts = await navigator.serial.getPorts();
        let port = selectedScannerPort || approvedPorts[0] || null;
        if (!port) {
          port = await selectScanner();
          return Boolean(port && selectedScannerVerified);
        }
        if (!port) return false;
        setSelectedScannerPort(port, { verified: selectedScannerVerified });
        const openedHere = await openBrowserSerialPort(port);
        try {
          const codes = await readBrowserSerialCodes(port, scannerBarcodeWaitMs);
          const code = String(codes[0] || '');
          if (!code) {
            setScannerHealth('error', 'Scanner test failed', 'The browser opened the local USB-COM port, but no barcode data arrived within 6 seconds.');
            return false;
          }
          selectedScannerVerified = true;
          setScannerHealth('ok', 'Scanner connected', `Received ${code} from ${selectedScannerLabel} through this browser.`);
          return true;
        } finally {
          if (openedHere) await closeBrowserSerialPort(port);
        }
      }

      if (!serverCanSeeLocalUsb()) {
        throw new Error('This browser cannot access USB-COM scanners from a hosted Store Ops site. Use Chrome or Edge.');
      }

      const query = new URLSearchParams({
        test: '1',
        baud_rate: String(scannerSettings.baud_rate || 9600)
      });
      const response = await fetch(`${scanSerialEndpoint}?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to run scanner test.');
      const code = Array.isArray(payload.codes) ? String(payload.codes[0] || '') : '';
      if (!response.ok || !payload.ok || !code) {
        setScannerHealth('error', 'Scanner test failed', payload.error || 'No barcode data was received from USB-COM.');
        return false;
      }
      selectedScannerLabel = payload.device || 'Local USB-COM scanner';
      selectedScannerVerified = true;
      renderScannerSelection();
      setScannerHealth('ok', 'Scanner connected', `Received ${code} from ${payload.device || 'USB-COM scanner'} at ${payload.baud_rate || scannerSettings.baud_rate} baud.`);
      return true;
    } catch (error) {
      setScannerHealth('error', 'Scanner test failed', browserSerialErrorMessage(error, 'Unable to run scanner test.'));
      return false;
    } finally {
      if (scannerTestScanButton instanceof HTMLButtonElement) scannerTestScanButton.disabled = false;
    }
  };

  const bindBrowserSerialEvents = () => {
    if (!browserSerialSupported() || typeof navigator.serial.addEventListener !== 'function') return;
    navigator.serial.addEventListener('connect', () => {
      checkBrowserScannerHealth().catch(() => {});
    });
    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target && event.target !== selectedScannerPort) return;
      setSelectedScannerPort(null);
      setScannerHealth('ready', 'Scanner disconnected', 'Reconnect the scanner. If it was already paired with this browser, Store Ops will detect it when it appears again.');
    });
  };

  const loadScannerSettings = async () => {
    try {
      const response = await fetch(scanBridgeEndpoint, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to load scanner settings.');
      scannerSettings = normalizeScannerSettings(payload.settings || scannerSettings);
    } catch (_error) {
      scannerSettings = normalizeScannerSettings(scannerSettings);
    }
    renderScannerSettings();
  };

  const astraMultiplier = (item) => {
    const volume = Number(item.volume || 0);
    const astra = Number(item.astra || item.volume || 0);
    if (!Number.isFinite(volume) || !Number.isFinite(astra) || volume <= 0 || astra <= 0) return 1;
    return Math.max(1, Math.round(volume / astra));
  };

  const catalogSignature = (item, volume) => [
    item.brandId || item.brandName,
    item.unitId || item.unitName,
    Number(volume || 0).toFixed(2),
    item.flavorId || item.flavorName,
    item.productId || item.productName
  ].join('|');

  const productNameFromSkuRow = (row) => {
    const brand = String(row.brand_name || '').trim();
    const product = String(row.product_name || '').trim();
    const flavor = String(row.flavor_name || '').trim();
    const unit = String(row.unit_name || '').trim();
    const volume = row.volume && Number(row.volume) ? String(Number(row.volume)) : '';
    const productLower = product.toLowerCase();
    const parts = [];
    if (brand && !productLower.startsWith(brand.toLowerCase())) parts.push(brand);
    if (product) parts.push(product);
    if (flavor && !productLower.includes(flavor.toLowerCase())) parts.push(flavor);
    if (volume && !productLower.includes(volume)) parts.push(volume);
    if (unit && !productLower.includes(unit.toLowerCase())) parts.push(unit);
    return parts.join(' ');
  };

  const normalizeSkuRow = (row) => {
    const sku = String(row.sku || '').trim();
    const volume = Number(row.volume || 0);
    const astra = Number(row.astra || row.volume || 0);
    return {
      tag: String(row.tag || sku).trim(),
      sku,
      barcode: sku,
      brandId: String(row.brand_id || ''),
      brandName: String(row.brand_name || ''),
      unitId: String(row.unit_id || ''),
      unitName: String(row.unit_name || ''),
      volume,
      astra: astra > 0 ? astra : volume,
      flavorId: String(row.flavor_id || ''),
      flavorName: String(row.flavor_name || ''),
      productId: String(row.product_id || ''),
      baseProductName: String(row.product_name || ''),
      skipScan: Boolean(row.skip_scan),
      currentStock: Number(row.current_stock ?? 0),
      productName: productNameFromSkuRow(row) || sku
    };
  };

  const applyAstraScanTargets = () => {
    const baseSkuBySignature = new Map();
    skuCatalog.forEach((item) => {
      baseSkuBySignature.set(catalogSignature(item, item.volume), item);
    });

    skuCatalog = skuCatalog.map((item) => {
      const multiplier = astraMultiplier(item);
      const baseItem = multiplier > 1 ? baseSkuBySignature.get(catalogSignature(item, item.astra)) : item;
      const scanItem = baseItem || item;
      return {
        ...item,
        scanSku: scanItem.sku,
        scanBarcode: scanItem.barcode,
        scanProductName: scanItem.productName,
        skipScan: Boolean(item.skipScan),
        scanMultiplier: multiplier
      };
    });
  };

  const readStoredSkuCatalog = () => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(skuCatalogStorageKey) || 'null');
      const rows = Array.isArray(cached) ? cached : (Array.isArray(cached?.items) ? cached.items : []);
      return rows.filter((item) => item && typeof item === 'object' && String(item.sku || '').trim());
    } catch (_error) {
      return [];
    }
  };

  const saveSkuCatalog = () => {
    const payload = {
      savedAt: Date.now(),
      items: skuCatalog
    };
    try {
      window.localStorage.setItem(skuCatalogStorageKey, JSON.stringify(payload));
    } catch (_error) {
      // Cached SKU rows are an optional startup accelerator.
    }
    writeClientCache(skuCatalogStorageKey, payload);
  };

  const hydrateSkuCatalogFromCache = () => {
    const cached = readStoredSkuCatalog();
    if (!cached.length) return false;
    skuCatalog = cached;
    applyAstraScanTargets();
    return true;
  };

  const hydrateSkuCatalogFromDurableCache = async () => {
    if (skuCatalog.length) return false;
    const cached = await readClientCache(skuCatalogStorageKey);
    const rows = Array.isArray(cached) ? cached : (Array.isArray(cached?.items) ? cached.items : []);
    const normalized = rows.filter((item) => item && typeof item === 'object' && String(item.sku || '').trim());
    if (!normalized.length) return false;
    skuCatalog = normalized;
    applyAstraScanTargets();
    return true;
  };

  const loadSkuCatalog = async () => {
    const response = await fetch(skuDbEndpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load live SKU database.');
    }
    skuCatalog = (payload.database?.skus || [])
      .map(normalizeSkuRow)
      .filter((item) => item.sku);
    applyAstraScanTargets();
    saveSkuCatalog();
  };

  const consolidateScanItems = (items) => {
    const grouped = new Map();
    (items || []).forEach((item) => {
      const scanSku = String(item.scanSku || item.sku || '');
      const scanBarcode = String(item.scanBarcode || item.barcode || scanSku);
      const key = scanSku || scanBarcode || String(item.productName || item.scanProductName || '');
      const quantity = Number(item.quantity || 0);
      const scanQuantity = Number(item.scanQuantity || quantity);
      const skipQuantity = item.skipScan ? scanQuantity : 0;
      if (!key) return;

      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += quantity;
        existing.scanQuantity += scanQuantity;
        existing.skipQuantity = Number(existing.skipQuantity || 0) + skipQuantity;
        existing.skipScan = Number(existing.skipQuantity || 0) >= existing.scanQuantity;
        return;
      }

      grouped.set(key, {
        ...item,
        quantity,
        scanQuantity,
        skipQuantity
      });
    });

    return Array.from(grouped.values());
  };

  const readStoredOrders = () => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(ordersStorageKey) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch (_error) {
      return [];
    }
  };

  const readStoredOrdersMeta = () => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(ordersStorageMetaKey) || '{}');
      return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    } catch (_error) {
      return {};
    }
  };

  const catalogLookup = () => {
    const rows = new Map();
    const addLookup = (value, item) => {
      const key = String(value || '').trim().toUpperCase();
      if (key && !rows.has(key)) rows.set(key, item);
    };

    skuCatalog.forEach((item) => {
      addLookup(item.tag, item);
      addLookup(item.sku, item);
    });

    return rows;
  };

  const normalizeOrderItem = (item, catalogRows) => {
    const sourceTag = String(item.source_tag || item.sku || '').trim().toUpperCase();
    const quantity = Math.max(1, Number(item.quantity || 1));
    const catalogItem = sourceTag ? catalogRows.get(sourceTag) : null;
    if (catalogItem) {
      const productName = catalogItem.productName || String(item.productName || '').trim() || sourceTag;
      return {
        ...catalogItem,
        productName,
        scanProductName: catalogItem.scanProductName || catalogItem.productName,
        quantity,
        scanQuantity: quantity * Number(catalogItem.scanMultiplier || 1),
        skipScan: Boolean(catalogItem.skipScan),
        sourceSkus: Array.from(new Set([sourceTag, catalogItem.sku].filter(Boolean))),
        sourceTags: sourceTag && sourceTag !== String(catalogItem.sku || '').trim().toUpperCase() ? [sourceTag] : [],
        sourceBarcodes: [String(catalogItem.barcode || catalogItem.sku || '').trim()].filter(Boolean),
        skuMatchStatus: item.sku_match_status || 'matched',
        sourcePlatform: item.sourcePlatform || item.platform || 'Website'
      };
    }

    return {
      tag: sourceTag,
      sku: sourceTag,
      barcode: String(item.barcode || sourceTag).trim(),
      productName: String(item.productName || item.product_name || sourceTag || 'Order item').trim(),
      scanSku: sourceTag,
      scanBarcode: String(item.barcode || sourceTag).trim(),
      scanProductName: String(item.productName || item.product_name || sourceTag || 'Order item').trim(),
      scanMultiplier: 1,
      skipScan: Boolean(item.skip_scan || item.skipScan),
      quantity,
      scanQuantity: quantity,
      sourceSkus: sourceTag ? [sourceTag] : [],
      sourceBarcodes: [String(item.barcode || sourceTag).trim()].filter(Boolean),
      sourcePlatform: item.sourcePlatform || item.platform || 'Order',
      missingSku: sourceTag === ''
    };
  };

  const mergeLocalOrderState = (order, storedById) => {
    const stored = storedById.get(String(order.id || ''));
    if (!stored) return order;
    const recoveryTimestamp = Date.parse(String(order.authorizedRecoveryReopenedAt || ''));
    const storedPrintedLabel = stored.printedLabel || order.printedLabel || null;
    const acknowledgedTimestamp = Date.parse(String(storedPrintedLabel?.serverAcknowledgedAt || storedPrintedLabel?.printedAt || ''));
    const recoverySupersedesLocalCompletion = Number.isFinite(recoveryTimestamp)
      && (!Number.isFinite(acknowledgedTimestamp) || recoveryTimestamp > acknowledgedTimestamp);
    const printedLabel = recoverySupersedesLocalCompletion ? null : storedPrintedLabel;
    const serverAcknowledged = Boolean(printedLabel && printedLabel.serverAcknowledgedAt);
    return {
      ...order,
      printedLabel,
      ...(serverAcknowledged ? {
        status: 'FULFILLED',
        fulfillmentStatus: 'FULFILLED',
        started: false
      } : {})
    };
  };

  const normalizeOrder = (order, catalogRows, storedById) => {
    const id = String(order.id || '').trim();
    const deadline = orderPresentation.normalizeDeadline(order);
    return mergeLocalOrderState({
      id,
      platform: String(order.platform || 'Shopee'),
      account: String(order.account || 'Jenang Gemi'),
      sourceAccountKey: String(order.sourceAccountKey || order.account_key || ''),
      partnerCode: String(order.partnerCode || order.partner_code || ''),
      partnerName: String(order.partnerName || order.partner_name || ''),
      customerName: String(order.username || order.buyer_username || order.customer?.username || order.customerName || order.customer_name || order.customer?.name || order.buyerName || order.buyer_name || ''),
      status: String(order.status || 'IS_LISTED'),
      marketplaceStatus: String(order.marketplaceStatus || order.marketplace_status || 'READY_TO_SHIP'),
      labelBacked: Boolean(order.labelBacked || order.label_backed),
      packageNumber: String(order.packageNumber || ''),
      instant: Boolean(order.instant),
      cancellationRequested: orderPresentation.isCancellationRequested(order),
      manualArrangementRequired: Boolean(order.manualArrangementRequired || order.manual_arrangement_required),
      shipmentArranged: Boolean(order.shipmentArranged || order.shipment_arranged),
      instantArrangementState: String(order.instantArrangementState || order.instant_arrangement_state || ''),
      instantArrangementError: String(order.instantArrangementError || order.instant_arrangement_error || ''),
      arrangementRetryRequired: !Boolean(order.instant) && Boolean(order.arrangementRetryRequired || order.arrangement_retry_required),
      arrangementRetryState: String(order.arrangementRetryState || order.arrangement_retry_state || ''),
      arrangementRetryError: String(order.arrangementRetryError || order.arrangement_retry_error || ''),
      weekendDependent: Boolean(order.weekendDependent || order.weekend_dependent),
      weekendDependentAutoWindowOpen: Boolean(order.weekendDependentAutoWindowOpen || order.weekend_dependent_auto_window_open),
      weekendDependentCutoff: String(order.weekendDependentCutoff || order.weekend_dependent_cutoff || ''),
      shopeeManualRequired: Boolean(order.shopeeManualRequired || order.shopee_manual_required),
      shopeeArrangementState: String(order.shopeeArrangementState || order.shopee_arrangement_state || ''),
      shopeeArrangementError: String(order.shopeeArrangementError || order.shopee_arrangement_error || ''),
      authorizedRecoveryReopenedAt: String(order.authorizedRecoveryReopenedAt || order.authorized_recovery_reopened_at || ''),
      handoverMethod: orderPresentation.normalizeHandoverMethod(order),
      shippingProviderName: String(order.shippingProviderName || order.shipping_provider_name || ''),
      handoverScheduledStartAt: String(order.handoverScheduledStartAt || order.handover_scheduled_start_at || ''),
      handoverScheduledEndAt: String(order.handoverScheduledEndAt || order.handover_scheduled_end_at || ''),
      handoverSlotLabel: String(order.handoverSlotLabel || order.handover_slot_label || ''),
      deadlineAt: deadline.deadlineAt,
      deadlineType: deadline.deadlineType,
      deadlineLabel: deadline.deadlineLabel,
      deadlineSatisfied: deadline.deadlineSatisfied,
      deadlineDelayed: deadline.deadlineDelayed,
      fulfillmentStatus: String(order.fulfillmentStatus || 'UNCLAIMED'),
      claimedBy: order.claimedBy || null,
      claimedByName: String(order.claimedByName || ''),
      claimedAt: order.claimedAt || null,
      locked: Boolean(order.locked),
      currentEmployeeCanWork: order.currentEmployeeCanWork !== false,
      claimStale: Boolean(order.claimStale),
      scanProgress: order.scanProgress && typeof order.scanProgress === 'object'
        ? order.scanProgress
        : { completed: 0, required: 0, percent: 0 },
      started: Boolean(order.claimedBy && order.currentEmployeeCanWork !== false && String(order.fulfillmentStatus || '') !== 'FULFILLED'),
      items: (Array.isArray(order.items) ? order.items : [])
        .map((item) => normalizeOrderItem(item, catalogRows))
        .filter((item) => item.sku || item.productName)
    }, storedById);
  };

  const normalizeCachedOrders = (orders = readStoredOrders()) => {
    const stored = Array.isArray(orders) ? orders : [];
    if (!stored.length) return [];
    const storedById = new Map(stored.map((order) => [String(order.id || ''), order]));
    const catalogRows = catalogLookup();
    return stored
      .map((order) => normalizeOrder(order, catalogRows, storedById))
      .filter((order) => {
        if (!order.id) return false;
        const platform = normalizeSourceKey(order.platform);
        return !['shopee', 'tiktok'].includes(platform)
          || automaticArrangementPaused
          || order.labelBacked
          || orderPresentation.isInstantManualLifecycle(order)
          || orderPresentation.isCancellationRequested(order);
      });
  };

  const hydrateOrdersFromCache = () => {
    const cachedMeta = readStoredOrdersMeta();
    const cachedAt = Number(cachedMeta.savedAt || 0);
    if (!Number.isFinite(cachedAt) || cachedAt <= 0 || Date.now() - cachedAt > ordersStartupCacheMaxAgeMs) {
      return false;
    }
    bigSetEnabled = Boolean(cachedMeta.bigSetEnabled);
    automaticArrangementPaused = Boolean(cachedMeta.automaticArrangementPaused);
    const cachedOrders = normalizeCachedOrders();
    if (!cachedOrders.length) return false;
    ordersEtag = String(cachedMeta.etag || '');
    state.orders = cachedOrders;
    renderBoard();
    renderSourceColorList();
    return true;
  };

  const hydrateOrdersFromDurableCache = async () => {
    if (state.orders.length) return false;
    const cached = await readClientCache(ordersStorageKey);
    const cachedAt = Number(cached?.savedAt || 0);
    if (!Number.isFinite(cachedAt) || cachedAt <= 0 || Date.now() - cachedAt > ordersStartupCacheMaxAgeMs) {
      return false;
    }
    const rows = Array.isArray(cached) ? cached : (Array.isArray(cached?.orders) ? cached.orders : []);
    bigSetEnabled = Boolean(cached?.bigSetEnabled);
    automaticArrangementPaused = Boolean(cached?.automaticArrangementPaused);
    const cachedOrders = normalizeCachedOrders(rows);
    if (!cachedOrders.length) return false;
    ordersEtag = String(cached?.etag || ordersEtag || '');
    state.orders = cachedOrders;
    renderBoard();
    renderSourceColorList();
    return true;
  };

  const loadOrders = async () => {
    const headers = { Accept: 'application/json' };
    if (ordersEtag && state.orders.length) headers['If-None-Match'] = ordersEtag;
    const response = await fetch(ordersEndpoint, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers
    });
    if (response.status === 304) {
      lastOrdersRefreshAt = Date.now();
      return null;
    }
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Unable to load orders.');
    }
    ordersEtag = response.headers.get('ETag') || response.headers.get('etag') || ordersEtag;
    const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
    bigSetEnabled = Boolean(meta.big_set_enabled);
    automaticArrangementPaused = Boolean(meta.automation_paused);
    const refreshErrors = Array.isArray(meta.errors) ? meta.errors : [];
    orderSourceErrors = refreshErrors.map(String).filter(orderPresentation.isRequiredMarketplaceSourceError);
    const configuredSources = Number(meta.configured_sources || 0);
    const successfulAccounts = Number(meta.successful_accounts || 0);
    const partnerOrdersMeta = meta.partner_orders && typeof meta.partner_orders === 'object' ? meta.partner_orders : {};
    const degradedRefresh = refreshErrors.length > 0
      || Number(meta.stale_account_count || 0) > 0
      || Boolean(partnerOrdersMeta.stale)
      || (configuredSources > 0 && successfulAccounts === 0);

    partnerOrderSources = (Array.isArray(payload.meta?.partner_orders?.sources) ? payload.meta.partner_orders.sources : [])
      .map((source) => ({
        key: normalizeSourceKey(source.key || source.sourceKey || ''),
        label: String(source.label || source.name || '').trim()
      }))
      .filter((source) => source.key && source.label);

    const stored = readStoredOrders();
    const storedById = new Map(stored.map((order) => [String(order.id || ''), order]));
    const catalogRows = catalogLookup();
    const nextOrders = (Array.isArray(payload.orders) ? payload.orders : [])
      .map((order) => normalizeOrder(order, catalogRows, storedById))
      .filter((order) => order.id);
    if (!nextOrders.length && state.orders.length) {
      if (degradedRefresh) {
        throw new Error('Order refresh was incomplete; keeping the current board.');
      }
    }

    return nextOrders;
  };

  const saveOrders = () => {
    const cacheOrders = state.orders.map((order) => {
      const cached = { ...order };
      delete cached.started;
      delete cached.clientClaimPending;
      delete cached.clientClaimRequestId;
      delete cached.clientClaimReleaseRequested;
      return cached;
    });
    const meta = { savedAt: Date.now(), etag: ordersEtag, bigSetEnabled, automaticArrangementPaused };
    try {
      window.localStorage.setItem(ordersStorageKey, JSON.stringify(cacheOrders));
      window.localStorage.setItem(ordersStorageMetaKey, JSON.stringify(meta));
    } catch (_error) {
      // Keep the visible queue working even when local persistence is unavailable.
    }
    writeClientCache(ordersStorageKey, {
      ...meta,
      orders: cacheOrders
    });
  };

  const syncOrdersFromStorage = () => {
    try {
      const before = JSON.stringify(state.orders);
      const storedById = new Map(readStoredOrders().map((order) => [String(order.id || ''), order]));
      state.orders = state.orders.map((order) => mergeLocalOrderState(order, storedById));
      return before !== JSON.stringify(state.orders);
    } catch (_error) {
      return false;
    }
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const listedOrders = () => orderPresentation.sortOrdersByUrgency(
    state.orders.filter((order) => (
      order.status !== 'FULFILLED'
      && order.fulfillmentStatus !== 'FULFILLED'
    ))
  );

  const visibleListedOrders = (orders = listedOrders()) => orderPresentation.filterOrdersByHandover(orders, dropOffOnly);

  const orderProductCount = (order) => (Array.isArray(order?.items) ? order.items : [])
    .reduce((sum, item) => sum + Math.max(0, Number(item.quantity || item.qty || 0)), 0);

  const productsLeftToPackage = (orders) => orders
    .reduce((sum, order) => sum + orderProductCount(order), 0);

  const activeOrder = () => state.orders.find((order) => order.id === state.activeOrderId) || null;

  const normalizeOrderId = (value) => String(value || '').trim().toUpperCase();

  const reprintInput = () => reprintForm?.querySelector('input[name="order_id"]');

  const clearReprintError = () => {
    if (!reprintError) return;
    reprintError.textContent = '';
    reprintError.hidden = true;
  };

  const reprintCustomerLabel = (customer) => String(
    customer?.username || customer?.name || customer?.phone || customer?.email || 'Customer'
  ).trim();

  const reprintCustomerDetails = (customer) => {
    const primary = reprintCustomerLabel(customer);
    return [customer?.name, customer?.username, customer?.phone, customer?.email]
      .map((value) => String(value || '').trim())
      .filter((value, index, values) => value && value !== primary && values.indexOf(value) === index)
      .slice(0, 2)
      .join(' · ');
  };

  const formatReprintDate = (value) => {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return 'Order date unavailable';
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Jakarta'
    }).format(date);
  };

  const renderReprintPrompt = (message = 'Start typing to find a customer, or enter the full Order ID.') => {
    if (!reprintResults) return;
    reprintResults.innerHTML = `<p class="admin-empty">${escapeHtml(message)}</p>`;
  };

  const renderReprintProfiles = (profiles) => {
    if (!reprintResults) return;
    reprintProfiles = Array.isArray(profiles) ? profiles : [];
    selectedReprintProfile = null;
    if (!reprintProfiles.length) {
      renderReprintPrompt('No matching customers. You can still open an exact Order ID.');
      return;
    }
    reprintResults.innerHTML = `
      <div class="admin-reprint-result-heading">
        <strong>Matching customers</strong>
        <small>Select a person to see every matching label order.</small>
      </div>
      <div class="admin-reprint-profile-list">
        ${reprintProfiles.map((profile, index) => {
          const customer = profile?.customer || {};
          const details = reprintCustomerDetails(customer);
          const orderCount = Number(profile?.order_count || profile?.orders?.length || 0);
          return `
            <button type="button" class="admin-reprint-profile-option" data-reprint-profile-index="${index}">
              <span class="admin-reprint-profile-avatar" aria-hidden="true">${escapeHtml(reprintCustomerLabel(customer).charAt(0).toUpperCase() || '?')}</span>
              <span>
                <strong>${escapeHtml(reprintCustomerLabel(customer))}</strong>
                <small>${escapeHtml(details || `${orderCount} label order${orderCount === 1 ? '' : 's'}`)}</small>
              </span>
              <em>${escapeHtml(orderCount)}</em>
            </button>
          `;
        }).join('')}
      </div>
    `;
  };

  const renderReprintProfileOrders = (profile) => {
    if (!reprintResults) return;
    selectedReprintProfile = profile;
    const customer = profile?.customer || {};
    const orders = Array.isArray(profile?.orders) ? profile.orders : [];
    reprintResults.innerHTML = `
      <div class="admin-reprint-selected-head">
        <button type="button" class="admin-ghost-btn admin-reprint-back" data-reprint-profile-back aria-label="Back to matching customers">Back</button>
        <span>
          <strong>${escapeHtml(reprintCustomerLabel(customer))}</strong>
          <small>${escapeHtml(reprintCustomerDetails(customer) || `${orders.length} label order${orders.length === 1 ? '' : 's'}`)}</small>
        </span>
      </div>
      <div class="admin-reprint-order-list">
        ${orders.length ? orders.map((order, index) => {
          const labelAvailable = order?.shipping_label?.available !== false;
          const unavailableReason = String(order?.shipping_label?.unavailable_reason || 'This shipping label is not available for reprint.');
          return `
          <button
            type="button"
            class="admin-reprint-order-option${labelAvailable ? '' : ' is-unavailable'}"
            data-reprint-order-index="${index}"
            ${labelAvailable ? '' : `title="${escapeHtml(unavailableReason)}"`}
          >
            <time>${escapeHtml(formatReprintDate(order?.created_at))}</time>
            <span>
              <strong>${escapeHtml(order?.order_id || 'Order')}</strong>
              <small>${escapeHtml(order?.source?.label || 'Shipping label')}</small>
            </span>
            ${labelAvailable ? '<em class="admin-reprint-available">Available</em>' : ''}
          </button>
        `;
        }).join('') : '<p class="admin-empty">No shipping-label orders were found for this customer.</p>'}
      </div>
    `;
  };

  const searchReprintProfiles = async (query) => {
    const sequence = ++reprintSearchSequence;
    reprintSearchController?.abort();
    reprintSearchController = new AbortController();
    renderReprintPrompt('Searching customer profiles…');
    clearReprintError();
    try {
      const params = new URLSearchParams({
        action: 'profile_search',
        query,
        label_only: '1',
        limit: '100'
      });
      const response = await fetch(`${orderLookupEndpoint}?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: reprintSearchController.signal
      });
      const payload = await readJsonResponse(response, 'Customer search failed.');
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || 'Customer search failed.');
      }
      if (sequence !== reprintSearchSequence) return;
      renderReprintProfiles(payload.profiles || []);
    } catch (error) {
      if (error?.name === 'AbortError' || sequence !== reprintSearchSequence) return;
      renderReprintPrompt('Customer search is temporarily unavailable. Exact Order ID lookup still works.');
      showReprintError(error instanceof Error ? error.message : 'Customer search failed.');
    }
  };

  const openReprintModal = () => {
    if (!reprintModal) return;
    reprintModal.hidden = false;
    clearReprintError();
    reprintProfiles = [];
    selectedReprintProfile = null;
    renderReprintPrompt();
    const input = reprintInput();
    if (input instanceof HTMLInputElement) {
      input.value = '';
      window.setTimeout(() => input.focus(), 40);
    }
  };

  const closeReprintModal = () => {
    window.clearTimeout(reprintSearchTimer);
    reprintSearchController?.abort();
    reprintSearchController = null;
    reprintSearchSequence += 1;
    if (reprintModal) reprintModal.hidden = true;
  };

  const showReprintError = (message) => {
    if (!reprintError) return;
    reprintError.textContent = message;
    reprintError.hidden = false;
  };

  const openStorePage = (url) => {
    const page = window.open(url, '_blank');
    if (page) {
      return;
    }
    window.location.href = url;
  };

  const orderActionPayload = (action, order, extra = {}) => ({
    action,
    order_id: String(order?.id || extra.order_id || ''),
    source_platform: normalizeSourceKey(order?.platform || extra.source_platform || ''),
    source_account: sourceKeyFromOrder(order || extra),
    package_id: String(order?.packageNumber || extra.package_id || ''),
    marketplace_status: String(order?.marketplaceStatus || extra.marketplace_status || ''),
    instant: Boolean(order?.instant),
    manual_arrangement_required: Boolean(order?.manualArrangementRequired),
    arrangement_retry_required: Boolean(order?.arrangementRetryRequired),
    arrangement_retry_state: String(order?.arrangementRetryState || ''),
    shopee_manual_required: Boolean(order?.shopeeManualRequired),
    shopee_arrangement_state: String(order?.shopeeArrangementState || ''),
    cancellation_requested: orderPresentation.isCancellationRequested(order),
    label_backed: Boolean(order?.labelBacked),
    ...extra
  });

  const postOrderAction = async (action, order, extra = {}, options = {}) => {
    const response = await fetch(ordersEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: Boolean(options.keepalive),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: options.signal,
      body: JSON.stringify(orderActionPayload(action, order, extra))
    });
    const payload = await readJsonResponse(response, 'Unable to update order.');
    if (response.status === 401) {
      throw new StoreOpsAuthenticationRequiredError(payload.error || 'Store Ops sign-in required.');
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Unable to update order.');
    }
    return payload;
  };

  const readPendingCompletionQueue = () => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(pendingCompletionQueueStorageKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const removeAcknowledgedCompletion = (key, queuedAt) => {
    try {
      const queue = readPendingCompletionQueue();
      if (!queue[key] || String(queue[key].queued_at || '') !== queuedAt) return;
      delete queue[key];
      window.localStorage.setItem(pendingCompletionQueueStorageKey, JSON.stringify(queue));
    } catch (_error) {
      // Keep retrying the acknowledged action if local persistence is temporarily unavailable.
    }
  };

  const clearPendingCompletionForOrder = (order) => {
    try {
      const queue = readPendingCompletionQueue();
      const orderId = String(order?.id || '').trim();
      const platform = normalizeSourceKey(order?.platform || '');
      const account = sourceKeyFromOrder(order || {});
      let changed = false;
      Object.entries(queue).forEach(([key, entry]) => {
        const payload = entry && typeof entry === 'object' && entry.payload && typeof entry.payload === 'object'
          ? entry.payload
          : {};
        if (
          String(payload.order_id || '').trim() === orderId
          && normalizeSourceKey(payload.source_platform || '') === platform
          && normalizeSourceKey(payload.source_account || '') === normalizeSourceKey(account)
        ) {
          delete queue[key];
          changed = true;
        }
      });
      if (changed) window.localStorage.setItem(pendingCompletionQueueStorageKey, JSON.stringify(queue));
    } catch (_error) {
      // The server-side claim requirement still blocks stale completion retries.
    }
  };

  const flushPendingOrderCompletions = () => {
    if (completionQueueFlushPromise) return completionQueueFlushPromise;
    completionQueueFlushPromise = (async () => {
      let acknowledged = 0;
      const queue = readPendingCompletionQueue();
      for (const [key, entry] of Object.entries(queue)) {
        const payload = entry && typeof entry === 'object' && entry.payload && typeof entry.payload === 'object'
          ? entry.payload
          : null;
        if (!payload || !['fulfill_order', 'reprint_label'].includes(String(payload.action || ''))) continue;
        try {
          const response = await fetch(ordersEndpoint, {
            method: 'POST',
            credentials: 'same-origin',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          });
          const responsePayload = await readJsonResponse(response, 'Unable to finish a queued order.');
          if (!response.ok || responsePayload.ok === false) continue;
          removeAcknowledgedCompletion(key, String(entry.queued_at || ''));
          acknowledged += 1;
        } catch (_error) {
          // Durable entries remain queued until Store Ops and the source acknowledge them.
        }
      }
      return acknowledged;
    })().finally(() => {
      completionQueueFlushPromise = null;
    });
    return completionQueueFlushPromise;
  };

  const showBoardAlert = (message) => {
    if (!board || !message) return;
    board.insertAdjacentHTML('afterbegin', `<div class="admin-board-empty admin-board-alert">${escapeHtml(message)}</div>`);
  };

  const applyFulfillmentState = (order, fulfillment) => {
    if (!order || !fulfillment || typeof fulfillment !== 'object') return;
    order.fulfillmentStatus = String(fulfillment.fulfillmentStatus || order.fulfillmentStatus || 'UNCLAIMED');
    order.claimedBy = fulfillment.claimedBy || null;
    order.claimedByName = String(fulfillment.claimedByName || '');
    order.claimedAt = fulfillment.claimedAt || null;
    order.locked = Boolean(fulfillment.locked);
    order.currentEmployeeCanWork = fulfillment.currentEmployeeCanWork !== false;
    order.claimStale = Boolean(fulfillment.claimStale);
    order.scanProgress = fulfillment.scanProgress || order.scanProgress || { completed: 0, required: 0, percent: 0 };
    order.started = Boolean(order.claimedBy && order.currentEmployeeCanWork && order.fulfillmentStatus !== 'FULFILLED');
  };

  const openPrintLabelPage = (orderValue, { reprint = false } = {}) => {
    const requestedId = typeof orderValue === 'object' ? String(orderValue?.order_id || orderValue?.id || '') : String(orderValue || '');
    const queueOrder = state.orders.find((item) => normalizeOrderId(item.id) === normalizeOrderId(requestedId));
    const order = typeof orderValue === 'object' ? orderValue : (queueOrder || {});
    const label = order?.shipping_label || {};
    const source = order?.source || {};
    const printableOrderId = order?.order_id || order?.id || requestedId;
    const account = label.account || source.account || order?.sourceAccountKey || '';
    const platform = String(label.platform || source.platform || source.key || order?.platform || '').toLowerCase();
    const packageNumber = String(label.package || order?.packageNumber || order?.package_number || '').trim();
    openStorePage(`./print-label/?order=${encodeURIComponent(printableOrderId)}${account ? `&account=${encodeURIComponent(account)}` : ''}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}${packageNumber ? `&package=${encodeURIComponent(packageNumber)}` : ''}${reprint ? '&reprint=1' : ''}`);
  };

  const openResolvedReprintOrder = (order) => {
    const label = order?.shipping_label || {};
    if (label.supported === false) {
      showReprintError('This order does not have a shipping label to reprint.');
      return;
    }
    if (label.available === false) {
      showReprintError(label.unavailable_reason || 'This shipping label is not available for reprint.');
      return;
    }
    openPrintLabelPage(order, { reprint: true });
  };

  const lookupExactReprintOrder = async (orderId) => {
    if (reprintSubmit instanceof HTMLButtonElement) {
      reprintSubmit.disabled = true;
      reprintSubmit.textContent = 'Finding order…';
    }
    clearReprintError();
    try {
      const params = new URLSearchParams({ action: 'order', order_id: orderId });
      const response = await fetch(`${orderLookupEndpoint}?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Order lookup failed.');
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || 'Order lookup failed.');
      }
      openResolvedReprintOrder(payload.order || {});
    } catch (error) {
      showReprintError(error instanceof Error ? error.message : 'Order lookup failed.');
    } finally {
      if (reprintSubmit instanceof HTMLButtonElement) {
        reprintSubmit.disabled = false;
        reprintSubmit.textContent = 'Open exact Order ID';
      }
    }
  };

  const settingsTabTitles = {
    scanner: 'Scanner setup',
    theme: 'Theme',
    platforms: 'Platform colors',
    printer: 'Label printer'
  };

  const activateSettingsTab = (tab) => {
    activeSettingsTab = Object.hasOwn(settingsTabTitles, tab) ? tab : 'scanner';
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
      const isActive = button.dataset.settingsTab === activeSettingsTab;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      const isActive = panel.dataset.settingsPanel === activeSettingsTab;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
    if (settingsTitle) settingsTitle.textContent = settingsTabTitles[activeSettingsTab];
  };

  const openSettingsModal = () => {
    if (!settingsModal) return;
    if (settingsError) {
      settingsError.textContent = '';
      settingsError.hidden = true;
    }
    activateSettingsTab(activeSettingsTab);
    renderScannerSettings();
    renderSourceColorList();
    settingsModal.hidden = false;
    checkScannerHealth().catch(() => {});
    if (scannerSelectButton instanceof HTMLButtonElement) {
      window.setTimeout(() => scannerSelectButton.focus(), 40);
    }
  };

  const closeSettingsModal = () => {
    if (settingsModal) settingsModal.hidden = true;
  };

  const normalizeEmployeeId = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64);

  const showEmployeeProfileError = (message) => {
    if (!employeeProfileError) return;
    employeeProfileError.textContent = message;
    employeeProfileError.hidden = false;
  };

  const clearEmployeeProfileError = () => {
    if (!employeeProfileError) return;
    employeeProfileError.textContent = '';
    employeeProfileError.hidden = true;
  };

  const employeeProfileFields = () => ({
    id: employeeProfileForm?.querySelector('input[name="id"]') || null,
    displayName: employeeProfileForm?.querySelector('input[name="display_name"]') || null,
    pin: employeeProfileForm?.querySelector('input[name="pin"]') || null,
    active: employeeProfileForm?.querySelector('input[name="active"]') || null
  });

  const resetEmployeeProfileForm = () => {
    if (!employeeProfileForm) return;
    employeeProfileForm.reset();
    const fields = employeeProfileFields();
    if (fields.id instanceof HTMLInputElement) {
      fields.id.readOnly = false;
      fields.id.value = '';
      fields.id.dataset.userEdited = '';
    }
    if (fields.displayName instanceof HTMLInputElement) fields.displayName.value = '';
    if (fields.pin instanceof HTMLInputElement) {
      fields.pin.value = '';
      fields.pin.placeholder = 'Required for new profile';
    }
    if (fields.active instanceof HTMLInputElement) fields.active.checked = true;
    clearEmployeeProfileError();
  };

  const renderEmployeeProfiles = () => {
    if (!employeeProfileList) return;
    if (!employeeProfiles.length) {
      employeeProfileList.innerHTML = '<p class="admin-empty">No employee profiles yet.</p>';
      return;
    }

    employeeProfileList.innerHTML = employeeProfiles.map((employee) => {
      const isActive = Boolean(employee.active);
      return `
        <article class="admin-employee-profile-row">
          <span class="admin-employee-profile-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>
          </span>
          <div class="admin-employee-profile-main">
            <strong>${escapeHtml(employee.display_name || employee.id)}</strong>
            <span>${escapeHtml(employee.id)}</span>
          </div>
          <span class="admin-status-badge ${isActive ? '' : 'admin-status-badge-warn'}">${isActive ? 'Active' : 'Inactive'}</span>
          <button type="button" class="admin-ghost-btn" data-edit-employee-profile="${escapeHtml(employee.id)}">Edit</button>
        </article>
      `;
    }).join('');
  };

  const loadEmployeeProfiles = async () => {
    if (!employeeProfilesModal) return;
    if (employeeProfileList) employeeProfileList.innerHTML = '<p class="admin-empty">Loading employee profiles.</p>';
    const response = await fetch(employeeProfilesEndpoint, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const payload = await readJsonResponse(response, 'Unable to load employee profiles.');
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Unable to load employee profiles.');
    }
    employeeProfiles = Array.isArray(payload.employees) ? payload.employees : [];
    renderEmployeeProfiles();
  };

  const editEmployeeProfile = (employeeId) => {
    const employee = employeeProfiles.find((item) => String(item.id || '') === employeeId);
    if (!employee || !employeeProfileForm) return;
    const fields = employeeProfileFields();
    if (fields.id instanceof HTMLInputElement) {
      fields.id.value = employee.id || '';
      fields.id.readOnly = true;
      fields.id.dataset.userEdited = '1';
    }
    if (fields.displayName instanceof HTMLInputElement) fields.displayName.value = employee.display_name || '';
    if (fields.pin instanceof HTMLInputElement) {
      fields.pin.value = '';
      fields.pin.placeholder = 'Leave blank to keep current PIN';
    }
    if (fields.active instanceof HTMLInputElement) fields.active.checked = Boolean(employee.active);
    clearEmployeeProfileError();
    if (fields.displayName instanceof HTMLInputElement) fields.displayName.focus();
  };

  const openEmployeeProfilesModal = () => {
    if (!employeeProfilesModal) return;
    resetEmployeeProfileForm();
    employeeProfilesModal.hidden = false;
    loadEmployeeProfiles()
      .then(() => {
        const fields = employeeProfileFields();
        if (fields.displayName instanceof HTMLInputElement) window.setTimeout(() => fields.displayName.focus(), 40);
      })
      .catch((error) => {
        employeeProfiles = [];
        renderEmployeeProfiles();
        showEmployeeProfileError(error instanceof Error ? error.message : 'Unable to load employee profiles.');
      });
  };

  const closeEmployeeProfilesModal = () => {
    if (employeeProfilesModal) employeeProfilesModal.hidden = true;
  };

  const saveEmployeeProfile = async () => {
    if (!employeeProfileForm) return;
    const fields = employeeProfileFields();
    const id = fields.id instanceof HTMLInputElement ? normalizeEmployeeId(fields.id.value) : '';
    const displayName = fields.displayName instanceof HTMLInputElement ? fields.displayName.value.trim() : '';
    const pin = fields.pin instanceof HTMLInputElement ? fields.pin.value : '';
    const active = fields.active instanceof HTMLInputElement ? fields.active.checked : true;

    clearEmployeeProfileError();

    const response = await fetch(employeeProfilesEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'save_employee',
        id,
        display_name: displayName,
        pin,
        active
      })
    });
    const payload = await readJsonResponse(response, 'Unable to save employee profile.');
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Unable to save employee profile.');
    }

    employeeProfiles = Array.isArray(payload.employees) ? payload.employees : [];
    renderEmployeeProfiles();
    resetEmployeeProfileForm();
  };

  const minutesRemaining = (order) => orderPresentation.minutesRemaining(order);
  const isCriticalOrder = (order) => orderPresentation.isCriticalOrder(order);
  const formatDeadline = (order) => orderPresentation.formatDeadline(order);

  const formatClock = () => {
    const formatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (boardClock) boardClock.textContent = formatter.format(new Date());
  };

  let audioContext = null;
  let audioUnlocked = false;
  let sirenTimer = 0;

  const unlockAudio = () => {
    if (audioUnlocked) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext = new AudioContextClass();
    audioUnlocked = true;
    refreshSiren();
  };

  const playSirenPulse = () => {
    if (!audioContext || audioContext.state === 'closed') return;
    const start = audioContext.currentTime;
    const compressor = audioContext.createDynamicsCompressor();
    const master = audioContext.createGain();
    compressor.threshold.setValueAtTime(-24, start);
    compressor.knee.setValueAtTime(18, start);
    compressor.ratio.setValueAtTime(8, start);
    compressor.attack.setValueAtTime(0.003, start);
    compressor.release.setValueAtTime(0.18, start);
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.56, start + 0.035);
    master.gain.setValueAtTime(0.56, start + 0.5);
    master.gain.exponentialRampToValueAtTime(0.0001, start + 0.68);
    compressor.connect(master).connect(audioContext.destination);

    [
      { type: 'square', low: 640, high: 1460, gain: 0.82 },
      { type: 'sawtooth', low: 430, high: 1040, gain: 0.48 }
    ].forEach((voice) => {
      const oscillator = audioContext.createOscillator();
      const voiceGain = audioContext.createGain();
      oscillator.type = voice.type;
      oscillator.frequency.setValueAtTime(voice.low, start);
      oscillator.frequency.linearRampToValueAtTime(voice.high, start + 0.18);
      oscillator.frequency.setValueAtTime(voice.high, start + 0.27);
      oscillator.frequency.linearRampToValueAtTime(voice.low, start + 0.48);
      voiceGain.gain.setValueAtTime(voice.gain, start);
      oscillator.connect(voiceGain).connect(compressor);
      oscillator.start(start);
      oscillator.stop(start + 0.72);
    });

    const noiseBuffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * 0.12), audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
    const noise = audioContext.createBufferSource();
    const noiseGain = audioContext.createGain();
    noise.buffer = noiseBuffer;
    noiseGain.gain.setValueAtTime(0.22, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    noise.connect(noiseGain).connect(compressor);
    noise.start(start);
  };

  const refreshSiren = () => {
    const hasSirenEligibleOrder = listedOrders().some((order) => !order.started && orderPresentation.shouldSoundSiren(order));
    if (!hasSirenEligibleOrder || !audioUnlocked) {
      window.clearInterval(sirenTimer);
      sirenTimer = 0;
      return;
    }

    if (!sirenTimer) {
      playSirenPulse();
      sirenTimer = window.setInterval(playSirenPulse, 980);
    }
  };

  const renderMetrics = () => {
    const listed = listedOrders();
    if (listedCount) listedCount.textContent = String(listed.length);
    if (productsLeftCount) productsLeftCount.textContent = String(productsLeftToPackage(listed));
    if (criticalCount) criticalCount.textContent = String(listed.filter((order) => isCriticalOrder(order)).length);
    if (startedCount) startedCount.textContent = String(state.orders.filter((order) => order.claimedBy && order.fulfillmentStatus !== 'FULFILLED').length);
    if (fulfillingCount) fulfillingCount.textContent = String(state.orders.filter((order) => !['UNCLAIMED', 'FULFILLED'].includes(order.fulfillmentStatus)).length);
    if (dropOffFilter) {
      const dropOffCount = listed.filter((order) => orderPresentation.isDropOff(order)).length;
      dropOffFilter.classList.toggle('is-active', dropOffOnly);
      dropOffFilter.setAttribute('aria-pressed', dropOffOnly ? 'true' : 'false');
      dropOffFilter.title = dropOffOnly
        ? `Showing ${dropOffCount} drop-off order${dropOffCount === 1 ? '' : 's'}. Click to show all ${listed.length} listed orders.`
        : `Show only ${dropOffCount} drop-off order${dropOffCount === 1 ? '' : 's'}. This does not change any order status.`;
    }
    const waitingForArrangement = listed.filter((order) => {
      const platform = normalizeSourceKey(order.platform);
      return ['shopee', 'tiktok'].includes(platform)
        && !order.labelBacked
        && !orderPresentation.isInstantManualLifecycle(order)
        && !orderPresentation.isCancellationRequested(order);
    }).length;
    const sourceError = orderSourceErrors[0] || '';
    if (automationPauseNotice) automationPauseNotice.hidden = !automaticArrangementPaused && sourceError === '';
    if (automationPauseTitle) {
      automationPauseTitle.textContent = sourceError === ''
        ? 'Automatic arrangement is paused'
        : 'Marketplace connection problem';
    }
    if (automationPauseCopy) {
      automationPauseCopy.textContent = sourceError !== ''
        ? `${sourceError}. Existing orders remain on the board.`
        : (waitingForArrangement
          ? `${waitingForArrangement} order${waitingForArrangement === 1 ? '' : 's'} still need marketplace arrangement. Arranged orders can be processed normally.`
          : 'All visible marketplace orders are arranged and can be processed normally.');
    }
  };

  const renderBoardMessage = (message, options = {}) => {
    if (!board) return;
    board.setAttribute('aria-busy', options.loading ? 'true' : 'false');
    if (options.loading) {
      board.innerHTML = `
        <div class="admin-board-empty admin-board-loading" role="status" aria-live="polite">
          <strong>${escapeHtml(message)}</strong>
          <span class="admin-loading-worm" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
        </div>
      `;
    } else {
      board.innerHTML = `<div class="admin-board-empty">${escapeHtml(message)}</div>`;
    }
    renderMetrics();
  };

  const renderBoard = () => {
    if (!board) return;
    if (orderPresentation.shouldShowOrderLoading(ordersSnapshotReady, state.orders)) {
      renderBoardMessage('Loading Orders', { loading: true });
      return;
    }
    board.setAttribute('aria-busy', 'false');
    const ordersChanged = syncOrdersFromStorage();
    if (ordersChanged) saveOrders();
    const currentActiveOrder = activeOrder();
    if (state.activeOrderId && (!currentActiveOrder || currentActiveOrder.fulfillmentStatus === 'FULFILLED' || currentActiveOrder.currentEmployeeCanWork === false)) {
      closeFulfillment();
    }
    const currentPreviewOrder = state.orders.find((order) => order.id === state.previewOrderId);
    if (state.previewOrderId && (!currentPreviewOrder || currentPreviewOrder.fulfillmentStatus === 'FULFILLED')) {
      closeFulfillment();
    } else if (currentPreviewOrder && modal?.dataset.mode === 'preview') {
      renderOrderPreview(currentPreviewOrder);
    }
    const allListedOrders = listedOrders();
    const orders = visibleListedOrders(allListedOrders);
    const boardFlow = orderPresentation.columnFirstBoardFlow(
      orders.length,
      board.clientWidth || board.parentElement?.clientWidth || window.innerWidth
    );
    board.style.setProperty('--order-columns', String(boardFlow.columns));
    board.style.setProperty('--order-rows', String(boardFlow.rows));
    if (boardDensity) boardDensity.textContent = `${orders.length} visible orders`;
    if (boardOverflow) boardOverflow.hidden = true;

    if (!orders.length) {
      board.innerHTML = dropOffOnly && allListedOrders.length
        ? `<div class="admin-board-empty">No drop-off orders waiting. Turn off “Drop-off only” to see all ${allListedOrders.length} listed orders.</div>`
        : '<div class="admin-board-empty">No listed orders waiting.</div>';
      renderMetrics();
      refreshSiren();
      return;
    }

    board.innerHTML = orders.map((order, index) => {
      const isCritical = isCriticalOrder(order);
      const sourceKey = sourceKeyFromOrder(order);
      const sourceLabel = sourceLabelFromOrder(order);
      const sourceColor = colorForSource(sourceKey);
      const customSourceColor = isCustomSourceColor(sourceColor) ? sourceColor.toUpperCase() : '';
      const isLocked = order.locked && !order.currentEmployeeCanWork;
      const isDropOff = orderPresentation.isDropOff(order);
      const isWeekendDependent = Boolean(order.weekendDependent);
      const shopeeManualRequired = Boolean(order.shopeeManualRequired);
      const cancellationRequested = orderPresentation.isCancellationRequested(order);
      const arrangementRetryRequired = Boolean(order.arrangementRetryRequired);
      const instantManualLifecycle = orderPresentation.isInstantManualLifecycle(order) && !order.labelBacked;
      const marketplacePlatform = normalizeSourceKey(order.platform);
      const pausedUnarranged = automaticArrangementPaused
        && ['shopee', 'tiktok'].includes(marketplacePlatform)
        && !order.labelBacked
        && !instantManualLifecycle
        && !cancellationRequested;
      const shopeeState = String(order.shopeeArrangementState || '').trim().toLowerCase();
      const shopeeDelayed = Boolean(order.deadlineDelayed);
      const automaticShopeePending = shopeeState === 'automatic' && !automaticArrangementPaused;
      const manualArrangementNeeded = shopeeManualRequired && !shopeeDelayed && (
        !shopeeState
        || ['required', 'failed', 'label_failed'].includes(shopeeState)
        || (shopeeState === 'automatic' && automaticArrangementPaused)
      );
      const manualArrangementVisual = manualArrangementNeeded || shopeeState === 'requested';
      const pickupSlotLabel = order.handoverMethod === 'PICKUP' ? orderPresentation.formatHandoverSlot(order) : '';
      const handoverDescription = order.shippingProviderName
        ? `Drop-off order via ${order.shippingProviderName}`
        : 'Drop-off order';
      const claimedBySelf = order.claimedBy && order.claimedBy === currentEmployee.id;
      const claimLabel = cancellationRequested
        ? 'Cancellation requested'
        : (order.claimedByName
          ? `${order.claimStale ? 'Stale' : 'Claimed'} by ${order.claimedByName}`
          : (order.instant && orderPresentation.isMarketplaceShipmentArranged(order) ? 'Shipment arranged' : order.marketplaceStatus));
      const buttonLabel = order.claimStale ? 'Reclaim' : (claimedBySelf ? 'Resume' : (index === 0 ? 'Start Next' : 'Start'));
      const cardStyles = customSourceColor
        ? `--order-source-accent: ${escapeHtml(customSourceColor)}; --order-source-border: ${escapeHtml(customSourceColor)}; --order-source-border-hover: ${escapeHtml(customSourceColor)}`
        : '';
      const buttonIcon = isLocked
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
        : (order.claimStale
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>'
          : (claimedBySelf
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'));
      let actionButton = `<button type="button" class="admin-start-order-btn ${claimedBySelf ? 'is-resume' : ''} ${order.claimStale ? 'is-reclaim' : ''}" data-start-order="${escapeHtml(order.id)}" ${isLocked ? 'disabled' : ''}>${buttonIcon}<span>${escapeHtml(isLocked ? 'Locked' : buttonLabel)}</span></button>`;
      if (cancellationRequested) {
        const marketplaceName = String(order.platform || 'marketplace').trim() || 'marketplace';
        actionButton = `<button type="button" class="admin-start-order-btn admin-manual-order-btn is-cancellation" title="Cancellation requested — do not process. Resolve it in ${escapeHtml(marketplaceName)}." disabled><span>Handle in ${escapeHtml(marketplaceName)}</span></button>`;
      } else if (shopeeManualRequired) {
        const shopeeDisabled = !bigSetEnabled
          || isLocked
          || shopeeDelayed
          || automaticShopeePending
          || ['processing', 'requested', 'label_pending'].includes(shopeeState);
        const shopeeLabel = !bigSetEnabled
          ? 'Big Set locked'
          : (automaticShopeePending
            ? 'Auto-arranging…'
            : (shopeeState === 'processing'
            ? 'Arranging…'
            : (shopeeState === 'requested'
            ? 'Arranging…'
            : (shopeeState === 'label_pending'
              ? 'Preparing label…'
              : (shopeeState === 'label_failed'
                ? 'Retry label'
                : 'Manual arrange')))));
        const shopeeTitle = automaticShopeePending
          ? 'Automatic Shopee arrangement is healthy and still owns this order.'
          : (shopeeDelayed
            ? 'Shopee has delayed this order and has not released shipping options yet.'
            : (order.shopeeArrangementError || 'Arrange this Shopee order from Store Ops.'));
        actionButton = `<button type="button" class="admin-start-order-btn admin-manual-order-btn is-shopee-action ${manualArrangementNeeded ? 'is-manual-needed' : ''}" data-arrange-shopee="${escapeHtml(order.id)}" title="${escapeHtml(shopeeTitle)}" ${shopeeDisabled ? 'disabled' : ''}><span>${escapeHtml(shopeeLabel)}</span></button>`;
      } else if (arrangementRetryRequired) {
        const retrying = String(order.arrangementRetryState || '').toLowerCase() === 'retrying';
        actionButton = `<button type="button" class="admin-start-order-btn admin-manual-order-btn is-arrangement-retry" data-retry-arrangement="${escapeHtml(order.id)}" title="${escapeHtml(order.arrangementRetryError || 'Automatic shipment arrangement exhausted its retries.')}" ${retrying || automaticArrangementPaused ? 'disabled' : ''}><span>${automaticArrangementPaused ? 'Arrangement paused' : (retrying ? 'Retrying…' : 'Arrangement failed — retry')}</span></button>`;
      } else if (instantManualLifecycle) {
        const instantAction = orderPresentation.instantArrangementAction(order, {
          enabled: bigSetEnabled,
          locked: isLocked,
          submitting: arrangingInstantOrderIds.has(order.id)
        });
        actionButton = `<button type="button" class="admin-start-order-btn admin-manual-order-btn is-instant-action" data-arrange-instant="${escapeHtml(order.id)}" title="${escapeHtml(instantAction.error || 'Accept and arrange this Instant shipment.')}" ${instantAction.disabled ? 'disabled' : ''}><span>${escapeHtml(instantAction.label)}</span></button>`;
      } else if (pausedUnarranged) {
        actionButton = isWeekendDependent
          ? `<button type="button" class="admin-start-order-btn admin-paused-order-btn is-weekend-dependent-action" disabled><span>${order.weekendDependentAutoWindowOpen ? 'Weekend auto-arranging' : 'Arrange manually now'}</span></button>`
          : '<button type="button" class="admin-start-order-btn admin-paused-order-btn" disabled><span>Arrange in marketplace</span></button>';
      }
      return `
        <article
          class="admin-order-card ${isCritical && !isLocked && !order.instant ? 'is-deadline-urgent' : ''} ${order.instant ? 'is-instant' : ''} ${isWeekendDependent ? 'is-weekend-dependent' : ''} ${manualArrangementVisual ? 'is-manual-arrangement' : ''} ${cancellationRequested ? 'is-cancellation-requested' : ''} ${arrangementRetryRequired ? 'is-arrangement-failed' : ''} ${pausedUnarranged || (shopeeManualRequired && !shopeeDelayed) ? 'is-awaiting-arrangement' : ''} ${shopeeDelayed ? 'is-delayed' : ''} ${order.started ? 'is-started' : ''} ${isLocked ? 'is-locked' : ''} ${isDropOff ? 'is-drop-off' : ''}"
          data-order-id="${escapeHtml(order.id)}"
          data-source-key="${escapeHtml(sourceKey)}"
          ${claimedBySelf ? 'data-claim-owner="self" title="Right-click for claim actions"' : ''}
          ${order.handoverMethod ? `data-handover-method="${escapeHtml(order.handoverMethod)}"` : ''}
          ${sourceColor ? `data-source-color="${customSourceColor ? 'custom' : escapeHtml(sourceColor)}"` : ''}
          ${cardStyles ? `style="${cardStyles}"` : ''}
        >
          <button type="button" class="admin-order-preview-trigger" data-preview-order="${escapeHtml(order.id)}" aria-label="Preview order ${escapeHtml(order.id)}"></button>
          <div class="admin-order-card-top">
            <span class="admin-order-id">${escapeHtml(order.id)}</span>
            ${isWeekendDependent ? `<span class="admin-weekend-dependent-badge" title="Must be arranged on Saturday before ${escapeHtml(order.weekendDependentCutoff || '12:00')}">Weekend Dependent</span>` : ''}
            ${arrangementRetryRequired ? `<span class="admin-arrangement-failed-badge" title="${escapeHtml(order.arrangementRetryError || 'Arrangement failed')}">Arrangement failed</span>` : ''}
            ${isDropOff ? `<span class="admin-dropoff-badge" aria-label="${escapeHtml(handoverDescription)}" title="${escapeHtml(handoverDescription)}">Drop-off</span>` : ''}
            ${order.instant ? '<span class="admin-instant-badge" role="img" aria-label="Instant shipping order" title="Instant shipping order"><svg viewBox="0 0 32 20" aria-hidden="true" focusable="false"><path class="admin-instant-badge-speed" d="M2 6h5.5M1 10h5M3 14h4.5"/><path class="admin-instant-badge-truck" d="M8.5 6.5h11v7.5h-11zM19.5 9.2h4.1l3.1 3.2V14h-7.2zM22.1 9.2v3.2h4.6"/><circle class="admin-instant-badge-wheel" cx="11.5" cy="15" r="2"/><circle class="admin-instant-badge-wheel" cx="23.5" cy="15" r="2"/></svg><span class="admin-instant-badge-label">Instant</span></span>' : ''}
          </div>
          <div class="admin-order-deadline">${order.deadlineLabel ? `<span>${escapeHtml(order.deadlineLabel)}</span>` : ''}${escapeHtml(formatDeadline(order))}${pickupSlotLabel ? `<small>Pickup ${escapeHtml(pickupSlotLabel)}</small>` : ''}</div>
          <div class="admin-order-meta">
            <span>${escapeHtml(sourceLabel)}</span>
            <span>${escapeHtml(claimLabel)}</span>
          </div>
          ${actionButton}
        </article>
      `;
    }).join('');

    renderMetrics();
    refreshSiren();
  };

  dropOffFilter?.addEventListener('click', () => {
    dropOffOnly = !dropOffOnly;
    renderBoard();
  });

  const scheduleBoardRender = () => {
    window.clearTimeout(boardResizeTimer);
    boardResizeTimer = window.setTimeout(renderBoard, 80);
  };

  const renderOrderPreview = (order) => {
    if (!previewStage) return;
    const unitCount = orderProductCount(order);
    const lineCount = order.items.length;
    const sourceLabel = sourceLabelFromOrder(order);
    const action = orderPresentation.previewActionState(order, {
      automaticArrangementPaused,
      currentEmployeeId: currentEmployee.id
    });
    const pickupSlot = order.handoverMethod === 'PICKUP' ? orderPresentation.formatHandoverSlot(order) : '';
    const handoverLabel = orderPresentation.isDropOff(order)
      ? `Drop-off${order.shippingProviderName ? ` · ${order.shippingProviderName}` : ''}`
      : (pickupSlot ? `Pickup · ${pickupSlot}` : 'Standard fulfillment');
    const claimLabel = order.claimedByName
      ? `${order.claimStale ? 'Stale claim' : 'Claimed'} · ${order.claimedByName}`
      : 'Ready to claim';
    const customerName = String(order.customerName || '').trim();
    const packageNumber = String(order.packageNumber || '').trim();
    const shopeeState = String(order.shopeeArrangementState || '').trim().toLowerCase();
    const arrangementIssue = order.instant && String(order.instantArrangementError || '').trim()
      ? String(order.instantArrangementError || '').trim()
      : (['failed', 'label_failed'].includes(shopeeState)
        ? String(order.shopeeArrangementError || '').trim()
        : (order.arrangementRetryRequired ? String(order.arrangementRetryError || '').trim() : ''));

    if (modalTitle) modalTitle.textContent = order.id;
    if (modalStepLabel) modalStepLabel.textContent = 'Order preview';
    previewStage.innerHTML = `
      <section class="admin-preview-hero">
        <span class="admin-preview-hero-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5z"/><path d="m5 7.5 7 3.5 7-3.5M12 11v9"/></svg>
        </span>
        <div class="admin-preview-hero-copy">
          <span>${escapeHtml(sourceLabel)}</span>
          <strong>${lineCount} product line${lineCount === 1 ? '' : 's'} · ${unitCount} unit${unitCount === 1 ? '' : 's'}</strong>
          <small>Review the complete order before assigning it to yourself.</small>
        </div>
        <div class="admin-preview-deadline ${isCriticalOrder(order) && !order.instant ? 'is-deadline-urgent' : ''}">
          ${order.deadlineLabel ? `<span>${escapeHtml(order.deadlineLabel)}</span>` : ''}
          <strong>${escapeHtml(formatDeadline(order))}</strong>
        </div>
      </section>

      <div class="admin-preview-facts">
        <div><span>Order status</span><strong>${escapeHtml(order.marketplaceStatus || order.status)}</strong></div>
        <div><span>Assignment</span><strong>${escapeHtml(claimLabel)}</strong></div>
        <div><span>Handover</span><strong>${escapeHtml(handoverLabel)}</strong></div>
        ${customerName ? `<div><span>Customer</span><strong>${escapeHtml(customerName)}</strong></div>` : ''}
        ${packageNumber ? `<div><span>Package</span><strong>${escapeHtml(packageNumber)}</strong></div>` : ''}
        ${arrangementIssue ? `<div class="admin-preview-arrangement-issue"><span>Arrangement issue</span><strong>${escapeHtml(arrangementIssue)}</strong></div>` : ''}
      </div>

      <section class="admin-preview-products">
        <div class="admin-preview-section-head">
          <div><span>Order breakdown</span><strong>Products to grab</strong></div>
          <em>${unitCount} total</em>
        </div>
        <div class="admin-preview-product-list">
          ${order.items.length ? order.items.map((item, index) => {
            const productName = item.productName || item.scanProductName || 'Order item';
            const sku = String(item.sourceSkus?.[0] || item.sku || item.tag || '').trim();
            const quantity = Math.max(1, Number(item.quantity || 1));
            return `
              <article class="admin-preview-product">
                <span class="admin-preview-product-index">${index + 1}</span>
                <div><strong>${escapeHtml(productName)}</strong><small>${escapeHtml(sku || 'SKU unavailable')}</small></div>
                <em>x${escapeHtml(quantity)}</em>
              </article>
            `;
          }).join('') : '<p class="admin-preview-empty">No product details are available for this order.</p>'}
        </div>
      </section>

      <div class="admin-preview-action-bar">
        <div><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(action.note)}</span></div>
        <button type="button" class="admin-primary-btn admin-preview-start" data-preview-start="${escapeHtml(order.id)}" ${action.disabled ? 'disabled' : ''}>
          <span>${escapeHtml(action.label)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
        </button>
      </div>
    `;
  };

  const openOrderPreview = (orderId) => {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) return;
    state.previewOrderId = order.id;
    renderOrderPreview(order);
    if (pickStage) pickStage.hidden = true;
    if (previewStage) previewStage.hidden = false;
    if (modal) {
      modal.dataset.mode = 'preview';
      modal.hidden = false;
    }
  };

  const renderPickStage = (order) => {
    if (modalTitle) modalTitle.textContent = order.id;
    if (modalStepLabel) modalStepLabel.textContent = 'Pick List';
    if (orderSummary) {
      orderSummary.innerHTML = `
        <span><strong>${escapeHtml(sourceLabelFromOrder(order))}</strong> ${escapeHtml(order.marketplaceStatus)}</span>
        <span><strong>Status</strong> ${escapeHtml(order.status)}</span>
        ${orderPresentation.isDropOff(order) ? `<span class="admin-dropoff-summary"><strong>Handover</strong> DROP-OFF${order.shippingProviderName ? ` · ${escapeHtml(order.shippingProviderName)}` : ''}</span>` : ''}
        ${order.handoverMethod === 'PICKUP' && orderPresentation.formatHandoverSlot(order) ? `<span><strong>Pickup</strong> ${escapeHtml(orderPresentation.formatHandoverSlot(order))}</span>` : ''}
        <span>${order.deadlineLabel ? `<strong>${escapeHtml(order.deadlineLabel)}</strong> ` : ''}${escapeHtml(formatDeadline(order))}</span>
      `;
    }
    if (pickList) {
      pickList.innerHTML = order.items.map((item) => {
        const scanQuantity = Number(item.scanQuantity || item.quantity);
        const multiplier = Number(item.scanMultiplier || 1);
        const scanSku = String(item.scanSku || item.sku || '');
        const skipped = Number(item.skipQuantity || (item.skipScan ? scanQuantity : 0));
        const orderedSku = String(item.sku || '');
        const scanNote = skipped > 0
          ? `${scanSku} / Skip Scan`
          : (multiplier > 1 ? `Scan ${scanSku} ${multiplier}X per unit (${scanQuantity} scans)` : `Scan ${scanSku || orderedSku}`);
        return `
          <article class="admin-pick-item">
            <div>
              <strong>${escapeHtml(item.productName || item.scanProductName)}</strong>
              <span>${escapeHtml(scanNote)}</span>
            </div>
            <em>x${escapeHtml(item.quantity || scanQuantity)}</em>
          </article>
        `;
      }).join('');
    }
  };

  const openFulfillment = async (orderId) => {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) return;
    if (
      automaticArrangementPaused
      && ['shopee', 'tiktok'].includes(normalizeSourceKey(order.platform))
      && !order.labelBacked
    ) return;
    if (orderPresentation.isCancellationRequested(order) || orderPresentation.requiresManualInstantArrangement(order)) return;
    if (order.locked && !order.currentEmployeeCanWork) return;
    if (startingOrderIds.has(order.id)) return;
    startingOrderIds.add(order.id);
    try {
      // Claiming is the authentication preflight. The pick flow never opens
      // until the server confirms both the weekly session and this profile.
      const payload = await postOrderAction('claim_order', order);
      applyFulfillmentState(order, payload.fulfillment || payload.order);
      state.activeOrderId = order.id;
      state.previewOrderId = '';
      state.scans = new Map();
      saveOrders();
      refreshSiren();
      renderPickStage(order);
      if (previewStage) previewStage.hidden = true;
      if (pickStage) pickStage.hidden = false;
      if (modal) {
        modal.dataset.mode = 'pick';
        modal.hidden = false;
      }
    } catch (error) {
      if (error instanceof StoreOpsAuthenticationRequiredError) {
        redirectToStoreOpsLogin();
        return;
      }
      await refreshOrders(false, { force: true }).catch(() => {});
      showBoardAlert(error instanceof Error ? error.message : 'Unable to claim this order.');
    } finally {
      startingOrderIds.delete(order.id);
      renderBoard();
    }
  };

  const arrangeInstantShipment = async (orderId) => {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order || !order.instant || order.labelBacked || orderPresentation.isCancellationRequested(order) || !bigSetEnabled) return;
    if (arrangingInstantOrderIds.has(order.id) || (order.locked && !order.currentEmployeeCanWork)) return;
    arrangingInstantOrderIds.add(order.id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100000);
    order.instantArrangementState = 'requested';
    order.instantArrangementError = '';
    saveOrders();
    renderBoard();
    try {
      const payload = await postOrderAction('arrange_instant_shipment', order, {}, { signal: controller.signal });
      const arrangement = payload.arrangement && typeof payload.arrangement === 'object' ? payload.arrangement : {};
      order.instantArrangementState = String(arrangement.state || 'requested');
      order.instantArrangementError = String(arrangement.error || '');
      saveOrders();
      renderBoard();
      clearTimeout(timeout);
      arrangingInstantOrderIds.delete(order.id);
      renderBoard();
      await refreshOrders(false, { force: true });
    } catch (error) {
      order.instantArrangementState = 'failed';
      order.instantArrangementError = error?.name === 'AbortError'
        ? 'The arrangement request timed out. Check the order status or retry.'
        : (error instanceof Error ? error.message : 'Unable to arrange this Instant shipment.');
      saveOrders();
      renderBoard();
      showBoardAlert(order.instantArrangementError);
    } finally {
      clearTimeout(timeout);
      arrangingInstantOrderIds.delete(order.id);
      renderBoard();
    }
  };

  const showShopeeArrangementError = (message) => {
    if (!shopeeArrangementError) return;
    shopeeArrangementError.textContent = String(message || 'Unable to arrange this Shopee shipment.');
    shopeeArrangementError.hidden = false;
  };

  const closeShopeeArrangementModal = () => {
    shopeeArrangementOrderId = '';
    if (shopeeArrangementModal) shopeeArrangementModal.hidden = true;
    if (shopeeArrangementError) {
      shopeeArrangementError.textContent = '';
      shopeeArrangementError.hidden = true;
    }
  };

  const renderShopeeArrangementOptions = (options) => {
    if (!shopeeArrangementOptions) return;
    const pickupOptions = Array.isArray(options?.pickup?.options) ? options.pickup.options : [];
    const dropoffOffered = Boolean(options?.dropoff?.offered);
    const pickupIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17h4V5H2v12h3"/><path d="M14 9h4l4 4v4h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg>';
    const dropoffIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7h20l-2.4-4H4.4z"/><path d="M5 13v8h14v-8M9 21v-5h6v5"/><path d="M2 7v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 2-2.83V7"/></svg>';
    const checkIcon = '<span class="admin-shopee-option-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span>';
    const clockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    const pinIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    const choices = [];
    pickupOptions.forEach((option, index) => {
      const slotLabel = String(option?.label || '').trim();
      const start = String(option?.start_at || '').trim();
      const end = String(option?.end_at || '').trim();
      const fallbackLabel = [start, end].filter(Boolean).join(' – ') || `Pickup time ${index + 1}`;
      const labelParts = (slotLabel || fallbackLabel).split(' · ').map((part) => part.trim()).filter(Boolean);
      const pickupDate = labelParts[0] || `Pickup option ${index + 1}`;
      const pickupTime = labelParts.slice(1).join(' · ') || 'Pickup schedule offered by Shopee';
      choices.push(`
        <label class="admin-shopee-arrangement-option">
          <input type="radio" name="shopee_arrangement" value="pickup-${index}"
            data-handover-method="PICKUP"
            data-pickup-address-id="${escapeHtml(String(option?.address_id || ''))}"
            data-pickup-time-id="${escapeHtml(String(option?.pickup_time_id || ''))}">
          <span class="admin-shopee-option-icon is-pickup">${pickupIcon}</span>
          <span class="admin-shopee-option-copy">
            <span class="admin-shopee-option-type">Courier pickup</span>
            <strong>${escapeHtml(pickupDate)}</strong>
            <small class="admin-shopee-option-meta">${clockIcon}${escapeHtml(pickupTime)}</small>
          </span>
          ${checkIcon}
        </label>`);
    });
    if (dropoffOffered) {
      choices.push(`
        <label class="admin-shopee-arrangement-option">
          <input type="radio" name="shopee_arrangement" value="dropoff" data-handover-method="DROP_OFF">
          <span class="admin-shopee-option-icon is-dropoff">${dropoffIcon}</span>
          <span class="admin-shopee-option-copy">
            <span class="admin-shopee-option-type">Self drop-off</span>
            <strong>Drop off at a Shopee point</strong>
            <small class="admin-shopee-option-meta">${pinIcon}No pickup window required</small>
          </span>
          ${checkIcon}
        </label>`);
    }
    if (!choices.length) {
      shopeeArrangementOptions.innerHTML = '<p class="admin-preview-empty">Shopee is not currently offering a pickup time or drop-off for this order. Close this window and try again shortly.</p>';
      if (shopeeArrangementSubmit instanceof HTMLButtonElement) shopeeArrangementSubmit.disabled = true;
      return;
    }
    shopeeArrangementOptions.innerHTML = `
      <fieldset class="admin-shopee-arrangement-group">
        <legend><strong>Shipping method</strong><small>Choose one option</small></legend>
        ${choices.join('')}
      </fieldset>`;
    if (shopeeArrangementSubmit instanceof HTMLButtonElement) shopeeArrangementSubmit.disabled = true;
  };

  const openShopeeArrangementModal = async (orderId) => {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order?.shopeeManualRequired || order.instant || orderPresentation.isCancellationRequested(order) || !bigSetEnabled) return;
    clearPendingCompletionForOrder(order);
    shopeeArrangementOrderId = order.id;
    if (shopeeArrangementOrder) shopeeArrangementOrder.textContent = order.id;
    if (shopeeArrangementOptions) shopeeArrangementOptions.innerHTML = '<p class="admin-preview-empty">Loading live Shopee options…</p>';
    if (shopeeArrangementError) {
      shopeeArrangementError.textContent = '';
      shopeeArrangementError.hidden = true;
    }
    if (shopeeArrangementSubmit instanceof HTMLButtonElement) shopeeArrangementSubmit.disabled = true;
    if (shopeeArrangementModal) shopeeArrangementModal.hidden = false;
    try {
      const payload = await postOrderAction('get_shopee_arrangement_options', order);
      if (shopeeArrangementOrderId !== order.id) return;
      renderShopeeArrangementOptions(payload.options || {});
    } catch (error) {
      if (error instanceof StoreOpsAuthenticationRequiredError) {
        redirectToStoreOpsLogin();
        return;
      }
      if (shopeeArrangementOptions) shopeeArrangementOptions.innerHTML = '';
      showShopeeArrangementError(error instanceof Error ? error.message : 'Unable to load Shopee shipping options.');
    }
  };

  const arrangeShopeeShipment = async (selection) => {
    const order = state.orders.find((item) => item.id === shopeeArrangementOrderId);
    if (!order?.shopeeManualRequired || !selection?.handover_method) return;
    order.shopeeArrangementState = 'requested';
    order.shopeeArrangementError = '';
    saveOrders();
    renderBoard();
    try {
      const payload = await postOrderAction('arrange_shopee_shipment', order, selection);
      const arrangement = payload.arrangement && typeof payload.arrangement === 'object' ? payload.arrangement : {};
      order.shopeeArrangementState = String(arrangement.state || 'requested');
      order.shopeeArrangementError = String(arrangement.error || '');
      if (order.shopeeArrangementState === 'failed' || arrangement.immediate_succeeded === false) {
        throw new Error(order.shopeeArrangementError || 'Shopee did not accept that shipping option. Choose again.');
      }
      saveOrders();
      renderBoard();
      closeShopeeArrangementModal();
      await refreshOrders(false, { force: true });
    } catch (error) {
      if (error instanceof StoreOpsAuthenticationRequiredError) {
        redirectToStoreOpsLogin();
        return;
      }
      order.shopeeArrangementState = 'failed';
      order.shopeeArrangementError = error instanceof Error ? error.message : 'Unable to arrange this Shopee shipment.';
      saveOrders();
      renderBoard();
      showShopeeArrangementError(order.shopeeArrangementError);
      throw error;
    }
  };

  const retryFailedArrangement = async (orderId) => {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order?.arrangementRetryRequired || automaticArrangementPaused) return;
    order.arrangementRetryState = 'retrying';
    renderBoard();
    try {
      await postOrderAction('retry_arrangement', order);
      await refreshOrders(false, { force: true });
    } catch (error) {
      if (error instanceof StoreOpsAuthenticationRequiredError) {
        redirectToStoreOpsLogin();
        return;
      }
      order.arrangementRetryState = 'failed';
      await refreshOrders(false, { force: true }).catch(() => {});
      showBoardAlert(error instanceof Error ? error.message : 'Shipment arrangement failed again.');
    } finally {
      renderBoard();
    }
  };

  const closeOrderContextMenu = () => {
    if (!orderContextMenu) return;
    orderContextMenu.hidden = true;
    orderContextMenu.removeAttribute('data-order-id');
    if (unclaimOrderButton instanceof HTMLButtonElement) unclaimOrderButton.disabled = false;
    if (removeOrderButton instanceof HTMLButtonElement) removeOrderButton.disabled = false;
  };

  const openOrderContextMenu = (order, clientX, clientY) => {
    if (!orderContextMenu || !orderPresentation.canOpenOrderContextMenu(order, currentEmployee.id)) return;
    const canUnclaim = orderPresentation.canCurrentEmployeeUnclaim(order, currentEmployee.id);
    const canRemove = orderPresentation.canCurrentEmployeeRemove(currentEmployee.id);
    orderContextMenu.dataset.orderId = order.id;
    orderContextMenu.hidden = false;
    if (unclaimOrderButton instanceof HTMLButtonElement) {
      unclaimOrderButton.disabled = !canUnclaim;
      unclaimOrderButton.title = canUnclaim ? '' : 'Only the profile that claimed this order can unclaim it.';
    }
    if (removeOrderButton instanceof HTMLButtonElement) removeOrderButton.disabled = !canRemove;
    const bounds = orderContextMenu.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(clientX, window.innerWidth - bounds.width - margin));
    const top = Math.max(margin, Math.min(clientY, window.innerHeight - bounds.height - margin));
    orderContextMenu.style.left = `${left}px`;
    orderContextMenu.style.top = `${top}px`;
    if (canUnclaim && unclaimOrderButton instanceof HTMLButtonElement) {
      unclaimOrderButton.focus({ preventScroll: true });
    } else if (canRemove && removeOrderButton instanceof HTMLButtonElement) {
      removeOrderButton.focus({ preventScroll: true });
    }
  };

  const removeOrderItemSourceTag = (item, index) => String(
    item?.sourceTags?.[0]
      || item?.sourceSkus?.[0]
      || item?.tag
      || item?.source_tag
      || item?.sku
      || item?.productName
      || item?.product_name
      || `Order item ${index + 1}`
  ).trim();

  const removeOrderCatalogBySku = () => new Map(skuCatalog.map((item) => [
    String(item.sku || '').trim().toUpperCase(),
    item
  ]).filter(([sku]) => sku));

  const syncRemoveOrderStockChoice = () => {
    const selected = removeOrderForm?.querySelector('input[name="stock_action"]:checked');
    const deductStock = selected instanceof HTMLInputElement && selected.value === 'deduct';
    if (removeOrderSkuMapping) removeOrderSkuMapping.hidden = !deductStock;
    removeOrderForm?.querySelectorAll('[data-remove-sku-input]').forEach((field) => {
      if (!(field instanceof HTMLInputElement)) return;
      field.disabled = !deductStock;
      field.required = deductStock;
      if (!deductStock) field.setCustomValidity('');
    });
  };

  const renderRemoveOrderSkuMappings = (order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const catalogBySku = removeOrderCatalogBySku();
    const catalogRows = Array.from(catalogBySku.values()).sort((left, right) => (
      String(left.productName || left.sku).localeCompare(String(right.productName || right.sku))
    ));
    if (removeOrderSkuOptions) {
      removeOrderSkuOptions.innerHTML = catalogRows.map((item) => (
        `<option value="${escapeHtml(String(item.sku || '').toUpperCase())}" label="${escapeHtml(`${item.productName || item.sku} · Stock ${Number(item.currentStock || 0)}`)}"></option>`
      )).join('');
    }

    let unresolved = 0;
    if (removeOrderSkuMappingList) {
      removeOrderSkuMappingList.innerHTML = items.map((item, index) => {
        const sourceTag = removeOrderItemSourceTag(item, index);
        const currentSku = String(item.sku || '').trim().toUpperCase();
        const selectedSku = catalogBySku.has(currentSku) ? currentSku : '';
        if (!selectedSku) unresolved += 1;
        const quantity = Math.max(0, Number(item.quantity || item.qty || 0));
        const productName = String(item.productName || item.scanProductName || item.product_name || 'Order item');
        return `
          <div class="admin-remove-sku-line">
            <span>
              <strong>${escapeHtml(sourceTag)}</strong>
              <small>${escapeHtml(`${quantity} × ${productName}`)}</small>
            </span>
            <label class="admin-remove-sku-field">
              <span>Subtract from SKU</span>
              <input
                class="admin-remove-sku-input"
                type="text"
                list="remove-order-live-skus"
                value="${escapeHtml(selectedSku)}"
                placeholder="Type or select a live SKU"
                autocomplete="off"
                data-remove-sku-input
                data-item-index="${index}"
                data-source-tag="${escapeHtml(sourceTag)}"
              >
            </label>
          </div>`;
      }).join('');
    }
    if (removeOrderSkuMappingSummary) {
      removeOrderSkuMappingSummary.textContent = unresolved > 0
        ? `${unresolved} order tag${unresolved === 1 ? '' : 's'} could not be matched. Assign the correct live SKU before deducting.`
        : 'Review the resolved SKUs below. You can replace any incorrect tag mapping.';
    }
    syncRemoveOrderStockChoice();
  };

  const closeRemoveOrderModal = () => {
    if (!removeOrderModal) return;
    removeOrderModal.hidden = true;
    removeOrderModal.removeAttribute('data-order-id');
    if (removeOrderForm instanceof HTMLFormElement) removeOrderForm.reset();
    if (removeOrderError) {
      removeOrderError.hidden = true;
      removeOrderError.textContent = '';
    }
    if (removeOrderStockAudit) {
      removeOrderStockAudit.textContent = '';
      removeOrderStockAudit.removeAttribute('data-state');
    }
    if (removeOrderSkuMapping) removeOrderSkuMapping.hidden = true;
    if (removeOrderSkuMappingList) removeOrderSkuMappingList.innerHTML = '';
    if (removeOrderSkuOptions) removeOrderSkuOptions.innerHTML = '';
    if (removeOrderSubmit instanceof HTMLButtonElement) removeOrderSubmit.disabled = false;
  };

  const loadRemoveOrderStockAudit = async (order) => {
    if (!removeOrderStockAudit) return;
    removeOrderStockAudit.textContent = 'Checking the shared stock ledger…';
    removeOrderStockAudit.dataset.state = 'checking';
    const params = new URLSearchParams({
      completion_audit: '1',
      order_id: String(order.id || ''),
      source_platform: normalizeSourceKey(order.platform || ''),
      source_account: sourceKeyFromOrder(order)
    });
    try {
      const response = await fetch(`${ordersEndpoint}?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to audit order stock.');
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Unable to audit order stock.');
      const stock = payload.stock && typeof payload.stock === 'object' ? payload.stock : {};
      const deductedAt = String(stock.deducted_at || '').trim();
      if (stock.deducted) {
        const shortage = Math.max(0, Number(stock.shortage_base_quantity || 0));
        removeOrderStockAudit.textContent = shortage > 0
          ? `Stock completion recorded${deductedAt ? ` at ${deductedAt} UTC` : ''}, including a shortage of ${shortage} ASTRA base units. Removing this card will not deduct it again.`
          : `Stock already deducted${deductedAt ? ` at ${deductedAt} UTC` : ''}. Removing this card will not deduct it again.`;
        removeOrderStockAudit.dataset.state = 'deducted';
      } else {
        removeOrderStockAudit.textContent = 'Stock has not been deducted. Choose below whether this order should reduce inventory.';
        removeOrderStockAudit.dataset.state = 'not-deducted';
      }
    } catch (error) {
      removeOrderStockAudit.textContent = error instanceof Error ? error.message : 'Unable to audit order stock.';
      removeOrderStockAudit.dataset.state = 'error';
    }
  };

  const openRemoveOrderModal = (orderId) => {
    if (!removeOrderModal || !orderPresentation.canCurrentEmployeeRemove(currentEmployee.id)) return;
    const order = state.orders.find((item) => item.id === orderId && item.fulfillmentStatus !== 'FULFILLED');
    if (!order) return;
    removeOrderModal.dataset.orderId = order.id;
    if (removeOrderId) removeOrderId.textContent = order.id;
    if (removeOrderError) {
      removeOrderError.hidden = true;
      removeOrderError.textContent = '';
    }
    renderRemoveOrderSkuMappings(order);
    removeOrderModal.hidden = false;
    loadRemoveOrderStockAudit(order).catch(() => {});
    const firstStockAction = removeOrderForm?.querySelector('input[name="stock_action"]');
    const passcodeField = removeOrderForm?.elements.namedItem('passcode');
    if (passcodeField instanceof HTMLInputElement) {
      passcodeField.value = '';
      window.setTimeout(() => {
        if (firstStockAction instanceof HTMLInputElement) firstStockAction.focus();
      }, 30);
    }
  };

  const removeOrderFromListed = async () => {
    const orderId = String(removeOrderModal?.dataset.orderId || '');
    const order = state.orders.find((item) => item.id === orderId);
    const passcodeField = removeOrderForm?.elements.namedItem('passcode');
    const passcode = passcodeField instanceof HTMLInputElement ? passcodeField.value : '';
    const stockActionField = removeOrderForm?.querySelector('input[name="stock_action"]:checked');
    const stockAction = stockActionField instanceof HTMLInputElement ? stockActionField.value : '';
    if (!order || !passcode || !['deduct', 'keep'].includes(stockAction) || !orderPresentation.canCurrentEmployeeRemove(currentEmployee.id)) return;
    const catalogBySku = removeOrderCatalogBySku();
    const mappingsByIndex = new Map();
    if (stockAction === 'deduct') {
      const mappingFields = Array.from(removeOrderForm?.querySelectorAll('[data-remove-sku-input]') || []);
      for (const field of mappingFields) {
        if (!(field instanceof HTMLInputElement)) continue;
        const selectedSku = String(field.value || '').trim().toUpperCase();
        if (!catalogBySku.has(selectedSku)) {
          field.setCustomValidity('Select an exact SKU from the live catalog.');
          field.reportValidity();
          field.focus();
          return;
        }
        field.setCustomValidity('');
        mappingsByIndex.set(Number(field.dataset.itemIndex || -1), {
          sourceTag: String(field.dataset.sourceTag || ''),
          sku: selectedSku
        });
      }
    }
    const items = (Array.isArray(order.items) ? order.items : []).map((item, index) => ({
      source_tag: mappingsByIndex.get(index)?.sourceTag || removeOrderItemSourceTag(item, index),
      sku: mappingsByIndex.get(index)?.sku || String(item.sku || item.tag || item.sourceSkus?.[0] || ''),
      product_name: String(item.productName || item.scanProductName || item.product_name || ''),
      quantity: Math.max(0, Number(item.quantity || item.qty || 0))
    })).filter((item) => item.quantity > 0 && (item.sku || item.product_name));
    const skuMappings = Array.from(mappingsByIndex.values()).map((mapping) => ({
      source_tag: mapping.sourceTag,
      sku: mapping.sku
    }));
    if (removeOrderSubmit instanceof HTMLButtonElement) removeOrderSubmit.disabled = true;
    if (removeOrderError) {
      removeOrderError.hidden = true;
      removeOrderError.textContent = '';
    }
    try {
      const payload = await postOrderAction('remove_order', order, {
        passcode,
        stock_action: stockAction,
        items,
        sku_mappings: skuMappings
      });
      if (passcodeField instanceof HTMLInputElement) passcodeField.value = '';
      applyFulfillmentState(order, payload.fulfillment || payload.order);
      if (state.activeOrderId === order.id || state.previewOrderId === order.id) closeFulfillment(false);
      saveOrders();
      closeRemoveOrderModal();
      renderBoard();
      await refreshOrders(false, { force: true });
    } catch (error) {
      if (passcodeField instanceof HTMLInputElement) passcodeField.value = '';
      if (removeOrderError) {
        removeOrderError.textContent = error instanceof Error ? error.message : 'Unable to remove this order.';
        removeOrderError.hidden = false;
      }
      if (removeOrderSubmit instanceof HTMLButtonElement) removeOrderSubmit.disabled = false;
      if (passcodeField instanceof HTMLInputElement) passcodeField.focus();
    }
  };

  const unclaimOrder = async (orderId) => {
    const order = state.orders.find((item) => item.id === orderId);
    if (!orderPresentation.canCurrentEmployeeUnclaim(order, currentEmployee.id)) {
      closeOrderContextMenu();
      return;
    }
    closeOrderContextMenu();
    if (order.clientClaimPending) {
      order.clientClaimReleaseRequested = true;
      order.started = false;
      saveOrders();
      renderBoard();
      return;
    }
    try {
      const payload = await postOrderAction('release_order', order);
      applyFulfillmentState(order, payload.fulfillment || payload.order);
      if (state.activeOrderId === order.id) closeFulfillment(false);
      saveOrders();
      renderBoard();
    } catch (error) {
      await refreshOrders(false, { force: true }).catch(() => {});
      showBoardAlert(error instanceof Error ? error.message : 'Unable to unclaim this order.');
    }
  };

  const closeFulfillment = (releaseClaim = false) => {
    const order = activeOrder();
    if (modal) modal.hidden = true;
    if (previewStage) previewStage.hidden = true;
    if (pickStage) pickStage.hidden = true;
    state.previewOrderId = '';
    state.activeOrderId = '';
    state.scans = new Map();
    if (releaseClaim && order?.clientClaimPending) {
      order.clientClaimReleaseRequested = true;
      order.started = false;
      saveOrders();
      renderBoard();
      return;
    }
    if (releaseClaim && order && order.claimedBy === currentEmployee.id && order.fulfillmentStatus === 'CLAIMED') {
      postOrderAction('release_order', order)
        .then((payload) => {
          applyFulfillmentState(order, payload.fulfillment || payload.order);
          saveOrders();
          renderBoard();
        })
        .catch(() => refreshOrders(false).catch(() => {}));
    }
  };

  board?.addEventListener('click', (event) => {
    unlockAudio();
    const target = event.target instanceof Element ? event.target : null;
    const retryButton = target?.closest('[data-retry-arrangement]');
    if (retryButton instanceof HTMLButtonElement) {
      if (!retryButton.disabled) retryFailedArrangement(retryButton.dataset.retryArrangement || '');
      return;
    }
    const instantButton = target?.closest('[data-arrange-instant]');
    if (instantButton instanceof HTMLButtonElement) {
      if (!instantButton.disabled) arrangeInstantShipment(instantButton.dataset.arrangeInstant || '');
      return;
    }
    const shopeeButton = target?.closest('[data-arrange-shopee]');
    if (shopeeButton instanceof HTMLButtonElement) {
      if (!shopeeButton.disabled) openShopeeArrangementModal(shopeeButton.dataset.arrangeShopee || '');
      return;
    }
    const button = target?.closest('[data-start-order]');
    if (button instanceof HTMLButtonElement) {
      if (!button.disabled) openFulfillment(button.dataset.startOrder || '');
      return;
    }
    const card = target?.closest('[data-preview-order]');
    if (!(card instanceof HTMLElement)) return;
    openOrderPreview(card.dataset.previewOrder || '');
  });

  board?.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest('.admin-order-card[data-order-id]');
    if (!(card instanceof HTMLElement)) return;
    const order = state.orders.find((item) => item.id === card.dataset.orderId);
    if (!orderPresentation.canOpenOrderContextMenu(order, currentEmployee.id)) {
      closeOrderContextMenu();
      return;
    }
    event.preventDefault();
    const bounds = card.getBoundingClientRect();
    openOrderContextMenu(
      order,
      event.clientX || bounds.left + Math.min(28, bounds.width / 2),
      event.clientY || bounds.top + Math.min(28, bounds.height / 2)
    );
  });

  unclaimOrderButton?.addEventListener('click', () => {
    const orderId = String(orderContextMenu?.dataset.orderId || '');
    if (unclaimOrderButton instanceof HTMLButtonElement) unclaimOrderButton.disabled = true;
    unclaimOrder(orderId);
  });

  removeOrderButton?.addEventListener('click', () => {
    const orderId = String(orderContextMenu?.dataset.orderId || '');
    closeOrderContextMenu();
    openRemoveOrderModal(orderId);
  });

  removeOrderForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    removeOrderFromListed();
  });
  removeOrderForm?.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === 'stock_action') {
      syncRemoveOrderStockChoice();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-remove-sku-input]')) {
      target.setCustomValidity('');
    }
  });
  document.querySelectorAll('[data-close-remove-order]').forEach((button) => {
    button.addEventListener('click', closeRemoveOrderModal);
  });
  document.querySelectorAll('[data-close-shopee-arrangement]').forEach((button) => {
    button.addEventListener('click', closeShopeeArrangementModal);
  });
  shopeeArrangementOptions?.addEventListener('change', () => {
    if (!(shopeeArrangementSubmit instanceof HTMLButtonElement)) return;
    shopeeArrangementSubmit.disabled = !shopeeArrangementOptions.querySelector('input[name="shopee_arrangement"]:checked');
  });
  shopeeArrangementForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = shopeeArrangementOptions?.querySelector('input[name="shopee_arrangement"]:checked');
    if (!(selected instanceof HTMLInputElement) || !(shopeeArrangementSubmit instanceof HTMLButtonElement)) return;
    if (shopeeArrangementDemoMode) {
      const selectedCard = selected.closest('.admin-shopee-arrangement-option');
      const selectedTitle = selectedCard?.querySelector('strong')?.textContent?.trim() || 'Shipping method selected';
      const selectedType = selectedCard?.querySelector('.admin-shopee-option-type')?.textContent?.trim() || 'Shipping method';
      shopeeArrangementOptions.innerHTML = `
        <div class="admin-shopee-demo-success" role="status">
          <span class="admin-shopee-demo-success-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg>
          </span>
          <span>
            <strong>That’s the complete interaction</strong>
            <small>${escapeHtml(selectedType)} · ${escapeHtml(selectedTitle)}</small>
            <em>Demo only—no order or shipment was changed.</em>
          </span>
        </div>`;
      if (shopeeArrangementSubmitLabel) shopeeArrangementSubmitLabel.textContent = 'Demo complete';
      shopeeArrangementSubmit.disabled = true;
      return;
    }
    const originalLabel = shopeeArrangementSubmitLabel?.textContent || 'Arrange shipment';
    shopeeArrangementSubmit.disabled = true;
    if (shopeeArrangementSubmitLabel) shopeeArrangementSubmitLabel.textContent = 'Arranging…';
    if (shopeeArrangementError) shopeeArrangementError.hidden = true;
    try {
      await arrangeShopeeShipment({
        handover_method: String(selected.dataset.handoverMethod || ''),
        pickup_address_id: String(selected.dataset.pickupAddressId || ''),
        pickup_time_id: String(selected.dataset.pickupTimeId || '')
      });
    } catch (_error) {
      // The modal keeps the actionable Shopee error next to the selected option.
    } finally {
      if (shopeeArrangementSubmitLabel) shopeeArrangementSubmitLabel.textContent = originalLabel;
      if (shopeeArrangementModal && !shopeeArrangementModal.hidden) shopeeArrangementSubmit.disabled = false;
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (orderContextMenu?.hidden || orderContextMenu?.contains(event.target)) return;
    closeOrderContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeOrderContextMenu();
      closeRemoveOrderModal();
      closeShopeeArrangementModal();
    }
  });
  window.addEventListener('blur', closeOrderContextMenu);
  window.addEventListener('resize', closeOrderContextMenu);
  window.addEventListener('scroll', closeOrderContextMenu, true);

  previewStage?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-preview-start]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    openFulfillment(button.dataset.previewStart || '');
  });

  document.querySelector('[data-next-scan]')?.addEventListener('click', async (event) => {
    const order = activeOrder();
    if (!order) return;
    const button = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    const originalLabel = button?.textContent || 'Lanjut';
    // Phones (and the installed app) continue in the same screen.
    const scanPage = window.JGStoreDevice?.isPhone() ? null : window.open('', '_blank');
    if (button) {
      button.disabled = true;
      button.textContent = 'Memproses…';
    }

    try {
      const result = await postOrderAction('begin_fulfillment', order, {
        scan_order: { ...order, platform: normalizeSourceKey(order.platform), sourceAccountKey: sourceKeyFromOrder(order) }
      });
      if (!result.scan_handoff) throw new Error('Unable to open scanning. Refresh the board and try again.');
      saveOrders();
      try {
        window.sessionStorage.setItem(activeOrderStorageKey, order.id);
      } catch (_error) {
        // Query string still carries the order id.
      }
      const scanUrl = `./scan/?order=${encodeURIComponent(order.id)}&handoff=${encodeURIComponent(result.scan_handoff)}`;
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
      if (scanPage && !scanPage.closed) {
        scanPage.location.href = scanUrl;
      } else {
        window.location.href = scanUrl;
      }
    } catch (error) {
      if (scanPage && !scanPage.closed) scanPage.close();
      showBoardAlert(error instanceof Error ? error.message : 'Unable to start this order.');
      refreshOrders(false, { force: true }).catch(() => {});
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  });

  document.querySelectorAll('[data-close-fulfillment-modal]').forEach((button) => {
    button.addEventListener('click', () => closeFulfillment(true));
  });

  document.querySelector('[data-open-reprint]')?.addEventListener('click', openReprintModal);

  document.querySelector('[data-open-store-settings]')?.addEventListener('click', () => {
    if (compactSidebarQuery.matches) setSidebarExpanded(false, { persist: false });
    openSettingsModal();
  });
  document.querySelectorAll('[data-open-employee-profiles]').forEach((button) => {
    button.addEventListener('click', openEmployeeProfilesModal);
  });
  sidebarToggles.forEach((button) => {
    button.addEventListener('click', () => {
      setSidebarExpanded(!root.classList.contains('is-sidebar-expanded'));
    });
  });
  sidebarBackdrop?.addEventListener('click', () => setSidebarExpanded(false, { persist: false }));
  document.querySelectorAll('.admin-store-sidebar a').forEach((link) => {
    link.addEventListener('click', () => {
      if (compactSidebarQuery.matches) setSidebarExpanded(false, { persist: false });
    });
  });
  if (typeof compactSidebarQuery.addEventListener === 'function') {
    compactSidebarQuery.addEventListener('change', syncSidebarForViewport);
  } else if (typeof compactSidebarQuery.addListener === 'function') {
    compactSidebarQuery.addListener(syncSidebarForViewport);
  }
  document.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => activateSettingsTab(button.dataset.settingsTab || 'scanner'));
  });
  scannerSelectButton?.addEventListener('click', () => {
    selectScanner().catch(() => {});
  });
  document.querySelector('[data-scanner-health-check]')?.addEventListener('click', () => {
    checkScannerHealth().catch(() => {});
  });
  scannerTestScanButton?.addEventListener('click', () => {
    testScannerScan().catch(() => {});
  });
  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.themeOption || 'dark');
    });
  });

  sourceColorList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-source-color-key][data-source-color-value]');
    if (!(button instanceof HTMLButtonElement)) return;
    const sourceKey = normalizeSourceKey(button.dataset.sourceColorKey || '');
    const color = String(button.dataset.sourceColorValue || '').trim();
    if (!sourceKey || !sourceColorOptions.some((option) => option.value === color)) return;
    sourceColorMap[sourceKey] = color;
    sourceColorRevision += 1;
    saveSourceColorMap().catch(reportSourceColorError);
    renderSourceColorList();
    renderBoard();
  });

  sourceColorList?.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'color') return;
    const sourceKey = normalizeSourceKey(input.dataset.sourceColorCustomKey || '');
    const color = String(input.value || '').trim().toUpperCase();
    if (!sourceKey || !isCustomSourceColor(color)) return;
    sourceColorMap[sourceKey] = color;
    sourceColorRevision += 1;
    saveSourceColorMap().catch(reportSourceColorError);
    renderSourceColorList();
    renderBoard();
  });

  document.querySelectorAll('[data-close-store-settings]').forEach((button) => {
    button.addEventListener('click', closeSettingsModal);
  });

  document.querySelectorAll('[data-close-employee-profiles]').forEach((button) => {
    button.addEventListener('click', closeEmployeeProfilesModal);
  });

  document.querySelector('[data-new-employee-profile]')?.addEventListener('click', () => {
    resetEmployeeProfileForm();
    const fields = employeeProfileFields();
    if (fields.displayName instanceof HTMLInputElement) fields.displayName.focus();
  });

  employeeProfileList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-edit-employee-profile]');
    if (!(button instanceof HTMLButtonElement)) return;
    editEmployeeProfile(button.dataset.editEmployeeProfile || '');
  });

  employeeProfileForm?.addEventListener('input', (event) => {
    const fields = employeeProfileFields();
    if (!(fields.id instanceof HTMLInputElement) || fields.id.readOnly) return;
    if (event.target === fields.id) {
      fields.id.dataset.userEdited = '1';
      fields.id.value = normalizeEmployeeId(fields.id.value);
      return;
    }
    if (event.target === fields.displayName && fields.id.dataset.userEdited !== '1') {
      fields.id.value = normalizeEmployeeId(fields.displayName?.value || '');
    }
  });

  employeeProfileForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveEmployeeProfile().catch((error) => {
      showEmployeeProfileError(error instanceof Error ? error.message : 'Unable to save employee profile.');
    });
  });

  settingsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveSourceColorMap();
      clearSourceColorError();
      if (settingsSaveLabel) settingsSaveLabel.textContent = 'Saved';
      window.setTimeout(() => {
        if (settingsSaveLabel) settingsSaveLabel.textContent = 'Save';
      }, 1600);
    } catch (error) {
      reportSourceColorError(error);
      if (settingsSaveLabel) settingsSaveLabel.textContent = 'Retry';
    }
  });

  document.querySelectorAll('[data-close-reprint-modal]').forEach((button) => {
    button.addEventListener('click', closeReprintModal);
  });

  reprintInput()?.addEventListener('input', (event) => {
    window.clearTimeout(reprintSearchTimer);
    clearReprintError();
    const query = String(event.target?.value || '').trim();
    if (query.length < 2) {
      reprintSearchController?.abort();
      reprintSearchSequence += 1;
      reprintProfiles = [];
      selectedReprintProfile = null;
      renderReprintPrompt(query ? 'Type at least 2 characters to search customers.' : undefined);
      return;
    }
    reprintSearchTimer = window.setTimeout(() => searchReprintProfiles(query), 280);
  });

  reprintResults?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const profileButton = target?.closest('[data-reprint-profile-index]');
    if (profileButton instanceof HTMLButtonElement) {
      const profile = reprintProfiles[Number(profileButton.dataset.reprintProfileIndex || -1)];
      if (profile) renderReprintProfileOrders(profile);
      return;
    }
    const backButton = target?.closest('[data-reprint-profile-back]');
    if (backButton instanceof HTMLButtonElement) {
      renderReprintProfiles(reprintProfiles);
      return;
    }
    const orderButton = target?.closest('[data-reprint-order-index]');
    if (!(orderButton instanceof HTMLButtonElement) || !selectedReprintProfile) return;
    const orders = Array.isArray(selectedReprintProfile.orders) ? selectedReprintProfile.orders : [];
    const order = orders[Number(orderButton.dataset.reprintOrderIndex || -1)];
    if (order) openResolvedReprintOrder(order);
  });

  reprintForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(reprintForm);
    const orderId = String(formData.get('order_id') || '').trim();
    if (!orderId) {
      showReprintError('Enter an order ID.');
      return;
    }
    await lookupExactReprintOrder(orderId);
  });

  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) {
      closeFulfillment(true);
      return;
    }
    if (event.key === 'Escape' && reprintModal && !reprintModal.hidden) {
      closeReprintModal();
      return;
    }
    if (event.key === 'Escape' && compactSidebarQuery.matches && root.classList.contains('is-sidebar-expanded')) {
      setSidebarExpanded(false, { persist: false });
    }
  });
  window.addEventListener('resize', scheduleBoardRender);
  window.addEventListener('storage', (event) => {
    if (event.key === themeStorageKey) {
      applyTheme(event.newValue || 'dark', { persist: false });
      return;
    }
    if (event.key === printedOrderStorageKey) {
      closeFulfillment();
      flushPendingOrderCompletions()
        .finally(() => refreshOrders(false, { force: true }).catch(() => {}));
      renderBoard();
      return;
    }
    if (event.key === pendingCompletionQueueStorageKey) {
      flushPendingOrderCompletions()
        .finally(() => refreshOrders(false, { force: true }).catch(() => {}));
      return;
    }
    if (event.key === sourceColorStorageKey) {
      sourceColorMap = readSourceColorMap();
      sourceColorRevision += 1;
      renderSourceColorList();
      renderBoard();
      return;
    }
    if (event.key === sidebarStorageKey && !compactSidebarQuery.matches) {
      setSidebarExpanded(event.newValue !== '0', { persist: false });
      return;
    }
    if (event.key !== ordersStorageKey) return;
    renderBoard();
  });

  syncSidebarForViewport();
  bindBrowserSerialEvents();
  applyTheme(window.localStorage.getItem(themeStorageKey) || 'dark');
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
  const syncSystemTheme = () => {
    if (document.documentElement.dataset.adminThemePreference === 'system') {
      applyTheme('system', { persist: false });
    }
  };
  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', syncSystemTheme);
  } else if (typeof systemThemeQuery.addListener === 'function') {
    systemThemeQuery.addListener(syncSystemTheme);
  }

  const refreshSkuCatalog = async () => {
    if (skuCatalogRefreshPromise) return skuCatalogRefreshPromise;
    skuCatalogRefreshPromise = loadSkuCatalog()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        skuCatalogRefreshPromise = null;
      });
    return skuCatalogRefreshPromise;
  };

  const refreshOrders = async (showError = true, options = {}) => {
    const force = Boolean(options.force);
    const now = Date.now();
    if (ordersRefreshPromise) return ordersRefreshPromise;
    if (!force && lastOrdersRefreshAt && now - lastOrdersRefreshAt < ordersRefreshMinGapMs) {
      return state.orders;
    }

    ordersRefreshPromise = (async () => {
      try {
        const loadedOrders = await loadOrders();
        if (loadedOrders === null) {
          ordersSnapshotReady = true;
          renderBoard();
          return state.orders;
        }
        ordersSnapshotReady = true;
        state.orders = loadedOrders;
        lastOrdersRefreshAt = Date.now();
        saveOrders();
        renderBoard();
        renderSourceColorList();
        return state.orders;
      } catch (error) {
        lastOrdersRefreshAt = Date.now();
        if (state.orders.length) {
          ordersSnapshotReady = true;
          renderBoard();
        } else if (showError) {
          const message = error instanceof Error ? error.message : 'Unable to load orders.';
          renderBoardMessage(message);
        }
        throw error;
      } finally {
        ordersRefreshPromise = null;
      }
    })();

    return ordersRefreshPromise;
  };

  window.addEventListener('focus', () => {
    loadSourceColorMap().catch(() => {});
    flushPendingOrderCompletions()
      .finally(() => refreshOrders(false, { force: true }).catch(() => {}));
  });

  const initialize = async () => {
    renderScannerSettings();
    hydrateSkuCatalogFromCache();
    const hasCachedOrders = hydrateOrdersFromCache();
    if (!hasCachedOrders) {
      renderBoardMessage('Loading Orders', { loading: true });
    }
    hydrateSkuCatalogFromDurableCache()
      .then((updated) => {
        if (updated) renderBoard();
      })
      .catch(() => {});
    hydrateOrdersFromDurableCache().catch(() => {});

    formatClock();
    loadScannerSettings().catch(() => {});
    loadSourceColorMap().catch(reportSourceColorError);

    if (shopeeArrangementDemoMode) {
      if (shopeeArrangementOrder) shopeeArrangementOrder.textContent = '260812SAMPLE';
      renderShopeeArrangementOptions({
        pickup: {
          options: [
            {
              label: 'Wednesday, 12 August · 10:00–12:00 WIB',
              address_id: 'demo-address',
              pickup_time_id: 'demo-morning'
            },
            {
              label: 'Wednesday, 12 August · 13:00–15:00 WIB',
              address_id: 'demo-address',
              pickup_time_id: 'demo-afternoon'
            }
          ]
        },
        dropoff: { offered: true }
      });
      if (shopeeArrangementModal) shopeeArrangementModal.hidden = false;
    }

    window.setTimeout(() => {
      flushPendingOrderCompletions()
        .finally(() => refreshOrders(true, { force: true }).catch(() => {}));
      refreshSkuCatalog()
        .then((updated) => {
          if (updated) refreshOrders(false, { force: true }).catch(() => {});
        })
        .catch(() => {});
      window.setInterval(() => {
        formatClock();
        flushPendingOrderCompletions()
          .finally(() => refreshOrders(false).catch(() => {}));
      }, ordersRefreshIntervalMs);
    }, hasCachedOrders ? cachedStartupRefreshDelayMs : 0);
  };

  initialize();
});

<?php
declare(strict_types=1);

require dirname(__DIR__) . '/store-ops-shell.php';

if (!jg_admin_is_authenticated()) {
    header('Location: ../');
    exit;
}

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

$assetVersionPrefix = 'store-ops-session-and-arrangement-recovery-v1';
$adminCssVersion = $assetVersionPrefix . '-' . (string) @filemtime(dirname(__DIR__) . '/admin.css');
$storeHomeJsVersion = $assetVersionPrefix . '-' . (string) @filemtime(dirname(__DIR__) . '/store-home.js');
$currentEmployeeId = jg_admin_current_employee_id();
$currentEmployeeName = jg_admin_current_employee_name();
$currentEmployeeCanManageProfiles = jg_admin_can_manage_employee_profiles();
$currentEmployeeCanRemoveOrders = jg_admin_employee_can_remove_orders($currentEmployeeId);
$currentEmployeeInitial = strtoupper(substr(trim($currentEmployeeName), 0, 1)) ?: 'O';
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no">
    <title>Store Fulfillment | Jenang Gemi</title>
    <meta name="robots" content="noindex,nofollow">
    <?php require dirname(__DIR__) . '/theme-init.php'; ?>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;700&display=swap">
    <link rel="stylesheet" href="../admin.css?v=<?php echo urlencode($adminCssVersion ?: '1'); ?>">
</head>
<body class="admin-body is-dashboard is-store-home">
    <div class="admin-build-badge" aria-label="Store build version">Build 1.05.03</div>
    <div
        class="admin-app admin-store-home"
        data-store-home
        data-employee-id="<?php echo htmlspecialchars($currentEmployeeId, ENT_QUOTES, 'UTF-8'); ?>"
        data-employee-name="<?php echo htmlspecialchars($currentEmployeeName, ENT_QUOTES, 'UTF-8'); ?>"
    >
        <div class="admin-backdrop admin-backdrop-a"></div>
        <div class="admin-backdrop admin-backdrop-b"></div>
        <button type="button" class="admin-store-sidebar-backdrop" data-store-sidebar-backdrop aria-label="Close navigation" tabindex="-1" hidden></button>

        <aside class="admin-store-sidebar" data-store-sidebar id="store-navigation">
            <header class="admin-store-sidebar-head">
                <button type="button" class="admin-store-sidebar-toggle" data-store-sidebar-toggle aria-controls="store-navigation" aria-expanded="true" title="Collapse navigation">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v16"/></svg>
                </button>
                <span class="admin-store-sidebar-brand-copy">
                    <strong>Store Ops</strong>
                    <small>Processing only</small>
                </span>
            </header>

            <nav class="admin-store-sidebar-nav" aria-label="Store Ops navigation">
                <?php foreach (jg_store_ops_shell_nav_items('../') as $item): ?>
                    <?php if (($item['type'] ?? '') === 'separator'): ?>
                        <span class="admin-store-nav-divider" role="separator" aria-label="<?php echo htmlspecialchars((string) $item['label'], ENT_QUOTES, 'UTF-8'); ?>"></span>
                        <?php continue; ?>
                    <?php endif; ?>
                    <?php $isActive = $item['key'] === 'orders'; ?>
                    <a class="admin-store-nav-item<?php echo $isActive ? ' is-active' : ''; ?>" href="<?php echo htmlspecialchars($item['href'], ENT_QUOTES, 'UTF-8'); ?>"<?php echo $isActive ? ' aria-current="page"' : ''; ?> title="<?php echo htmlspecialchars($item['title'], ENT_QUOTES, 'UTF-8'); ?>">
                        <?php echo jg_store_ops_shell_svg($item['key']); ?>
                        <span><?php echo htmlspecialchars($item['label'], ENT_QUOTES, 'UTF-8'); ?></span>
                    </a>
                <?php endforeach; ?>
            </nav>

            <div class="admin-store-sidebar-tools">
                <button type="button" class="admin-store-nav-item" data-open-reprint title="Reprint label">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>
                    <span>Reprint</span>
                </button>
            </div>

            <footer class="admin-store-sidebar-footer">
                <?php if ($currentEmployeeCanManageProfiles): ?>
                    <button type="button" class="admin-store-sidebar-profile" data-open-employee-profiles title="Employee profiles">
                <?php else: ?>
                    <div class="admin-store-sidebar-profile">
                <?php endif; ?>
                        <span class="admin-store-profile-avatar"><?php echo htmlspecialchars($currentEmployeeInitial, ENT_QUOTES, 'UTF-8'); ?></span>
                        <span class="admin-store-profile-copy">
                            <strong><?php echo htmlspecialchars($currentEmployeeName, ENT_QUOTES, 'UTF-8'); ?></strong>
                            <small>Operator</small>
                        </span>
                <?php if ($currentEmployeeCanManageProfiles): ?>
                    </button>
                <?php else: ?>
                    </div>
                <?php endif; ?>
                <button type="button" class="admin-store-nav-item admin-store-settings-launch" data-open-store-settings title="Settings">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>
                    <span>Settings</span>
                </button>
            </footer>
        </aside>

        <div class="admin-store-workspace">
            <header class="admin-topbar admin-store-topbar">
                <button type="button" class="admin-store-mobile-menu" data-store-sidebar-toggle aria-controls="store-navigation" aria-expanded="true" aria-label="Open navigation">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v16"/></svg>
                </button>
                <section class="admin-store-command">
                    <article class="admin-store-stat">
                        <span>Listed</span>
                        <strong data-listed-count>0</strong>
                    </article>
                    <article class="admin-store-stat">
                        <span>Products Left</span>
                        <strong data-products-left-count>0</strong>
                    </article>
                    <article class="admin-store-stat">
                        <span>&lt;1h</span>
                        <strong data-critical-count>0</strong>
                    </article>
                    <article class="admin-store-stat">
                        <span>Claimed</span>
                        <strong data-started-count>0</strong>
                    </article>
                    <article class="admin-store-stat">
                        <span>Fulfilling</span>
                        <strong data-fulfilling-count>0</strong>
                    </article>
                </section>
                <div class="admin-topbar-actions">
                    <button
                        type="button"
                        class="admin-dropoff-filter"
                        data-dropoff-filter
                        aria-pressed="false"
                        title="Show only drop-off orders. This does not change any order status."
                    >
                        <span class="admin-dropoff-filter-label">Drop-off only</span>
                        <span class="admin-dropoff-filter-switch" aria-hidden="true"><span></span></span>
                    </button>
                    <div class="admin-view-indicator" data-board-clock>Live Queue</div>
                    <?php if ($currentEmployeeCanManageProfiles): ?>
                        <button type="button" class="admin-store-header-profile" data-open-employee-profiles aria-label="Open profile management">
                    <?php else: ?>
                        <div class="admin-store-header-profile">
                    <?php endif; ?>
                            <span class="admin-store-profile-avatar"><?php echo htmlspecialchars($currentEmployeeInitial, ENT_QUOTES, 'UTF-8'); ?></span>
                            <span class="admin-store-profile-copy">
                                <strong data-board-employee><?php echo htmlspecialchars($currentEmployeeName, ENT_QUOTES, 'UTF-8'); ?></strong>
                                <small>Operator</small>
                            </span>
                    <?php if ($currentEmployeeCanManageProfiles): ?>
                        </button>
                    <?php else: ?>
                        </div>
                    <?php endif; ?>
                </div>
            </header>

            <main class="admin-layout">
                <section class="admin-panel admin-panel-wide admin-fulfillment-panel">
                    <div class="admin-order-board-wrap">
                        <div class="admin-queue-notice" data-automation-pause-notice role="status" hidden>
                            <span class="admin-queue-notice-icon" aria-hidden="true">!</span>
                            <div>
                                <strong data-automation-pause-title>Automatic arrangement is paused</strong>
                                <span data-automation-pause-copy>Unarranged marketplace orders stay visible for manual follow-up.</span>
                            </div>
                        </div>
                        <div class="admin-order-board" data-order-board aria-busy="true" style="--order-rows: 6; --order-columns: 1;">
                            <div class="admin-board-empty admin-board-loading" role="status" aria-live="polite">
                                <strong>Loading Orders</strong>
                                <span class="admin-loading-worm" aria-hidden="true">
                                    <i></i><i></i><i></i><i></i><i></i>
                                </span>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </div>

        <div class="admin-order-context-menu" data-order-context-menu role="menu" aria-label="Order claim actions" hidden>
            <button type="button" class="admin-order-context-action" data-unclaim-order role="menuitem">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 0 6-6"/></svg>
                <span><strong>Unclaim</strong><small>Release for another profile</small></span>
            </button>
            <?php if ($currentEmployeeCanRemoveOrders): ?>
                <button type="button" class="admin-order-context-action is-danger" data-remove-order role="menuitem">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
                    <span><strong>Remove</strong><small>Remove from listed orders</small></span>
                </button>
            <?php endif; ?>
        </div>

        <?php if ($currentEmployeeCanRemoveOrders): ?>
            <div class="admin-modal-shell admin-remove-order-modal" data-remove-order-modal hidden>
                <div class="admin-modal-backdrop" data-close-remove-order></div>
                <form class="admin-modal-card admin-remove-order-card" data-remove-order-form role="dialog" aria-modal="true" aria-labelledby="remove-order-title">
                    <input type="text" name="username" autocomplete="username" value="branch-vincent" hidden>
                    <div class="admin-modal-head">
                        <div>
                            <span class="admin-panel-kicker">Branch authorization</span>
                            <h3 id="remove-order-title">Remove listed order</h3>
                        </div>
                        <button type="button" class="admin-ghost-btn" data-close-remove-order>Close</button>
                    </div>
                    <p class="admin-reprint-intro">Remove <strong data-remove-order-id></strong> from listed orders.</p>
                    <p class="admin-reprint-intro" data-remove-order-stock-audit data-state="checking">Checking the shared stock ledger…</p>
                    <fieldset class="admin-remove-stock-choice">
                        <legend>What should happen to stock?</legend>
                        <label class="admin-remove-stock-option">
                            <input type="radio" name="stock_action" value="deduct" required>
                            <span>
                                <strong>Deduct this order’s stock</strong>
                                <small>The order was completed manually. Reduce the shared inventory now.</small>
                            </span>
                        </label>
                        <label class="admin-remove-stock-option">
                            <input type="radio" name="stock_action" value="keep" required>
                            <span>
                                <strong>Keep stock unchanged</strong>
                                <small>The order was cancelled, duplicated, or did not leave the store.</small>
                            </span>
                        </label>
                    </fieldset>
                    <section class="admin-remove-sku-mapping" data-remove-sku-mapping hidden>
                        <div class="admin-remove-sku-mapping-head">
                            <strong>Confirm stock SKUs</strong>
                            <small data-remove-sku-mapping-summary>Match each order tag to a live SKU.</small>
                        </div>
                        <div class="admin-remove-sku-mapping-list" data-remove-sku-mapping-list></div>
                        <datalist id="remove-order-live-skus" data-remove-sku-options></datalist>
                    </section>
                    <label class="admin-reprint-field">
                        <span>Branch Login passcode</span>
                        <input class="admin-settings-input" name="passcode" type="password" autocomplete="current-password" maxlength="128" required>
                    </label>
                    <p class="admin-form-error" data-remove-order-error hidden></p>
                    <div class="admin-modal-actions">
                        <button type="button" class="admin-ghost-btn" data-close-remove-order>Cancel</button>
                        <button type="submit" class="admin-primary-btn admin-remove-order-submit" data-remove-order-submit>Remove order</button>
                    </div>
                </form>
            </div>
        <?php endif; ?>

        <div class="admin-modal-shell admin-shopee-arrangement-modal" data-shopee-arrangement-modal hidden>
            <div class="admin-modal-backdrop" data-close-shopee-arrangement></div>
            <form class="admin-modal-card admin-shopee-arrangement-card" data-shopee-arrangement-form role="dialog" aria-modal="true" aria-labelledby="shopee-arrangement-title">
                <header class="admin-modal-head admin-shopee-arrangement-head">
                    <div class="admin-shopee-arrangement-heading">
                        <span class="admin-shopee-arrangement-hero-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l3-1.72"/><path d="M3.29 7 12 12l8.71-5"/><path d="M12 22V12"/><path d="m17 19 2 2 4-4"/></svg>
                        </span>
                        <div>
                            <span class="admin-panel-kicker">Shopee shipping</span>
                            <h3 id="shopee-arrangement-title">Arrange shipment</h3>
                            <span class="admin-shopee-arrangement-order">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>
                                Order <strong data-shopee-arrangement-order></strong>
                            </span>
                        </div>
                    </div>
                    <button type="button" class="admin-shopee-close-btn" data-close-shopee-arrangement aria-label="Close shipping options" title="Close">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>
                    </button>
                </header>
                <div class="admin-shopee-arrangement-intro">
                    <span class="admin-shopee-intro-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
                    </span>
                    <span>
                        <strong>Choose how to hand over this parcel</strong>
                        <small>Options come directly from Shopee. After confirmation, we’ll prepare the label and return the order to the normal queue.</small>
                    </span>
                </div>
                <div class="admin-shopee-arrangement-options" data-shopee-arrangement-options>
                    <p class="admin-preview-empty">Loading Shopee options…</p>
                </div>
                <p class="admin-form-error" data-shopee-arrangement-error hidden></p>
                <div class="admin-modal-actions admin-shopee-arrangement-actions">
                    <span class="admin-shopee-secure-note">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                        No changes until you confirm
                    </span>
                    <div>
                        <button type="button" class="admin-ghost-btn" data-close-shopee-arrangement>Cancel</button>
                        <button type="submit" class="admin-primary-btn admin-shopee-arrangement-submit" data-shopee-arrangement-submit disabled>
                            <span>Arrange shipment</span>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
                        </button>
                    </div>
                </div>
            </form>
        </div>

        <div class="admin-modal-shell admin-fulfillment-modal" data-fulfillment-modal hidden>
            <div class="admin-modal-backdrop" data-close-fulfillment-modal></div>
            <div class="admin-modal-card admin-fulfillment-card" data-fulfillment-card role="dialog" aria-modal="true" aria-labelledby="store-order-modal-title">
                <div class="admin-modal-head">
                    <div>
                        <span class="admin-panel-kicker" data-modal-step-label>Pick List</span>
                        <h3 id="store-order-modal-title" data-modal-title>Order</h3>
                    </div>
                    <button type="button" class="admin-ghost-btn" data-close-fulfillment-modal>Close</button>
                </div>
                <div class="admin-order-preview" data-order-preview hidden></div>
                <div class="admin-quiz-stage" data-pick-stage hidden>
                    <div class="admin-order-summary" data-order-summary></div>
                    <div class="admin-pick-list" data-pick-list></div>
                    <div class="admin-modal-actions">
                        <button type="button" class="admin-primary-btn admin-next-btn" data-next-scan>Lanjut</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="admin-modal-shell admin-store-settings-modal" data-store-settings-modal hidden>
            <div class="admin-modal-backdrop" data-close-store-settings></div>
            <form class="admin-modal-card admin-store-settings-card" data-store-settings-form role="dialog" aria-modal="true" aria-labelledby="store-settings-title">
                <aside class="admin-settings-sidebar">
                    <div class="admin-settings-brand">
                        <span class="admin-settings-brand-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M8 10.5h8M8 14h8"/></svg>
                        </span>
                        <span>
                            <strong>Store Ops</strong>
                            <small>Shipping settings</small>
                        </span>
                    </div>

                    <nav class="admin-settings-nav" aria-label="Settings sections">
                        <button type="button" class="admin-settings-tab is-active" data-settings-tab="scanner" aria-selected="true">
                            <span class="admin-settings-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10M8 9h1M11 9h2M15 9h1M8 15h2M12 15h1M15 15h1"/></svg></span>
                            <span><strong>Scanner</strong><small>USB-COM setup</small></span>
                            <svg class="admin-settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button type="button" class="admin-settings-tab" data-settings-tab="theme" aria-selected="false">
                            <span class="admin-settings-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
                            <span><strong>Theme</strong><small>Ops interface</small></span>
                            <svg class="admin-settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <button type="button" class="admin-settings-tab" data-settings-tab="platforms" aria-selected="false">
                            <span class="admin-settings-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18h1.4a1.7 1.7 0 0 0 0-3.4h-.7a1.6 1.6 0 0 1-1.6-1.6c0-.9.7-1.6 1.6-1.6H15a6 6 0 0 0 0-12z"/><circle cx="7.5" cy="10.5" r=".8"/><circle cx="9.5" cy="6.8" r=".8"/><circle cx="14" cy="6.7" r=".8"/><circle cx="17.2" cy="9.8" r=".8"/></svg></span>
                            <span><strong>Platforms</strong><small>Order color codes</small></span>
                            <svg class="admin-settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                        <?php jg_store_ops_print_helper_settings_tab(); ?>
                    </nav>

                    <div class="admin-settings-scanner-summary">
                        <i data-scanner-summary-dot aria-hidden="true"></i>
                        <span>
                            <strong>Scanner status</strong>
                            <small data-scanner-summary>No scanner selected</small>
                        </span>
                    </div>
                </aside>

                <main class="admin-settings-main">
                    <header class="admin-settings-header">
                        <div>
                            <span class="admin-settings-kicker">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>
                                Order Ops Settings
                            </span>
                            <h3 id="store-settings-title" data-settings-title>Scanner setup</h3>
                            <p>Configure how shipping staff process orders in the operational queue.</p>
                        </div>
                        <div class="admin-settings-header-actions">
                            <button type="submit" class="admin-primary-btn admin-settings-save" data-settings-save>
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                                <span data-settings-save-label>Save</span>
                            </button>
                            <a class="admin-settings-lock" href="../logout/" aria-label="Lock Store Ops" title="Lock Store Ops">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                            </a>
                            <button type="button" class="admin-settings-close" data-close-store-settings aria-label="Close settings" title="Close settings">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
                            </button>
                        </div>
                    </header>

                    <p class="admin-form-error" data-store-settings-error hidden></p>

                    <div class="admin-settings-panels">
                        <section class="admin-settings-panel is-active" data-settings-panel="scanner">
                            <div class="admin-settings-section-head">
                                <span class="admin-settings-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3v5M17 3v5M5 8h14v4a7 7 0 0 1-14 0zM12 19v2"/><path d="M9 5h6"/></svg></span>
                                <div>
                                    <h4>USB-COM scanner connection</h4>
                                    <p>Find the USB-COM scanner connected to this Store Ops station, then scan any barcode to pair it.</p>
                                </div>
                            </div>

                            <button type="button" class="admin-scanner-select" data-scanner-select>
                                <span class="admin-scanner-select-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m13 2-2 8h7l-7 12 2-8H6z"/></svg></span>
                                <span>
                                    <small>Selected scanner</small>
                                    <strong data-selected-scanner>No scanner selected</strong>
                                </span>
                                <span class="admin-scanner-select-action">Find Scanner</span>
                            </button>

                            <div class="admin-scanner-health-card" data-scanner-health>
                                <i aria-hidden="true"></i>
                                <div>
                                    <strong data-scanner-health-title>Scanner not checked</strong>
                                    <span data-scanner-health-detail>Click Find Scanner, then scan any barcode within 6 seconds to pair it. Test uses the same 6-second barcode window.</span>
                                </div>
                            </div>

                            <div class="admin-scanner-health-actions">
                                <button type="button" class="admin-ghost-btn" data-scanner-health-check>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>
                                    Recheck
                                </button>
                                <button type="button" class="admin-primary-btn" data-scanner-test-scan>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10"/></svg>
                                    Test
                                </button>
                            </div>
                        </section>

                        <?php jg_store_ops_print_helper_settings_panel('../'); ?>

                        <section class="admin-settings-panel" data-settings-panel="theme" hidden>
                            <div class="admin-theme-grid" aria-label="Dashboard theme">
                                <button type="button" class="admin-theme-option" data-theme-option="dark" aria-pressed="false">
                                    <span class="admin-theme-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.7 15.1A9 9 0 0 1 8.9 3.3 9 9 0 1 0 20.7 15z"/></svg></span>
                                    <strong>Dark</strong>
                                    <small>Flat black for daily warehouse operations.</small>
                                    <span class="admin-theme-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span>
                                </button>
                                <button type="button" class="admin-theme-option" data-theme-option="light" aria-pressed="false">
                                    <span class="admin-theme-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>
                                    <strong>Light</strong>
                                    <small>Clean contrast for bright workspaces.</small>
                                    <span class="admin-theme-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span>
                                </button>
                                <button type="button" class="admin-theme-option" data-theme-option="system" aria-pressed="false">
                                    <span class="admin-theme-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
                                    <strong>System</strong>
                                    <small>Follow this device automatically.</small>
                                    <span class="admin-theme-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span>
                                </button>
                            </div>
                        </section>

                        <section class="admin-settings-panel" data-settings-panel="platforms" hidden>
                            <div class="admin-settings-section-head">
                                <span class="admin-settings-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 10h16M5 10v10h14V10M3 6l2-3h14l2 3v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/></svg></span>
                                <div>
                                    <h4>Color-code order platforms</h4>
                                    <p>Choose the colors used to identify each order source. Colors follow this employee profile on every Store Ops station.</p>
                                </div>
                            </div>
                            <div class="admin-source-color-list" data-source-color-list></div>
                        </section>
                    </div>
                </main>
            </form>
        </div>

        <?php if ($currentEmployeeCanManageProfiles): ?>
            <div class="admin-modal-shell admin-employee-profiles-modal" data-employee-profiles-modal hidden>
                <div class="admin-modal-backdrop" data-close-employee-profiles></div>
                <section class="admin-modal-card admin-employee-profiles-card" role="dialog" aria-modal="true" aria-labelledby="employee-profiles-title">
                    <div class="admin-modal-head">
                        <div>
                            <span class="admin-panel-kicker">Profiles</span>
                            <h3 id="employee-profiles-title">Store Ops Employees</h3>
                        </div>
                        <button type="button" class="admin-ghost-btn" data-close-employee-profiles>Close</button>
                    </div>
                    <form class="admin-employee-profile-form" data-employee-profile-form>
                        <label class="admin-reprint-field">
                            <span>Employee ID</span>
                            <input class="admin-settings-input" name="id" autocomplete="username" placeholder="vincent" maxlength="64" required>
                        </label>
                        <label class="admin-reprint-field">
                            <span>Display Name</span>
                            <input class="admin-settings-input" name="display_name" autocomplete="name" placeholder="Vincent" maxlength="120" required>
                        </label>
                        <label class="admin-reprint-field">
                            <span>PIN or Password</span>
                            <input class="admin-settings-input" name="pin" type="password" autocomplete="new-password" placeholder="Required for new profile" minlength="4" maxlength="128">
                        </label>
                        <label class="admin-checkbox-line admin-employee-active-toggle">
                            <input type="checkbox" name="active" checked>
                            <span>Active login</span>
                        </label>
                        <p class="admin-form-error" data-employee-profile-error hidden></p>
                        <div class="admin-modal-actions">
                            <button type="button" class="admin-ghost-btn" data-new-employee-profile>New Profile</button>
                            <button type="submit" class="admin-primary-btn">Save Profile</button>
                        </div>
                    </form>
                    <div class="admin-employee-profile-list" data-employee-profile-list>
                        <p class="admin-empty">Loading employee profiles.</p>
                    </div>
                </section>
            </div>
        <?php endif; ?>

        <div class="admin-modal-shell admin-reprint-modal" data-reprint-modal hidden>
            <div class="admin-modal-backdrop" data-close-reprint-modal></div>
            <form class="admin-modal-card admin-reprint-card" data-reprint-form role="dialog" aria-modal="true" aria-labelledby="reprint-title">
                <div class="admin-modal-head">
                    <div>
                        <span class="admin-panel-kicker">Shipping labels</span>
                        <h3 id="reprint-title">Reprint a label</h3>
                    </div>
                    <button type="button" class="admin-ghost-btn" data-close-reprint-modal>Close</button>
                </div>
                <p class="admin-reprint-intro">Enter an exact Order ID, or search by a customer username, name, phone, or email.</p>
                <label class="admin-reprint-field">
                    <span>Order or customer</span>
                    <input
                        class="admin-settings-input"
                        name="order_id"
                        autocomplete="off"
                        placeholder="Order ID, username, or customer name"
                        aria-controls="reprint-search-results"
                        aria-describedby="reprint-search-help"
                        required
                    >
                </label>
                <small class="admin-reprint-help" id="reprint-search-help">Customer matches appear automatically as you type.</small>
                <p class="admin-form-error" data-reprint-error hidden></p>
                <div class="admin-reprint-results" id="reprint-search-results" data-reprint-results aria-live="polite">
                    <p class="admin-empty">Start typing to find a customer, or enter the full Order ID.</p>
                </div>
                <div class="admin-modal-actions">
                    <button type="submit" class="admin-primary-btn" data-reprint-submit>Open exact Order ID</button>
                </div>
            </form>
        </div>
    </div>
    <script src="../store-home.js?v=<?php echo urlencode($storeHomeJsVersion ?: '1'); ?>" defer></script>
</body>
</html>

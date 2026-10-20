<?php
declare(strict_types=1);

require_once __DIR__ . '/auth-runtime.php';

function jg_store_ops_shell_attr(array $attributes): string
{
    $chunks = [];
    foreach ($attributes as $name => $value) {
        if ($value === false || $value === null) {
            continue;
        }
        if ($value === true) {
            $chunks[] = htmlspecialchars((string) $name, ENT_QUOTES, 'UTF-8');
            continue;
        }
        $chunks[] = sprintf(
            '%s="%s"',
            htmlspecialchars((string) $name, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8')
        );
    }

    return $chunks === [] ? '' : ' ' . implode(' ', $chunks);
}

function jg_store_ops_shell_svg(string $name): string
{
    $remoteIcons = [
        'order-records' => 'https://api.iconify.design/material-symbols:history.svg',
        'invoice-records' => 'https://api.iconify.design/material-symbols:receipt-long-outline.svg',
        'invoice-printer' => 'https://api.iconify.design/material-symbols:print-outline.svg',
    ];
    if (isset($remoteIcons[$name])) {
        return sprintf(
            '<span class="admin-store-nav-internet-icon" style="--admin-store-nav-icon: url(%s);" aria-hidden="true"></span>',
            htmlspecialchars($remoteIcons[$name], ENT_QUOTES, 'UTF-8')
        );
    }

    $icons = [
        'orders' => '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3v3h6V3M8 11h8M8 15h6"/></svg>',
        'inventory' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4.4 7.7 12 12l7.6-4.3M12 12v9"/></svg>',
        'stock-adjust' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9v6M11 9v6M14 9v6M17 9v6"/></svg>',
        'returns' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H5l3-3M5 7l3 3M5 7h9a5 5 0 0 1 5 5v1M15 17h4l-3 3M19 17l-3-3M19 17h-9a5 5 0 0 1-5-5v-1"/></svg>',
        'walk-ins' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/></svg>',
        'integrations' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M9 7V3M15 7V3M7 7h10v3a5 5 0 0 1-10 0zM12 15v6"/></svg>',
        'sku-db' => '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
        'reprint' => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>',
        'settings' => '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>',
        'panel' => '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 4v16"/></svg>',
    ];

    return $icons[$name] ?? $icons['panel'];
}

function jg_store_ops_shell_nav_items(string $rootPrefix): array
{
    return [
        ['key' => 'orders', 'label' => 'Orders', 'href' => $rootPrefix . 'dashboard/', 'title' => 'Orders'],
        ['key' => 'order-records', 'label' => 'Order Records', 'href' => $rootPrefix . 'order-records/', 'title' => 'Processed Order Records'],
        ['type' => 'separator', 'label' => 'Inventory tools'],
        ['key' => 'inventory', 'label' => 'Inventory', 'href' => $rootPrefix . 'inventory/', 'title' => 'Inventory'],
        ['key' => 'returns', 'label' => 'Returns', 'href' => $rootPrefix . 'returns/', 'title' => 'Returns'],
        ['key' => 'stock-adjust', 'label' => 'Stock Adjust', 'href' => $rootPrefix . 'stock-adjust/', 'title' => 'Stock Adjust'],
        ['key' => 'sku-db', 'label' => 'SKU catalog', 'href' => $rootPrefix . 'sku-db/', 'title' => 'SKU catalog'],
        ['type' => 'separator', 'label' => 'Counter sales and documents'],
        ['key' => 'walk-ins', 'label' => 'Walk Ins', 'href' => $rootPrefix . 'walk-ins/', 'title' => 'Walk Ins'],
        ['key' => 'invoice-printer', 'label' => 'Invoice Printer', 'href' => $rootPrefix . 'invoice-printer/', 'title' => 'Invoice Printer'],
        ['key' => 'invoice-records', 'label' => 'Invoice Records', 'href' => $rootPrefix . 'invoice-records/', 'title' => 'Invoice Records'],
        ['type' => 'separator', 'label' => 'System tools'],
        ['key' => 'integrations', 'label' => 'Integrations', 'href' => $rootPrefix . 'integrations/', 'title' => 'Integrations'],
    ];
}

function jg_store_ops_shell_employee(): array
{
    $name = jg_admin_current_employee_name();
    $initial = strtoupper(substr(trim($name), 0, 1)) ?: 'O';

    return [
        'id' => jg_admin_current_employee_id(),
        'name' => $name,
        'initial' => $initial,
        'can_manage' => jg_admin_can_manage_employee_profiles(),
    ];
}

function jg_store_ops_shell_open(array $options = []): void
{
    $rootPrefix = (string) ($options['root_prefix'] ?? '../');
    $GLOBALS['jg_store_ops_shell_root_prefix'] = $rootPrefix;
    $active = (string) ($options['active'] ?? '');
    $title = (string) ($options['title'] ?? 'Store Ops');
    $eyebrow = (string) ($options['eyebrow'] ?? 'Store Ops');
    $description = (string) ($options['description'] ?? '');
    $indicator = (string) ($options['indicator'] ?? '');
    $appClass = trim('admin-store-home admin-store-shell ' . (string) ($options['app_class'] ?? ''));
    $appAttributes = is_array($options['app_attributes'] ?? null) ? $options['app_attributes'] : [];
    $employee = jg_store_ops_shell_employee();

    $attributes = array_merge([
        'class' => 'admin-app ' . $appClass,
        'data-store-shell' => true,
        'data-store-active' => $active,
        'data-employee-id' => $employee['id'],
        'data-employee-name' => $employee['name'],
        'data-employee-profiles-endpoint' => $rootPrefix . 'api/employees-v2/',
        'data-scan-bridge-endpoint' => $rootPrefix . 'api/scan-bridge/',
        'data-scan-serial-endpoint' => $rootPrefix . 'api/scan-serial/',
    ], $appAttributes);
    ?>
    <div class="admin-build-badge" aria-label="Store build version">Build 1.05.08</div>
    <div<?php echo jg_store_ops_shell_attr($attributes); ?>>
        <div class="admin-backdrop admin-backdrop-a"></div>
        <div class="admin-backdrop admin-backdrop-b"></div>
        <button type="button" class="admin-store-sidebar-backdrop" data-store-sidebar-backdrop aria-label="Close navigation" tabindex="-1" hidden></button>

        <aside class="admin-store-sidebar" data-store-sidebar id="store-navigation">
            <header class="admin-store-sidebar-head">
                <button type="button" class="admin-store-sidebar-toggle" data-store-sidebar-toggle aria-controls="store-navigation" aria-expanded="true" title="Collapse navigation">
                    <?php echo jg_store_ops_shell_svg('panel'); ?>
                </button>
                <span class="admin-store-sidebar-brand-copy">
                    <strong>Store Ops</strong>
                    <small>Processing only</small>
                </span>
            </header>

            <nav class="admin-store-sidebar-nav" aria-label="Store Ops navigation">
                <?php foreach (jg_store_ops_shell_nav_items($rootPrefix) as $item): ?>
                    <?php if (($item['type'] ?? '') === 'separator'): ?>
                        <span class="admin-store-nav-divider" role="separator" aria-label="<?php echo htmlspecialchars((string) $item['label'], ENT_QUOTES, 'UTF-8'); ?>"></span>
                        <?php continue; ?>
                    <?php endif; ?>
                    <?php $isActive = $active === $item['key']; ?>
                    <a class="admin-store-nav-item<?php echo $isActive ? ' is-active' : ''; ?>" href="<?php echo htmlspecialchars($item['href'], ENT_QUOTES, 'UTF-8'); ?>"<?php echo $isActive ? ' aria-current="page"' : ''; ?> title="<?php echo htmlspecialchars($item['title'], ENT_QUOTES, 'UTF-8'); ?>">
                        <?php echo jg_store_ops_shell_svg($item['key']); ?>
                        <span><?php echo htmlspecialchars($item['label'], ENT_QUOTES, 'UTF-8'); ?></span>
                    </a>
                <?php endforeach; ?>
            </nav>

            <div class="admin-store-sidebar-tools">
                <a class="admin-store-nav-item" href="<?php echo htmlspecialchars($rootPrefix . 'dashboard/print-label/', ENT_QUOTES, 'UTF-8'); ?>" title="Reprint label">
                    <?php echo jg_store_ops_shell_svg('reprint'); ?>
                    <span>Reprint</span>
                </a>
            </div>

            <footer class="admin-store-sidebar-footer">
                <?php if ($employee['can_manage']): ?>
                    <button type="button" class="admin-store-sidebar-profile" data-open-employee-profiles title="Employee profiles">
                <?php else: ?>
                    <div class="admin-store-sidebar-profile">
                <?php endif; ?>
                        <span class="admin-store-profile-avatar"><?php echo htmlspecialchars($employee['initial'], ENT_QUOTES, 'UTF-8'); ?></span>
                        <span class="admin-store-profile-copy">
                            <strong><?php echo htmlspecialchars($employee['name'], ENT_QUOTES, 'UTF-8'); ?></strong>
                            <small>Operator</small>
                        </span>
                <?php if ($employee['can_manage']): ?>
                    </button>
                <?php else: ?>
                    </div>
                <?php endif; ?>
                <button type="button" class="admin-store-nav-item admin-store-settings-launch" data-open-store-settings title="Settings">
                    <?php echo jg_store_ops_shell_svg('settings'); ?>
                    <span>Settings</span>
                </button>
            </footer>
        </aside>

        <div class="admin-store-workspace">
            <header class="admin-topbar admin-store-topbar admin-store-shell-topbar">
                <button type="button" class="admin-store-mobile-menu" data-store-sidebar-toggle aria-controls="store-navigation" aria-expanded="true" aria-label="Open navigation">
                    <?php echo jg_store_ops_shell_svg('panel'); ?>
                </button>
                <section class="admin-store-page-title">
                    <?php if ($eyebrow !== ''): ?>
                        <span><?php echo htmlspecialchars($eyebrow, ENT_QUOTES, 'UTF-8'); ?></span>
                    <?php endif; ?>
                    <h1><?php echo htmlspecialchars($title, ENT_QUOTES, 'UTF-8'); ?></h1>
                    <?php if ($description !== ''): ?>
                        <p><?php echo htmlspecialchars($description, ENT_QUOTES, 'UTF-8'); ?></p>
                    <?php endif; ?>
                </section>
                <div class="admin-topbar-actions">
                    <?php if ($indicator !== ''): ?>
                        <div class="admin-view-indicator"><?php echo htmlspecialchars($indicator, ENT_QUOTES, 'UTF-8'); ?></div>
                    <?php endif; ?>
                    <?php if ($employee['can_manage']): ?>
                        <button type="button" class="admin-store-header-profile" data-open-employee-profiles aria-label="Open profile management">
                    <?php else: ?>
                        <div class="admin-store-header-profile">
                    <?php endif; ?>
                            <span class="admin-store-profile-avatar"><?php echo htmlspecialchars($employee['initial'], ENT_QUOTES, 'UTF-8'); ?></span>
                            <span class="admin-store-profile-copy">
                                <strong><?php echo htmlspecialchars($employee['name'], ENT_QUOTES, 'UTF-8'); ?></strong>
                                <small>Operator</small>
                            </span>
                    <?php if ($employee['can_manage']): ?>
                        </button>
                    <?php else: ?>
                        </div>
                    <?php endif; ?>
                </div>
            </header>
    <?php
}

function jg_store_ops_print_helper_settings_tab(): void
{
    ?>
                        <button type="button" class="admin-settings-tab" data-settings-tab="printer" aria-selected="false">
                            <span class="admin-settings-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg></span>
                            <span><strong>Label printer</strong><small>Automatic printing</small></span>
                            <svg class="admin-settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
    <?php
}

function jg_store_ops_print_helper_settings_panel(string $rootPrefix): void
{
    $printHelperJsVersion = (string) @filemtime(__DIR__ . '/print-helper.js');
    ?>
                        <section class="admin-settings-panel" data-settings-panel="printer" data-print-helper-panel hidden>
                            <div class="admin-settings-section-head">
                                <span class="admin-settings-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg></span>
                                <div>
                                    <h4>Automatic label printing</h4>
                                    <p>With the print helper installed on this Windows computer, a label prints as soon as the last item is scanned and the order completes once the printer has taken it.</p>
                                </div>
                            </div>

                            <div class="admin-scanner-health-card" data-print-helper-health>
                                <i aria-hidden="true"></i>
                                <div>
                                    <strong data-print-helper-title>Print helper not checked</strong>
                                    <span data-print-helper-detail>Press Recheck to look for the helper on this computer.</span>
                                </div>
                            </div>

                            <div class="admin-print-helper-options" data-print-helper-options hidden>
                                <label class="admin-print-helper-toggle">
                                    <input type="checkbox" data-print-helper-enabled>
                                    <span><strong>Print labels automatically on this computer</strong><small>Turn off to go back to the browser print dialog.</small></span>
                                </label>
                                <label class="admin-print-helper-field">
                                    <span>Label printer</span>
                                    <select class="admin-settings-input" data-print-helper-printer></select>
                                </label>
                                <label class="admin-print-helper-toggle">
                                    <input type="checkbox" data-print-helper-fit>
                                    <span><strong>Scale the label to fill the paper</strong><small>Leave off when labels already print at the right size.</small></span>
                                </label>
                            </div>

                            <div class="admin-settings-section-head">
                                <div>
                                    <h4>Install or update the helper</h4>
                                    <p>Download the latest helper, then open <strong>store-ops-print-helper-setup.cmd</strong> on this Windows computer. It replaces the installed helper and starts it automatically. When it finishes, press Recheck, then Test print.</p>
                                </div>
                            </div>
                            <div class="admin-scanner-health-actions">
                                <a class="admin-ghost-btn" href="<?php echo htmlspecialchars($rootPrefix . 'api/print-helper/', ENT_QUOTES, 'UTF-8'); ?>" data-print-helper-update download="store-ops-print-helper-setup.cmd">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>
                                    Install / update helper
                                </a>
                                <button type="button" class="admin-ghost-btn" data-print-helper-check>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>
                                    Recheck
                                </button>
                                <button type="button" class="admin-primary-btn" data-print-helper-test disabled>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg>
                                    Test print
                                </button>
                            </div>
                            <script src="<?php echo htmlspecialchars($rootPrefix . 'print-helper.js?v=' . urlencode($printHelperJsVersion ?: '1'), ENT_QUOTES, 'UTF-8'); ?>" defer></script>
                        </section>
    <?php
}

function jg_store_ops_shell_close(): void
{
    ?>
        </div>

        <div class="admin-modal-shell admin-store-settings-modal" data-store-settings-modal hidden>
            <div class="admin-modal-backdrop" data-close-store-settings></div>
            <section class="admin-modal-card admin-store-settings-card" data-store-settings-form role="dialog" aria-modal="true" aria-labelledby="store-settings-title">
                <aside class="admin-settings-sidebar">
                    <div class="admin-settings-brand">
                        <span class="admin-settings-brand-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M8 10.5h8M8 14h8"/></svg>
                        </span>
                        <span>
                            <strong>Store Ops</strong>
                            <small>Workstation settings</small>
                        </span>
                    </div>

                    <nav class="admin-settings-nav" aria-label="Settings sections">
                        <button type="button" class="admin-settings-tab is-active" data-settings-tab="scanner" aria-selected="true">
                            <span class="admin-settings-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10M8 9h1M11 9h2M15 9h1M8 15h2M12 15h1M15 15h1"/></svg></span>
                            <span><strong>Scanner</strong><small>USB-COM setup</small></span>
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
                                Store Ops Settings
                            </span>
                            <h3 id="store-settings-title" data-settings-title>Scanner setup</h3>
                            <p>Configure the scanner used by this Store Ops station.</p>
                        </div>
                        <div class="admin-settings-header-actions">
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
                        <?php jg_store_ops_print_helper_settings_panel((string) ($GLOBALS['jg_store_ops_shell_root_prefix'] ?? '../')); ?>
                    </div>
                </main>
            </section>
        </div>

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
                    <label>
                        <span>Employee ID</span>
                        <input class="admin-settings-input" name="id" type="text" autocomplete="username" placeholder="branch-vincent" required>
                    </label>
                    <label>
                        <span>Display name</span>
                        <input class="admin-settings-input" name="display_name" type="text" autocomplete="off" placeholder="Branch Vincent" required>
                    </label>
                    <label>
                        <span>PIN</span>
                        <input class="admin-settings-input" name="pin" type="password" autocomplete="new-password" placeholder="Required for new profile" minlength="4" maxlength="128">
                    </label>
                    <label class="admin-checkbox-line admin-employee-active-toggle">
                        <input type="checkbox" name="active" checked>
                        <span>Active employee profile</span>
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
    </div>
    <?php
}

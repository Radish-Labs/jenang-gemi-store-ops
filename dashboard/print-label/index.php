<?php
declare(strict_types=1);

require dirname(__DIR__, 2) . '/auth-runtime.php';
require dirname(__DIR__, 2) . '/store-ops-shell.php';

if (!jg_admin_is_authenticated()) {
    header('Location: ../../');
    exit;
}

$adminCssVersion = (string) @filemtime(dirname(__DIR__, 2) . '/admin.css');
$storeShellJsVersion = (string) @filemtime(dirname(__DIR__, 2) . '/store-shell.js');
$printLabelJsVersion = (string) @filemtime(dirname(__DIR__, 2) . '/print-label.js');
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no">
    <title>Print Label | Jenang Gemi Store Ops</title>
    <meta name="robots" content="noindex,nofollow">
    <?php require dirname(__DIR__, 2) . '/theme-init.php'; ?>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;700&display=swap">
    <link rel="stylesheet" href="../../admin.css?v=<?php echo urlencode($adminCssVersion ?: '1'); ?>">
</head>
<body class="admin-body is-dashboard is-store-home">
    <?php
    jg_store_ops_shell_open([
        'root_prefix' => '../../',
        'active' => 'orders',
        'title' => 'Print Shipping Label',
        'eyebrow' => 'Store Ops',
        'description' => 'Select and print the label format for the active order.',
        'indicator' => 'Order',
        'app_class' => 'admin-print-label-page',
        'app_attributes' => [
            'data-print-label-page' => true,
        ],
    ]);
    ?>

        <main class="admin-print-page-layout">
            <section class="admin-panel admin-print-page-card">
                <div class="admin-scan-head">
                    <div>
                        <span class="admin-panel-kicker">Shipping Label</span>
                        <h3>Print shipping label</h3>
                        <span class="admin-panel-meta" data-print-order-id>Order</span>
                    </div>
                    <span class="admin-status-badge" data-print-status>Loading</span>
                </div>
                <p class="admin-form-error" data-print-error hidden></p>
                <div class="admin-label-option-grid" data-label-options></div>
                <div class="admin-label-preview" data-label-preview hidden>
                    <div class="admin-label-frame-shell">
                        <iframe class="admin-shopee-label-frame" data-label-frame title="Shipping label"></iframe>
                        <button
                            type="button"
                            class="admin-label-viewer-print"
                            data-print-shopee-label
                            aria-label="Print shipping label and complete order"
                            title="Print"
                            disabled
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <section class="admin-label-print-confirmation" data-print-confirmation aria-live="polite" hidden>
                    <button type="button" class="admin-primary-btn admin-print-success-btn" data-confirm-label-printed>Printed successfully</button>
                </section>
                <section class="admin-label-print-done" data-print-done aria-live="polite" hidden>
                    <strong>Label printed</strong>
                    <button type="button" class="admin-ghost-btn" data-print-again>Print again</button>
                </section>
                <button type="button" class="admin-ghost-btn admin-label-browser-print" data-print-browser-fallback hidden>Use the browser print dialog</button>
            </section>
        </main>
    <?php jg_store_ops_shell_close(); ?>
    <script src="../../store-shell.js?v=<?php echo urlencode($storeShellJsVersion ?: '1'); ?>" defer></script>
    <script src="../../print-label.js?v=<?php echo urlencode($printLabelJsVersion ?: '1'); ?>" defer></script>
</body>
</html>

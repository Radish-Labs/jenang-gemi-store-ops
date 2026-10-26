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
$storeScanJsVersion = (string) @filemtime(dirname(__DIR__, 2) . '/store-scan.js');
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no">
    <title>Scan Order | Jenang Gemi Store Ops</title>
    <meta name="robots" content="noindex,nofollow">
    <?php require dirname(__DIR__, 2) . '/theme-init.php'; ?>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;700&display=swap">
    <link rel="stylesheet" href="../../admin.css?v=<?php echo urlencode($adminCssVersion ?: '1'); ?>">
    <link rel="stylesheet" href="../../scan-checklist.css?v=<?php echo urlencode((string) filemtime(dirname(__DIR__, 2) . '/scan-checklist.css')); ?>">
</head>
<body class="admin-body is-dashboard is-store-home">
    <?php
    jg_store_ops_shell_open([
        'root_prefix' => '../../',
        'active' => 'orders',
        'title' => 'Scan Order',
        'eyebrow' => 'Store Ops',
        'description' => 'Product check for the active fulfillment order.',
        'indicator' => 'Order',
        'app_class' => 'admin-store-scan-page',
        'app_attributes' => [
            'data-store-scan' => true,
        ],
    ]);
    ?>

        <main class="admin-scan-page-layout">
            <section class="admin-panel admin-scan-page-card">
                <div class="admin-scan-head">
                    <div>
                        <span class="admin-panel-kicker">Barcode Check</span>
                        <h3>Scan product barcodes</h3>
                        <span class="admin-panel-meta" data-scan-order-id>Order</span>
                    </div>
                    <span class="admin-status-badge" data-scan-progress>0/0</span>
                </div>
                <div class="admin-phone-camera" data-phone-camera hidden>
                    <video data-phone-camera-video muted playsinline autoplay></video>
                    <div class="admin-phone-camera-msg" data-phone-camera-msg hidden>
                        <span data-phone-camera-text>Opening camera…</span>
                        <button type="button" class="admin-primary-btn" data-phone-camera-retry hidden>Try again</button>
                    </div>
                </div>
                <div class="admin-scanner-status-card">
                    <div data-scan-status>
                        <strong>Ready to scan</strong>
                        <span>Scan each product barcode.</span>
                    </div>
                </div>
                <section class="admin-scan-stock-alert" data-stock-warning role="alert" aria-live="assertive" hidden>
                    <span class="admin-scan-stock-alert-icon" aria-hidden="true">!</span>
                    <div>
                        <strong>SOLD OUT — DO NOT SCAN YET</strong>
                        <p data-stock-warning-products>One or more products in this order have no stock.</p>
                        <b>Please update PO amount received before continuing to print.</b>
                    </div>
                    <button type="button" data-stock-warning-dismiss>Dismiss and allow scanning</button>
                </section>
                <div class="admin-mobile-scanner-live-row" data-mobile-scanner-row hidden>
                    <p class="admin-sync-status admin-mobile-scanner-live" data-mobile-scanner-status>Phone scanner on</p>
                    <button type="button" class="admin-ghost-btn" data-mobile-scanner-use-usb>Switch to USB scanner</button>
                </div>
                <p class="admin-sync-status" data-sync-status hidden>Sync pending</p>
                <p class="admin-form-error" data-scan-error hidden></p>
                <div class="admin-scan-list" data-scan-list></div>
            </section>
        </main>
    <?php jg_store_ops_shell_close(); ?>
    <script src="../../scan-checklist.js?v=<?php echo urlencode((string) filemtime(dirname(__DIR__, 2) . '/scan-checklist.js')); ?>" defer></script>
    <script src="../../camera-scanner.js?v=<?php echo urlencode((string) filemtime(dirname(__DIR__, 2) . '/camera-scanner.js')); ?>" defer></script>
    <script src="../../store-device.js?v=<?php echo urlencode((string) filemtime(dirname(__DIR__, 2) . '/store-device.js')); ?>" defer></script>
    <script src="../../scan-handoff.js?v=<?php echo urlencode((string) filemtime(dirname(__DIR__, 2) . '/scan-handoff.js')); ?>" defer></script>
    <script src="../../store-shell.js?v=<?php echo urlencode($storeShellJsVersion ?: '1'); ?>" defer></script>
    <script src="../../store-scan.js?v=<?php echo urlencode($storeScanJsVersion ?: '1'); ?>" defer></script>
</body>
</html>

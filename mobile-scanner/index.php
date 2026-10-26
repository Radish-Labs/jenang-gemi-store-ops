<?php
declare(strict_types=1);

require dirname(__DIR__) . '/auth-runtime.php';

if (!jg_admin_is_authenticated()) {
    header('Location: ../?return=mobile-scanner/');
    exit;
}

$employeeName = jg_admin_current_employee_name();
$mobileScannerJsVersion = (string) @filemtime(dirname(__DIR__) . '/mobile-scanner.js');
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#0b0c0f">
    <title>Mobile Scanner | Jenang Gemi Store Ops</title>
    <meta name="robots" content="noindex,nofollow">
    <?php require dirname(__DIR__) . '/theme-init.php'; ?>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;700&display=swap">
    <style>
        :root {
            --ms-bg: #0b0c0f;
            --ms-card: #16181d;
            --ms-line: #2a2d35;
            --ms-text: #f4f5f7;
            --ms-muted: #9aa0ab;
            --ms-ok: #34d399;
            --ms-error: #f87171;
            --ms-info: #67e8f9;
            --ms-button: #f4f5f7;
            --ms-button-text: #0b0c0f;
        }
        :root[data-admin-theme="light"] {
            --ms-bg: #f4f5f7;
            --ms-card: #ffffff;
            --ms-line: #dfe2e8;
            --ms-text: #111318;
            --ms-muted: #5d6470;
            --ms-ok: #059669;
            --ms-error: #dc2626;
            --ms-info: #0e7490;
            --ms-button: #111318;
            --ms-button-text: #ffffff;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; background: var(--ms-bg); color: var(--ms-text); }
        body {
            font-family: "Plus Jakarta Sans", system-ui, sans-serif;
            padding: max(12px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
            -webkit-tap-highlight-color: transparent;
        }
        .ms-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .ms-head h1 { font: 700 18px/1.2 "Space Grotesk", sans-serif; margin: 0; }
        .ms-head small { display: block; color: var(--ms-muted); font-size: 12px; margin-top: 2px; }
        .ms-head a { color: var(--ms-muted); font-size: 12px; text-decoration: none; border: 1px solid var(--ms-line); border-radius: 999px; padding: 6px 10px; white-space: nowrap; }
        .ms-card { background: var(--ms-card); border: 1px solid var(--ms-line); border-radius: 16px; padding: 14px; margin-bottom: 12px; }
        .ms-wait { text-align: center; padding: 32px 18px; }
        .ms-wait strong { display: block; font-size: 17px; margin-bottom: 6px; }
        .ms-wait span { color: var(--ms-muted); font-size: 14px; line-height: 1.45; }
        .ms-pulse { width: 12px; height: 12px; border-radius: 50%; background: var(--ms-info); margin: 0 auto 14px; animation: ms-pulse 1.6s ease-in-out infinite; }
        @keyframes ms-pulse { 0%, 100% { opacity: .25; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }
        .ms-order { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .ms-order strong { font: 700 16px/1.2 "Space Grotesk", sans-serif; overflow-wrap: anywhere; }
        .ms-order em { font-style: normal; font: 700 20px/1 "Space Grotesk", sans-serif; }
        .ms-camera { position: relative; border-radius: 16px; overflow: hidden; background: #000; aspect-ratio: 4 / 3; margin-bottom: 12px; border: 3px solid transparent; transition: border-color .15s; }
        .ms-camera video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ms-camera::after { content: ""; position: absolute; left: 10%; right: 10%; top: 50%; height: 2px; background: rgba(248, 113, 113, .85); box-shadow: 0 0 10px rgba(248, 113, 113, .9); }
        .ms-camera.is-hit { border-color: var(--ms-ok); }
        .ms-camera-msg { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; text-align: center; color: #fff; background: rgba(0, 0, 0, .72); font-size: 14px; }
        .ms-camera-msg[hidden] { display: none; }
        .ms-btn { appearance: none; border: 0; border-radius: 999px; background: var(--ms-button); color: var(--ms-button-text); font: 700 15px "Plus Jakarta Sans", sans-serif; padding: 12px 20px; min-height: 44px; }
        .ms-camera-msg .ms-btn { background: #fff; color: #000; }
        .ms-result { border-left: 4px solid var(--ms-info); }
        .ms-result.is-ok { border-left-color: var(--ms-ok); }
        .ms-result.is-error { border-left-color: var(--ms-error); }
        .ms-result strong { display: block; font-size: 15px; }
        .ms-result.is-ok strong { color: var(--ms-ok); }
        .ms-result.is-error strong { color: var(--ms-error); }
        .ms-result span { color: var(--ms-muted); font-size: 13px; line-height: 1.4; }
        .ms-items { list-style: none; margin: 0; padding: 0; }
        .ms-items li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--ms-line); font-size: 14px; }
        .ms-items li:first-child { border-top: 0; }
        .ms-items li span small { display: block; color: var(--ms-muted); font-size: 12px; margin-top: 2px; }
        .ms-items li b { white-space: nowrap; }
        .ms-items li.is-done { color: var(--ms-muted); }
        .ms-items li.is-done b { color: var(--ms-ok); }
        .ms-manual { display: flex; gap: 8px; }
        .ms-manual input { flex: 1; min-width: 0; min-height: 44px; border-radius: 12px; border: 1px solid var(--ms-line); background: var(--ms-bg); color: var(--ms-text); padding: 0 12px; font: 500 16px "Plus Jakarta Sans", sans-serif; }
        .ms-error { color: var(--ms-error); font-size: 13px; margin: 0 0 12px; }
        [hidden] { display: none !important; }
    </style>
</head>
<body>
    <main data-mobile-scanner data-endpoint="../api/mobile-scanner/">
        <header class="ms-head">
            <div>
                <h1>Mobile scanner</h1>
                <small>Signed in as <b data-ms-profile><?php echo htmlspecialchars($employeeName !== '' ? $employeeName : 'Store Ops', ENT_QUOTES, 'UTF-8'); ?></b></small>
            </div>
            <a href="../logout/">Switch profile</a>
        </header>

        <p class="ms-error" data-ms-error hidden></p>

        <section class="ms-card ms-wait" data-ms-waiting>
            <div class="ms-pulse" aria-hidden="true"></div>
            <strong>Waiting for an order</strong>
            <span>On the computer signed in as this profile, press <b>Lanjut</b> on an order. The camera opens here automatically.</span>
            <div style="margin-top:18px" data-ms-camera-permission hidden>
                <button type="button" class="ms-btn" data-ms-allow-camera>Allow camera</button>
            </div>
        </section>

        <section data-ms-active hidden>
            <div class="ms-card ms-order">
                <strong data-ms-order>Order</strong>
                <em data-ms-progress>0/0</em>
            </div>
            <div class="ms-camera" data-ms-camera>
                <video data-ms-video muted playsinline autoplay></video>
                <div class="ms-camera-msg" data-ms-camera-msg hidden>
                    <span data-ms-camera-text>Camera is off.</span>
                    <button type="button" class="ms-btn" data-ms-start-camera>Turn on camera</button>
                </div>
            </div>
            <div class="ms-card ms-result" data-ms-result aria-live="polite">
                <strong data-ms-result-title>Ready to scan</strong>
                <span data-ms-result-detail>Point the camera at a product barcode.</span>
            </div>
            <div class="ms-card">
                <ul class="ms-items" data-ms-items></ul>
            </div>
            <form class="ms-card ms-manual" data-ms-manual>
                <input type="text" inputmode="numeric" autocomplete="off" placeholder="Type barcode" aria-label="Type barcode" data-ms-manual-input>
                <button type="submit" class="ms-btn">Send</button>
            </form>
        </section>
    </main>
    <script src="../mobile-scanner.js?v=<?php echo urlencode($mobileScannerJsVersion ?: '1'); ?>" defer></script>
</body>
</html>

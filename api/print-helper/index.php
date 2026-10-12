<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/auth-runtime.php';

jg_admin_require_auth_json();

const JG_PRINT_HELPER_PORT = 47821;

function jg_print_helper_fail(string $message, int $status = 500): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $message], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

// The helper only answers the Store Ops origin baked into its setup file.
function jg_print_helper_store_origin(): string
{
    $host = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($host === '' || preg_match('/^[a-z0-9.-]+(:\d{1,5})?$/', $host) !== 1) {
        jg_print_helper_fail('Store Ops could not determine its own address.', 400);
    }

    $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
    $https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') || $forwardedProto === 'https';

    return ($https ? 'https' : 'http') . '://' . $host;
}

$sourceDir = dirname(__DIR__, 2) . '/print-helper';
$helper = @file_get_contents($sourceDir . '/store-ops-print-helper.ps1');
$template = @file_get_contents($sourceDir . '/setup-template.cmd');
if (!is_string($helper) || $helper === '' || !is_string($template) || $template === '') {
    jg_print_helper_fail('The print helper files are missing from this deployment.');
}

$setup = strtr($template, [
    '{{ORIGIN}}' => jg_print_helper_store_origin(),
    '{{PORT}}' => (string) JG_PRINT_HELPER_PORT,
    '{{HELPER_BASE64}}' => base64_encode($helper),
]);
// cmd.exe needs CRLF line endings to read the batch header reliably.
$setup = str_replace("\n", "\r\n", str_replace(["\r\n", "\r"], "\n", $setup));

header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="store-ops-print-helper-setup.cmd"');
header('Content-Length: ' . strlen($setup));
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
echo $setup;

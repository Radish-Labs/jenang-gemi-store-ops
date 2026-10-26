<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/auth-runtime.php';
require_once dirname(__DIR__, 2) . '/sku-db-bootstrap.php';
require_once dirname(__DIR__, 2) . '/mobile-scanner.php';

jg_admin_require_auth_json();
$employeeId = jg_admin_current_employee_id();
$employeeName = jg_admin_current_employee_name();
// Polled often by both devices; never hold the PHP session lock while working.
session_write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function jg_mobile_scanner_respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$payload = [];
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $decoded = json_decode(is_string($raw) ? $raw : '', true);
    $payload = is_array($decoded) ? $decoded : [];
} elseif ($method !== 'GET') {
    jg_mobile_scanner_respond(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
$action = strtolower(trim((string) ($payload['action'] ?? $_GET['action'] ?? 'phone_state')));
$now = time();

try {
    $pdo = jg_store_ops_sku_db();
    jg_mobile_scanner_ensure_schema($pdo);

    $profile = ['profile_id' => $employeeId, 'profile_name' => $employeeName];
    if ($method === 'GET' && $action === 'phone_state') {
        jg_mobile_scanner_respond(['ok' => true] + $profile + jg_mobile_scanner_phone_state($pdo, $employeeId, $now));
    }
    if ($method === 'GET' && $action === 'status') {
        $row = jg_mobile_scanner_row($pdo, $employeeId);
        jg_mobile_scanner_respond(['ok' => true] + $profile + [
            'phone_connected' => $row !== null && jg_mobile_scanner_phone_connected($row, $now),
        ]);
    }
    if ($method !== 'POST') {
        jg_mobile_scanner_respond(['ok' => false, 'error' => 'Unknown mobile scanner action.'], 400);
    }

    $token = trim((string) ($payload['session'] ?? ''));
    switch ($action) {
        case 'start':
            jg_mobile_scanner_respond(['ok' => true] + jg_mobile_scanner_start(
                $pdo, $employeeId, (string) ($payload['order_id'] ?? ''), $payload['summary'] ?? null, $now
            ));
        case 'poll':
            jg_mobile_scanner_respond(['ok' => true] + jg_mobile_scanner_desktop_poll(
                $pdo, $employeeId, $token, (int) ($payload['after'] ?? 0), $payload['summary'] ?? null, $now
            ));
        case 'end':
            jg_mobile_scanner_end($pdo, $employeeId, $token, $now);
            jg_mobile_scanner_respond(['ok' => true]);
        case 'scan':
            jg_mobile_scanner_respond(jg_mobile_scanner_phone_scan(
                $pdo, $employeeId, $token, (string) ($payload['code'] ?? ''), $now
            ));
    }
    jg_mobile_scanner_respond(['ok' => false, 'error' => 'Unknown mobile scanner action.'], 400);
} catch (InvalidArgumentException $error) {
    jg_mobile_scanner_respond(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    error_log('Store Ops mobile scanner failed: ' . $error->getMessage());
    jg_mobile_scanner_respond(['ok' => false, 'error' => 'Mobile scanner is unavailable. Try again.'], 500);
}

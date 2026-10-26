<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/auth-runtime.php';
require_once dirname(__DIR__, 2) . '/sku-db-bootstrap.php';
require_once dirname(__DIR__, 2) . '/mobile-scanner.php';
require_once dirname(__DIR__, 2) . '/mobile-print.php';
require_once dirname(__DIR__, 2) . '/store-ops-fulfillment-runtime.php';
require_once dirname(__DIR__, 2) . '/scan-handoff.php';

jg_admin_require_auth_json();
$employeeId = jg_admin_current_employee_id();
$employeeName = jg_admin_current_employee_name();

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
// Polled often by both devices; never hold the PHP session lock while working.
// Only station_take writes the session (the computer's label page reads the
// order from it).
if ($action !== 'station_take') {
    session_write_close();
}

/**
 * The order must be claimed by this profile (the phone's) and still open.
 *
 * @return array{source_platform:string,source_account:string,order_id:string}
 */
function jg_mobile_print_verified_key(PDO $pdo, array $order, string $employeeId): array
{
    $key = jg_store_ops_fulfillment_key_from_order($order);
    jg_store_ops_fulfillment_validate_key($key);
    jg_store_ops_scan_handoff_prepare($order, $key);
    $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
    $state = jg_store_ops_fulfillment_state_from_row($row, $employeeId);
    if (!$row || empty($state['claimedBy']) || empty($state['currentEmployeeCanWork'])) {
        throw new InvalidArgumentException('This order is completed, released or assigned to another employee. Return to the board.');
    }
    return $key;
}

try {
    $pdo = jg_store_ops_sku_db();
    jg_mobile_scanner_ensure_schema($pdo);
    jg_mobile_print_ensure_schema($pdo);

    $profile = ['profile_id' => $employeeId, 'profile_name' => $employeeName];
    if ($method === 'GET' && $action === 'phone_state') {
        jg_mobile_scanner_respond(['ok' => true] + $profile + jg_mobile_scanner_phone_wait(
            $pdo, $employeeId, (string) ($_GET['known'] ?? ''), (float) ($_GET['wait'] ?? 0)
        ));
    }
    if ($method === 'GET' && $action === 'status') {
        $row = jg_mobile_scanner_row($pdo, $employeeId);
        jg_mobile_scanner_respond(['ok' => true] + $profile + [
            'phone_connected' => $row !== null && jg_mobile_scanner_phone_connected($row, $now),
        ]);
    }
    if ($method === 'GET' && $action === 'print_job') {
        jg_mobile_scanner_respond(['ok' => true] + jg_mobile_print_job_wait(
            $pdo, $employeeId, (int) ($_GET['job'] ?? 0), (string) ($_GET['known'] ?? ''), (float) ($_GET['wait'] ?? 0)
        ));
    }
    if ($method === 'GET' && $action === 'station') {
        jg_mobile_scanner_respond(['ok' => true, 'station_online' => jg_mobile_print_station_online($pdo, $now)]);
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
            jg_mobile_scanner_respond(['ok' => true] + jg_mobile_scanner_desktop_wait(
                $pdo, $employeeId, $token, (int) ($payload['after'] ?? 0), $payload['summary'] ?? null, (float) ($payload['wait'] ?? 0)
            ));
        case 'update':
            jg_mobile_scanner_respond(['ok' => true, 'active' => jg_mobile_scanner_desktop_update(
                $pdo, $employeeId, $token, $payload['summary'] ?? null, $now
            )]);
        case 'end':
            jg_mobile_scanner_end($pdo, $employeeId, $token, $now);
            jg_mobile_scanner_respond(['ok' => true]);
        case 'print_request':
            $order = is_array($payload['order'] ?? null) ? $payload['order'] : [];
            $key = jg_mobile_print_verified_key($pdo, $order, $employeeId);
            jg_mobile_scanner_respond(['ok' => true] + jg_mobile_print_request($pdo, $employeeId, $order, $key, $now));
        case 'station_wait':
            jg_mobile_scanner_respond(['ok' => true] + jg_mobile_print_station_wait($pdo, $employeeId, (float) ($payload['wait'] ?? 0)));
        case 'station_take':
            // Any profile's job; this computer may be signed in to another one.
            $taken = jg_mobile_print_take($pdo, (int) ($payload['job'] ?? 0), $now);
            if ($taken === null) {
                session_write_close();
                jg_mobile_scanner_respond(['ok' => true, 'taken' => false]);
            }
            try {
                $phoneEmployeeId = $taken['employee_id'];
                jg_mobile_print_verified_key($pdo, $taken['order'], $phoneEmployeeId);
                $actAs = null;
                if (!hash_equals($phoneEmployeeId, $employeeId)) {
                    $actAs = ['id' => $phoneEmployeeId, 'name' => jg_store_ops_fulfillment_employee_name($pdo, $phoneEmployeeId)];
                }
                $handoff = jg_store_ops_scan_handoff_save($taken['order'], $taken['key'], $employeeId, $actAs);
                if (!session_write_close()) {
                    throw new RuntimeException('Unable to save the order for printing.');
                }
            } catch (Throwable $error) {
                session_write_close();
                jg_mobile_print_set_status($pdo, $taken['job'], 'failed', $error instanceof InvalidArgumentException ? $error->getMessage() : 'The computer could not open this order. Try again.', $now);
                throw $error;
            }
            jg_mobile_scanner_respond(['ok' => true, 'taken' => true, 'job' => $taken['job'], 'handoff' => $handoff,
                'for_name' => $actAs['name'] ?? ''] + $taken['key']);
        case 'print_command':
            jg_mobile_scanner_respond(['ok' => true, 'sent' => jg_mobile_print_command(
                $pdo, $employeeId, (int) ($payload['job'] ?? 0), (string) ($payload['command'] ?? ''), $now
            )]);
        case 'station_command':
            jg_mobile_scanner_respond(['ok' => true] + jg_mobile_print_command_wait(
                $pdo, (int) ($payload['job'] ?? 0), (float) ($payload['wait'] ?? 0)
            ));
        case 'station_status':
            jg_mobile_scanner_respond(['ok' => true, 'updated' => jg_mobile_print_set_status(
                $pdo, (int) ($payload['job'] ?? 0), (string) ($payload['status'] ?? ''), (string) ($payload['detail'] ?? ''), $now
            )]);
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

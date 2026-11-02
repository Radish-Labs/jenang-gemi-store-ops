<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/auth-runtime.php';
require_once dirname(__DIR__, 2) . '/walk-ins-bootstrap.php';

jg_admin_require_auth_json();
header('Content-Type: application/json; charset=utf-8');

function jg_store_ops_walkins_fail(string $message, int $status = 422): void
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

function jg_store_ops_walkins_request_json(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function jg_store_ops_walkins_requested_invoice_type(array $payload = []): string
{
    return jg_store_ops_walkins_normalize_invoice_type(
        $payload['invoice_type'] ?? $payload['order_type'] ?? $_GET['invoice_type'] ?? $_GET['order_type'] ?? 'walk_in'
    );
}

function jg_store_ops_walkins_response(PDO $pdo): void
{
    $invoiceType = jg_store_ops_walkins_requested_invoice_type();
    echo json_encode(
        [
            'ok' => true,
            'invoice_type' => $invoiceType,
            'invoice_number' => jg_store_ops_walkins_invoice_number($invoiceType),
            'catalog' => jg_store_ops_walkins_fetch_catalog($pdo),
            'recent' => jg_store_ops_walkins_recent($pdo, 12, $invoiceType),
        ],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
    );
    exit;
}

try {
    $pdo = jg_store_ops_sku_db();
} catch (Throwable $throwable) {
    jg_store_ops_walkins_fail('Unable to connect to the SKU database.', 500);
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

try {
    if ($method === 'GET') {
        $action = (string) ($_GET['action'] ?? '');
        if ($action === 'invoice') {
            $invoiceNumber = jg_store_ops_walkins_normalize_invoice_number((string) ($_GET['invoice_number'] ?? ''));
            $invoice = jg_store_ops_walkins_find_invoice($pdo, $invoiceNumber);
            if ($invoice === null) {
                jg_store_ops_walkins_fail('Invoice was not found.', 404);
            }
            echo json_encode(['ok' => true, 'sale' => $invoice], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            exit;
        }

        if ($action === 'sales_summary') {
            echo json_encode(['ok' => true, 'summary' => jg_store_ops_walkins_sales_summary($pdo)], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            exit;
        }

        jg_store_ops_walkins_response($pdo);
    }

    if ($method !== 'POST') {
        jg_store_ops_walkins_fail('Method not allowed.', 405);
    }

    $payload = jg_store_ops_walkins_request_json();
    $action = (string) ($payload['action'] ?? '');

    if ($action === 'complete_sale') {
        $invoiceType = jg_store_ops_walkins_requested_invoice_type($payload);
        $result = jg_store_ops_walkins_complete_sale($pdo, $payload, jg_admin_current_employee_name());
        echo json_encode(
            [
                'ok' => true,
                'sale' => $result,
                'invoice_type' => $invoiceType,
                'invoice_number' => jg_store_ops_walkins_invoice_number($invoiceType),
                'catalog' => jg_store_ops_walkins_fetch_catalog($pdo),
                'recent' => jg_store_ops_walkins_recent($pdo, 12, $invoiceType),
            ],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
        );
        exit;
    }

    jg_store_ops_walkins_fail('Unknown action.', 400);
} catch (InvalidArgumentException $exception) {
    jg_store_ops_walkins_fail($exception->getMessage(), 422);
} catch (Throwable $throwable) {
    error_log('Store Ops Walk Ins API failed: ' . $throwable->getMessage());
    // Stock shortages and unmapped SKUs arrive here as RuntimeException; say why instead of a bare failure.
    $status = $throwable instanceof PDOException ? 500 : 422;
    jg_store_ops_walkins_fail(jg_store_ops_walkins_error_message($throwable), $status);
}

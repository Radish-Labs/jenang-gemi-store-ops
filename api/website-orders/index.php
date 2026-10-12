<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/website-orders-bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function jg_store_ops_website_json(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if (!jg_store_ops_website_token_matches()) {
    jg_store_ops_website_json(['ok' => false, 'error' => 'Unauthorized'], 401);
}

try {
    $pdo = jg_store_ops_fulfillment_db();
    jg_store_ops_website_ensure_schema($pdo);
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $action = strtolower(trim((string) ($_GET['action'] ?? '')));
    $body = json_decode((string) file_get_contents('php://input'), true);
    $body = is_array($body) ? $body : [];
    $readiness = jg_store_ops_big_set_readiness($pdo);
    if ($action === 'activate') {
        if ($method !== 'POST') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        $currentState = jg_store_ops_website_state($pdo);
        if (jg_store_ops_website_activation_requires_readiness($currentState) && empty($readiness['ready'])) {
            jg_store_ops_website_json(['ok' => false, 'error' => 'store_ops_not_ready', 'readiness' => $readiness], 409);
        }
        jg_store_ops_website_json(['ok' => true, 'state' => jg_store_ops_website_activate($pdo, $body), 'readiness' => $readiness]);
    }
    if ($action === 'automation') {
        if ($method !== 'POST') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        jg_store_ops_website_json(['ok' => true, 'state' => jg_store_ops_website_set_automation_paused($pdo, $body), 'readiness' => $readiness]);
    }
    if ($action === 'ingest') {
        if ($method !== 'POST') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        $order = jg_store_ops_website_ingest($pdo, $body);
        jg_store_ops_website_json(['ok' => true, 'order' => $order]);
    }
    if ($action === 'cancel') {
        if ($method !== 'POST') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        if (strtolower(trim((string) ($body['platform'] ?? ''))) !== 'whatsapp') {
            throw new InvalidArgumentException('Only WhatsApp orders can use this cancellation endpoint.');
        }
        jg_store_ops_website_json([
            'ok' => true,
            'order' => jg_store_ops_whatsapp_cancel_unclaimed(
                $pdo,
                trim((string) ($body['order_id'] ?? $body['order'] ?? ''))
            ),
        ]);
    }
    if ($action === 'recall') {
        if ($method !== 'POST') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        if (strtolower(trim((string) ($body['platform'] ?? ''))) !== 'whatsapp') {
            throw new InvalidArgumentException('Only WhatsApp orders can be moved back to the queue.');
        }
        jg_store_ops_website_json([
            'ok' => true,
            'order' => jg_store_ops_whatsapp_recall_unclaimed(
                $pdo,
                trim((string) ($body['order_id'] ?? $body['order'] ?? ''))
            ),
        ]);
    }
    if ($action === 'whatsapp_status') {
        if ($method !== 'POST') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        jg_store_ops_website_json([
            'ok' => true,
            'order' => jg_store_ops_whatsapp_cancellation_state(
                $pdo,
                trim((string) ($body['order_id'] ?? $body['order'] ?? ''))
            ),
        ]);
    }
    if ($action === 'whatsapp_statuses') {
        if ($method !== 'POST') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        jg_store_ops_website_json([
            'ok' => true,
            'orders' => jg_store_ops_whatsapp_lifecycle_states(
                $pdo,
                is_array($body['order_ids'] ?? null) ? $body['order_ids'] : []
            ),
        ]);
    }
    if ($action === 'state') {
        if ($method !== 'GET') {
            jg_store_ops_website_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
        }
        jg_store_ops_website_json(['ok' => true, 'state' => jg_store_ops_website_state($pdo), 'readiness' => $readiness]);
    }
    jg_store_ops_website_json(['ok' => false, 'error' => 'Unknown action.'], 404);
} catch (InvalidArgumentException $error) {
    jg_store_ops_website_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (RuntimeException $error) {
    jg_store_ops_website_json(['ok' => false, 'error' => $error->getMessage()], 409);
} catch (Throwable $error) {
    error_log('Store Ops website-order API failed: ' . $error->getMessage());
    jg_store_ops_website_json(['ok' => false, 'error' => 'Website-order ingestion failed.'], 500);
}

<?php
declare(strict_types=1);
// Temporary read-only incident diagnostic. Fixed orders; expires automatically.
header('Cache-Control: private, no-store');
header('Content-Type: application/json; charset=utf-8');
$token = preg_replace('/^Bearer /', '', (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
if ($_SERVER['REQUEST_METHOD'] !== 'GET' || time() > 1792382822 || !hash_equals('a0f13fcebfc472ee1b6bf95d759a9c6f0796632174ffa96adb86e39a5dd081a2', hash('sha256', $token))) {
    http_response_code(404); echo '{"ok":false}'; exit;
}
require_once dirname(__DIR__, 2) . '/sku-db-bootstrap.php';
try {
    $pdo = new PDO(sprintf('mysql:host=%s;port=%s;dbname=%s;charset=%s',
        jg_store_ops_sku_config_value('JG_SKU_DB_HOST', 'sku_db_host', 'localhost'),
        jg_store_ops_sku_config_value('JG_SKU_DB_PORT', 'sku_db_port', '3306'),
        jg_store_ops_sku_config_value('JG_SKU_DB_NAME', 'sku_db_name'),
        jg_store_ops_sku_config_value('JG_SKU_DB_CHARSET', 'sku_db_charset', 'utf8mb4')),
        jg_store_ops_sku_config_value('JG_SKU_DB_USER', 'sku_db_user'),
        jg_store_ops_sku_config_value('JG_SKU_DB_PASSWORD', 'sku_db_password'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    $pdo->exec('SET TRANSACTION READ ONLY');
    $pdo->beginTransaction();
    $orders = ['26101921VS91B4', '26101921S6U64B'];
    $result = ['ok' => true, 'at' => gmdate(DATE_ATOM)];
    foreach ([
        'fulfillment' => 'SELECT source_platform, source_account, order_id, status, claimed_by, claimed_at, scan_completed_at, label_printed_at, fulfilled_at, scan_required, scan_completed, items_json, last_activity_at, updated_at FROM store_ops_order_fulfillment_v2 WHERE order_id IN (?, ?)',
        'events' => 'SELECT source_platform, source_account, order_id, event_type, employee_id, sku, quantity, progress_scanned, progress_required, message, created_at FROM store_ops_order_events_v2 WHERE order_id IN (?, ?) ORDER BY id DESC LIMIT 60',
        'stock' => 'SELECT source_platform, source_account, order_id, status, deductions_json, deducted_at, updated_at FROM store_ops_inventory_order_deductions WHERE order_id IN (?, ?)'
    ] as $name => $sql) {
        $statement = $pdo->prepare($sql); $statement->execute($orders); $result[$name] = $statement->fetchAll();
    }
    // Validate only this order's inventory plan without applying a movement.
    $rows = jg_store_ops_astra_rows($pdo);
    $items = json_decode('[{"sku":"ZSYRUP_VANILLA_550ML","quantity":1},{"sku":"ZSYRUP_MINT_550ML","quantity":1},{"sku":"ZSYRUP_LYCHEE_550ML","quantity":1},{"sku":"ZSYRUP_MANGO_550ML","quantity":1},{"sku":"ZSYRUP_STRAWBERRY_550ML","quantity":1},{"sku":"ZSYRUP_PEACH_550ML","quantity":1},{"sku":"ZMERCH_STICKER","quantity":1}]', true);
    try { $result['stock_plan'] = jg_store_ops_astra_deduction_plan($rows, $items); }
    catch (Throwable $error) { $result['stock_plan_error'] = $error->getMessage(); }
    $result['error_log_entries'] = [];
    foreach (array_unique(array_filter([(string) ini_get('error_log'), dirname(__DIR__, 2) . '/error_log', dirname(__DIR__) . '/orders-v2/error_log'])) as $path) {
        if (!is_file($path) || !is_readable($path)) continue;
        $file = fopen($path, 'rb');
        if (!$file) continue;
        fseek($file, max(0, filesize($path) - 262144));
        $tail = stream_get_contents($file); fclose($file);
        foreach (explode("\n", $tail) as $line) {
            if (preg_match('/26101921VS91B4|Store Ops order action failed:|Marketplace processed callback failed:/', $line)) {
                $result['error_log_entries'][] = substr($line, 0, 2000);
            }
        }
    }
    $result['error_log_entries'] = array_slice($result['error_log_entries'], -20);
    $pdo->rollBack();
    echo json_encode($result, JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500); echo json_encode(['ok' => false, 'error' => $error->getMessage()]);
}

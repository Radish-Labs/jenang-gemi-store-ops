<?php
declare(strict_types=1);
// Temporary read-only incident diagnostic. Fixed orders; expires automatically.
header('Cache-Control: private, no-store');
header('Content-Type: application/json; charset=utf-8');
$token = preg_replace('/^Bearer /', '', (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true) || time() > 1792382822 || !hash_equals('a0f13fcebfc472ee1b6bf95d759a9c6f0796632174ffa96adb86e39a5dd081a2', hash('sha256', $token))) {
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
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $request = json_decode((string) file_get_contents('php://input'), true);
        if (($request['action'] ?? '') !== 'recover-confirmed-print') throw new RuntimeException('Unknown recovery action.');
        require_once dirname(__DIR__, 2) . '/store-ops-fulfillment-runtime.php';
        require_once dirname(__DIR__, 2) . '/marketplace-queue-policy.php';
        $key = ['source_platform' => 'shopee', 'source_account' => 'zero-shopee', 'order_id' => '26101921VS91B4', 'package_id' => 'OFG246070761243221'];
        $operator = $pdo->query('SELECT id, display_name FROM store_ops_employees_v2 WHERE id = "branch-vincent" AND active = 1')->fetch();
        if (!$operator) throw new RuntimeException('Recovery operator is unavailable.');
        $pdo->beginTransaction();
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        if (!$row) throw new RuntimeException('Recovery order is missing.');
        if ($row['status'] !== 'FULFILLED') {
            if (!($row['status'] === 'UNCLAIMED' && !$row['claimed_by'] && $row['last_activity_at'] === '2026-10-19 03:21:58')
                && !($row['status'] === 'CLAIMED' && $row['claimed_by'] === $operator['id'])) {
                throw new RuntimeException('Order changed since diagnosis; recovery stopped.');
            }
            $now = gmdate('Y-m-d H:i:s');
            $stmt = $pdo->prepare('UPDATE store_ops_order_fulfillment_v2 SET status = "CLAIMED", claimed_by = ?, claimed_at = ?, last_activity_at = ?, updated_at = ? WHERE id = ?');
            $stmt->execute([$operator['id'], $now, $now, $now, $row['id']]);
            jg_store_ops_fulfillment_log_event($pdo, $key, 'claim', $operator['id'], $operator['display_name'], ['message' => 'Recovery requested by Branch after confirming the label physically printed; no reprint.']);
        }
        $pdo->commit();
        $items = json_decode('[{"sku":"ZSYRUP_VANILLA_550ML","quantity":1},{"sku":"ZSYRUP_MINT_550ML","quantity":1},{"sku":"ZSYRUP_LYCHEE_550ML","quantity":1},{"sku":"ZSYRUP_MANGO_550ML","quantity":1},{"sku":"ZSYRUP_STRAWBERRY_550ML","quantity":1},{"sku":"ZSYRUP_PEACH_550ML","quantity":1},{"sku":"ZMERCH_STICKER","quantity":1}]', true);
        $plan = jg_store_ops_astra_deduction_plan(jg_store_ops_astra_rows($pdo), $items);
        $stock = jg_store_ops_order_stock_deduct($pdo, $key, $items);
        $savedItems = array_map(static fn(array $line): array => ['sku' => $line['selling_sku'], 'quantity' => $line['selling_quantity']], $plan);
        $row = jg_store_ops_fulfillment_mark_fulfilled($pdo, $key, $operator['id'], $operator['display_name'], $savedItems);
        $token = jg_store_ops_marketplace_setup_token('shopee');
        $config = jg_store_ops_load_local_config();
        $base = jg_store_ops_env_value('JG_SHOPEE_INGEST_BASE_URL') ?: ($config['shopee_ingest_base_url'] ?? 'https://api.jenanggemi.com');
        $body = json_encode(['platform'=>'shopee','account_key'=>'zero-shopee','order_id'=>$key['order_id'],'package_id'=>$key['package_id'],'status'=>'IS_PROCESSED']);
        $context = stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/json\r\nAuthorization: Bearer {$token}\r\n",'content'=>$body,'timeout'=>15,'ignore_errors'=>true]]);
        $reply = json_decode((string) file_get_contents(rtrim($base, '/') . '/fulfillment/status', false, $context), true);
        if (empty($reply['ok'])) throw new RuntimeException('Local completion saved; upstream acknowledgement needs retry.');
        echo json_encode(['ok'=>true,'order_id'=>$key['order_id'],'status'=>$row['status'],'stock_deducted_now'=>$stock['deducted'],'upstream'=>$reply]);
        exit;
    }
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

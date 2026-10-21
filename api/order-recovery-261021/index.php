<?php
declare(strict_types=1);
// Temporary incident diagnostic; fixed order, authenticated, and expires in two hours.
header('Content-Type: application/json');
header('Cache-Control: private, no-store');
$key = (string) ($_SERVER['HTTP_X_INCIDENT_KEY'] ?? '');
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true) || time() > 1792582399 || !hash_equals('24d8b1608d6a8843ead5f32f40afa34b8750d9f71ef1a6ee7d3cced3091e9520', hash('sha256', $key))) {
    http_response_code(404); echo '{"ok":false}'; exit;
}
require_once dirname(__DIR__, 2) . '/website-orders-bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
    if (($body['action'] ?? '') !== 'align-dashboard-token' || !hash_equals('57a7173ccf2e82aaac91bc94afd14d96d7372d787cece90d4b8fa29f983b54d5', hash('sha256', jg_store_ops_website_token()))) {
        http_response_code(409); echo '{"ok":false,"error":"Unexpected recovery state"}'; exit;
    }
    $context = stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/json\r\nX-Incident-Key: {$key}\r\n",'content'=>json_encode(['action'=>'sync-token','token'=>jg_store_ops_website_token()]),'timeout'=>20,'ignore_errors'=>true]]);
    $result = json_decode((string) file_get_contents('https://admin.jenanggemi.com/api/order-recovery-261021/', false, $context), true);
    if (!is_array($result) || empty($result['ok'])) http_response_code(409);
    echo json_encode($result ?: ['ok'=>false,'error'=>'Dashboard did not acknowledge repair']); exit;
}

$config = jg_store_ops_load_local_config();
$token = jg_store_ops_website_token();
$auth = trim((string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''));
$provided = str_starts_with($auth, 'Bearer ') ? trim(substr($auth, 7)) : '';
$out = ['ok'=>true, 'token_hash'=>hash('sha256', $token), 'token_length'=>strlen($token),
 'provided_hash'=>hash('sha256', $provided), 'provided_length'=>strlen($provided),
 'explicit_env'=>jg_store_ops_env_value('JG_STORE_OPS_WEBSITE_TOKEN') !== '',
 'explicit_config'=>!empty($config['store_ops_website_token'])];
try { $out['order'] = jg_store_ops_whatsapp_cancellation_state(jg_store_ops_fulfillment_db(), 'WAEXEC-261019-6726EEE4D2'); } catch (Throwable $e) { $out['order_error'] = $e->getMessage(); }
echo json_encode($out, JSON_UNESCAPED_SLASHES);

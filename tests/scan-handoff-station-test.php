<?php
declare(strict_types=1);

// A print station signed in to one profile prints a phone order claimed by
// another profile. The hand-off it saves completes the order as the phone's.
require dirname(__DIR__) . '/scan-handoff.php';

function handoff_expect(mixed $expected, mixed $actual, string $message): void
{
    if ($expected === $actual) return;
    fwrite(STDERR, $message . PHP_EOL . 'Expected: ' . var_export($expected, true) . PHP_EOL . 'Actual: ' . var_export($actual, true) . PHP_EOL);
    exit(1);
}

$_SESSION = [];
$order = ['id' => 'WAEXEC-1', 'platform' => 'whatsapp', 'items' => [['sku' => 'A', 'quantity' => 1]]];
$key = ['order_id' => 'WAEXEC-1', 'source_platform' => 'whatsapp', 'source_account' => 'whatsapp'];

// The computer's own order: acts as the signed-in profile.
$own = jg_store_ops_scan_handoff_save($order, $key, 'budi');
$entry = jg_store_ops_scan_handoff_read($own, 'WAEXEC-1', 'budi');
handoff_expect(['budi', 'Budi'], jg_store_ops_scan_handoff_actor($entry, 'budi', 'Budi'), 'A normal hand-off acts as the computer profile.');

// A phone order from Hani printed on Budi's computer: acts as Hani.
$station = jg_store_ops_scan_handoff_save($order, $key, 'budi', ['id' => 'hani', 'name' => 'Hani']);
handoff_expect(true, $station !== $own, 'The station hand-off is separate from the computer\'s own.');
$entry = jg_store_ops_scan_handoff_read($station, 'WAEXEC-1', 'budi');
handoff_expect(['hani', 'Hani'], jg_store_ops_scan_handoff_actor($entry, 'budi', 'Budi'), 'The station hand-off acts as the phone profile.');

// Only the computer session that took the job can use it, and only for that order.
handoff_expect(null, jg_store_ops_scan_handoff_read($station, 'WAEXEC-1', 'hani'), 'Another session profile cannot read it.');
handoff_expect(null, jg_store_ops_scan_handoff_read($station, 'WAEXEC-2', 'budi'), 'It only covers its own order.');
handoff_expect(['budi', 'Budi'], jg_store_ops_scan_handoff_actor(null, 'budi', 'Budi'), 'No hand-off acts as the computer profile.');

// Printing the same phone order again reuses its hand-off.
handoff_expect($station, jg_store_ops_scan_handoff_save($order, $key, 'budi', ['id' => 'hani', 'name' => 'Hani']), 'A retry reuses the hand-off.');

// A toast Reprint of a finished phone order gets its own reprint-only hand-off.
$reprint = jg_store_ops_scan_handoff_save($order, $key, 'budi', ['id' => 'hani', 'name' => 'Hani'], true);
handoff_expect(true, $reprint !== $station, 'A reprint hand-off is separate from the one that can complete the order.');
$entry = jg_store_ops_scan_handoff_read($reprint, 'WAEXEC-1', 'budi');
handoff_expect(true, !empty($entry['reprint']), 'It is marked as reprint-only.');
handoff_expect(false, !empty(jg_store_ops_scan_handoff_read($station, 'WAEXEC-1', 'budi')['reprint']), 'The normal hand-off is not.');

$orders = (string) file_get_contents(dirname(__DIR__) . '/api/orders-v2/index.php');
handoff_expect(true, str_contains($orders, "!empty(\$entry['reprint']) && \$action !== 'reprint_label'"), 'A reprint hand-off can only reprint, never complete an order.');
$mobile = (string) file_get_contents(dirname(__DIR__) . '/api/mobile-scanner/index.php');
handoff_expect(true, str_contains($mobile, "unset(\$order['print_layout'], \$order['print_reprint'])"), 'A phone cannot mark its own print request as a reprint.');
$print = (string) file_get_contents(dirname(__DIR__) . '/mobile-print.php');
handoff_expect(true, str_contains($print, "(string) \$row['status'] !== 'printed' || (int) \$row['updated_at'] < \$now - 1800"), 'Reprint only the phone\'s own printed job, for 30 minutes.');

echo "scan-handoff-station-test: ok\n";

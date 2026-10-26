<?php
declare(strict_types=1);

require dirname(__DIR__) . '/mobile-scanner.php';

function mobile_scanner_expect(mixed $expected, mixed $actual, string $message): void
{
    if ($expected === $actual) return;
    fwrite(STDERR, $message . PHP_EOL . 'Expected: ' . var_export($expected, true) . PHP_EOL . 'Actual: ' . var_export($actual, true) . PHP_EOL);
    exit(1);
}

// Production MySQL runs with native prepares (EMULATE_PREPARES = false),
// which reject a named placeholder used twice in one statement. SQLite
// allows it, so check the SQL text directly.
$source = (string) file_get_contents(dirname(__DIR__) . '/mobile-scanner.php');
preg_match_all("/prepare\\(\\s*'((?:[^'\\\\]|\\\\.)*)'/s", $source, $statements);
mobile_scanner_expect(true, count($statements[1]) >= 8, 'Expected to find the relay SQL statements.');
foreach ($statements[1] as $sql) {
    preg_match_all('/:[a-z_]+/', $sql, $names);
    $repeated = array_keys(array_filter(array_count_values($names[0]), static fn (int $count): bool => $count > 1));
    mobile_scanner_expect([], $repeated, 'MySQL native prepares reject repeated placeholders: ' . trim(preg_replace('/\s+/', ' ', $sql)));
}

// Set JG_TEST_MYSQL_DSN (plus _USER/_PASSWORD) to run against MySQL/MariaDB
// with the same options as production (see sku-db-bootstrap.php).
$mysqlDsn = (string) getenv('JG_TEST_MYSQL_DSN');
if ($mysqlDsn !== '') {
    $pdo = new PDO($mysqlDsn, (string) getenv('JG_TEST_MYSQL_USER'), (string) getenv('JG_TEST_MYSQL_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('DROP TABLE IF EXISTS store_ops_mobile_scanner_events_v1, store_ops_mobile_scanner_v1');
} elseif (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} else {
    echo "mobile-scanner-test: skipped (no pdo_sqlite)\n";
    exit(0);
}
jg_mobile_scanner_ensure_schema($pdo);
jg_mobile_scanner_ensure_schema($pdo); // Idempotent.
$now = 1_800_000_000;

// Phone waits with no order open.
mobile_scanner_expect(['active' => false], jg_mobile_scanner_phone_state($pdo, 'hani', $now), 'Phone should wait while no desktop order is open.');

// Desktop presses Lanjut: the phone is already connected and sees the order.
$start = jg_mobile_scanner_start($pdo, 'hani', 'ORDER-1', ['scanned' => 0, 'required' => 2, 'items' => [['name' => 'Bubur', 'code' => '012345', 'scanned' => 0, 'required' => 2]]], $now + 1);
mobile_scanner_expect(true, $start['phone_connected'], 'Desktop should see the phone that checked in.');
$state = jg_mobile_scanner_phone_state($pdo, 'hani', $now + 2);
mobile_scanner_expect(true, $state['active'], 'Phone should see the open order.');
mobile_scanner_expect('ORDER-1', $state['order_id'], 'Phone should see the order id.');
mobile_scanner_expect($start['session'], $state['session'], 'Phone should get the desktop session.');
mobile_scanner_expect(2, $state['summary']['required'], 'Phone should see order progress.');

// Another profile never sees this order.
mobile_scanner_expect(['active' => false], jg_mobile_scanner_phone_state($pdo, 'budi', $now + 2), 'Profiles must not share scanners.');
mobile_scanner_expect(false, jg_mobile_scanner_phone_scan($pdo, 'budi', $start['session'], '0123456', $now + 2)['ok'], 'Other profiles cannot scan into this order.');

// Same item twice in a row must arrive twice (quantity 2).
jg_mobile_scanner_phone_scan($pdo, 'hani', $start['session'], '0123456', $now + 3);
jg_mobile_scanner_phone_scan($pdo, 'hani', $start['session'], '0123456', $now + 3);
$poll = jg_mobile_scanner_desktop_poll($pdo, 'hani', $start['session'], 0, ['scanned' => 2, 'required' => 2, 'status' => ['title' => 'Scan accepted', 'tone' => 'ok', 'seq' => 4]], $now + 4);
mobile_scanner_expect(['0123456', '0123456'], array_column($poll['codes'], 'code'), 'Desktop should receive every phone scan in order.');
$last = end($poll['codes'])['id'];
mobile_scanner_expect([], jg_mobile_scanner_desktop_poll($pdo, 'hani', $start['session'], $last, null, $now + 4)['codes'], 'Codes are delivered once.');
$state = jg_mobile_scanner_phone_state($pdo, 'hani', $now + 5);
mobile_scanner_expect('Scan accepted', $state['summary']['status']['title'], 'Phone should see the desktop result.');
mobile_scanner_expect('ok', $state['summary']['status']['tone'], 'Phone should see the result tone.');

// Invalid barcodes are rejected.
foreach (['', str_repeat('9', 200), "01 23", "<script>"] as $bad) {
    try {
        jg_mobile_scanner_phone_scan($pdo, 'hani', $start['session'], $bad, $now + 5);
        if ($bad !== '<script>') { fwrite(STDERR, "Bad code accepted: {$bad}\n"); exit(1); }
    } catch (InvalidArgumentException) {
        // Expected.
    }
}

// Pressing Lanjut on another order moves the phone to the new order.
$next = jg_mobile_scanner_start($pdo, 'hani', 'ORDER-2', null, $now + 6);
mobile_scanner_expect(false, jg_mobile_scanner_desktop_poll($pdo, 'hani', $start['session'], 0, null, $now + 6)['active'], 'The older scan page should lose the phone.');
mobile_scanner_expect(false, jg_mobile_scanner_phone_scan($pdo, 'hani', $start['session'], '111', $now + 6)['ok'], 'Scans for the old order are refused.');
mobile_scanner_expect('ORDER-2', jg_mobile_scanner_phone_state($pdo, 'hani', $now + 6)['order_id'], 'Phone should follow the newest order.');
mobile_scanner_expect([], jg_mobile_scanner_desktop_poll($pdo, 'hani', $next['session'], 0, null, $now + 6)['codes'], 'A new order starts with no scans.');

// A closed desktop tab stops the phone camera.
mobile_scanner_expect(false, jg_mobile_scanner_phone_state($pdo, 'hani', $now + 6 + JG_MOBILE_SCANNER_DESKTOP_STALE_SECONDS + 1)['active'], 'A silent desktop should end the session.');

// Leaving the scan page ends the session right away.
$third = jg_mobile_scanner_start($pdo, 'hani', 'ORDER-3', null, $now + 100);
jg_mobile_scanner_end($pdo, 'hani', $third['session'], $now + 101);
mobile_scanner_expect(['active' => false], jg_mobile_scanner_phone_state($pdo, 'hani', $now + 101), 'Ending the scan page should release the phone.');

try {
    jg_mobile_scanner_start($pdo, '', 'ORDER-1', null, $now);
    fwrite(STDERR, "Profile-less start accepted\n");
    exit(1);
} catch (InvalidArgumentException) {
    // Expected.
}

echo "mobile-scanner-test: ok (" . $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) . ")\n";

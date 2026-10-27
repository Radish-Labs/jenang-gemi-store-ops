<?php
declare(strict_types=1);

require dirname(__DIR__) . '/label-cache.php';

function label_cache_expect(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . ' Expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

$key = 'shopee|jg-shopee|TEST-' . bin2hex(random_bytes(4)) . '|';
$pdf = "%PDF-1.4\nlabel\n%%EOF";

label_cache_expect(null, jg_label_cache_get($key), 'Nothing is cached before the first download.');
jg_label_cache_put($key, $pdf, 'application/pdf', ['x-shopee-package-number' => 'PKG1']);
$hit = jg_label_cache_get($key);
label_cache_expect($pdf, $hit['raw'] ?? null, 'The second download gets the same label.');
label_cache_expect('PKG1', $hit['headers']['x-shopee-package-number'] ?? null, 'Label headers are kept.');
label_cache_expect(null, jg_label_cache_get($key . 'other-package'), 'A different package is a different label.');

$file = jg_label_cache_file($key);
label_cache_expect(0600, fileperms($file) & 0777, 'Only this account can read a cached label.');
label_cache_expect(false, str_starts_with(jg_label_cache_dir(), dirname(__DIR__)), 'Cached labels are never inside the web folder.');

touch($file, time() - JG_LABEL_CACHE_TTL - 5);
clearstatcache();
label_cache_expect(null, jg_label_cache_get($key), 'A label older than 10 minutes is downloaded again.');

$errorKey = $key . 'error';
jg_label_cache_put($errorKey, '{"error":"not ready"}');
label_cache_expect(null, jg_label_cache_get($errorKey), 'Only real PDFs are cached, never an error.');
@unlink($file);

$orders = (string) file_get_contents(dirname(__DIR__) . '/api/orders-v2/index.php');
label_cache_expect(true, str_contains($orders, "jg_store_ops_orders_proxy_file(\$url, \$platform . '-label-'") && str_contains($orders, '$labelCacheKey);'), 'Marketplace labels use the cache.');
label_cache_expect(true, str_contains($orders, "'partner|' . \$orderSn"), 'Partner labels use the cache.');

echo "label-cache-test: ok\n";

# Store Ops Print Helper
#
# Runs on the packing station and lets the Store Ops label page print a
# shipping label without the browser print dialog, then reports what the
# Windows print queue did with it. It only listens on 127.0.0.1 and only
# answers the Store Ops origins listed in config.json.
#
# Keep this file ASCII-only and Windows PowerShell 5.1 compatible.

param(
    [string]$ConfigPath = '',
    [string]$MockStatePath = ''
)

$ErrorActionPreference = 'Stop'
$HelperVersion = '1.0.0'
$MaxLabelBytes = 20MB
$SendTimeoutSeconds = 60
$UnseenJobGraceSeconds = 3

if ($ConfigPath -eq '') {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'config.json'
}
$BaseDir = Split-Path -Parent $ConfigPath
$SpoolDir = Join-Path $BaseDir 'spool'
$LogPath = Join-Path $BaseDir 'helper.log'
$SumatraPath = Join-Path $BaseDir 'SumatraPDF.exe'

function Write-HelperLog([string]$Message) {
    try {
        if ((Test-Path -LiteralPath $LogPath) -and ((Get-Item -LiteralPath $LogPath).Length -gt 1MB)) {
            Remove-Item -LiteralPath $LogPath -Force
        }
        Add-Content -LiteralPath $LogPath -Value ("{0} {1}" -f (Get-Date).ToString('s'), $Message)
    } catch {
        # Logging must never stop printing.
    }
}

$Port = 47821
$AllowedOrigins = @()
if (Test-Path -LiteralPath $ConfigPath) {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if ($config.port) { $Port = [int]$config.port }
    if ($config.allowedOrigins) { $AllowedOrigins = @($config.allowedOrigins | ForEach-Object { [string]$_ }) }
}
if (-not (Test-Path -LiteralPath $SpoolDir)) {
    New-Item -ItemType Directory -Force -Path $SpoolDir | Out-Null
}

# ---------------------------------------------------------------------------
# Printer backend. The mock variant lets the HTTP and job logic be tested on
# a machine without a Windows print spooler.
# ---------------------------------------------------------------------------

function Get-PrinterProblem($Printer) {
    if ($Printer.WorkOffline) { return 'offline' }
    switch ([int]$Printer.DetectedErrorState) {
        4 { return 'paper_out' }
        7 { return 'door_open' }
        8 { return 'jammed' }
        9 { return 'offline' }
    }
    if ([int]$Printer.PrinterStatus -eq 7) { return 'offline' }
    $state = 0
    if ($null -ne $Printer.PrinterState) { $state = [int64]$Printer.PrinterState }
    if ($state -band 0x10) { return 'paper_out' }
    if ($state -band 0x8) { return 'jammed' }
    if ($state -band 0x400000) { return 'door_open' }
    if ($state -band 0x80) { return 'offline' }
    if ($state -band 0x1) { return 'paused' }
    if ($state -band 0x100000) { return 'needs_attention' }
    if ($state -band 0x2) { return 'error' }
    return ''
}

function Get-JobProblem([int64]$Mask) {
    if ($Mask -band 64) { return 'paper_out' }
    if ($Mask -band 32) { return 'offline' }
    if ($Mask -band 1) { return 'paused' }
    if ($Mask -band 1024) { return 'needs_attention' }
    if ($Mask -band 512) { return 'error' }
    if ($Mask -band 2) { return 'error' }
    return ''
}

if ($MockStatePath -eq '') {
    function Get-StationPrinters {
        $items = @()
        foreach ($printer in @(Get-CimInstance -ClassName Win32_Printer)) {
            $items += [pscustomobject]@{
                name = [string]$printer.Name
                default = [bool]$printer.Default
                problem = (Get-PrinterProblem $printer)
            }
        }
        return $items
    }

    function Get-SpoolerJobs([string]$PrinterName) {
        $items = @()
        foreach ($job in @(Get-CimInstance -ClassName Win32_PrintJob)) {
            $name = [string]$job.Name
            if (-not $name.StartsWith($PrinterName + ',', [StringComparison]::OrdinalIgnoreCase)) { continue }
            $mask = 0
            if ($null -ne $job.StatusMask) { $mask = [int64]$job.StatusMask }
            $items += [pscustomobject]@{
                id = [int]$job.JobId
                document = [string]$job.Document
                mask = $mask
            }
        }
        return $items
    }

    function Remove-SpoolerJob([string]$PrinterName, [int]$JobId) {
        foreach ($job in @(Get-CimInstance -ClassName Win32_PrintJob)) {
            $name = [string]$job.Name
            if ([int]$job.JobId -eq $JobId -and $name.StartsWith($PrinterName + ',', [StringComparison]::OrdinalIgnoreCase)) {
                Remove-CimInstance -InputObject $job
            }
        }
    }

    function Start-LabelPrint([string]$PrinterName, [string]$FilePath, [bool]$Fit) {
        if (-not (Test-Path -LiteralPath $SumatraPath)) {
            throw 'SumatraPDF.exe is missing. Run the Store Ops print helper setup again.'
        }
        $scale = 'noscale'
        if ($Fit) { $scale = 'fit' }
        $arguments = '-print-to "{0}" -print-settings "{1}" -silent "{2}"' -f $PrinterName, $scale, $FilePath
        $process = Start-Process -FilePath $SumatraPath -ArgumentList $arguments -PassThru -WindowStyle Hidden
        # Touching the handle keeps ExitCode readable after the process ends.
        $null = $process.Handle
        return $process
    }
} else {
    function Read-MockState {
        return (Get-Content -LiteralPath $MockStatePath -Raw | ConvertFrom-Json)
    }

    function Get-StationPrinters {
        return @((Read-MockState).printers | ForEach-Object {
            [pscustomobject]@{ name = [string]$_.name; default = [bool]$_.default; problem = [string]$_.problem }
        })
    }

    function Get-SpoolerJobs([string]$PrinterName) {
        return @((Read-MockState).jobs | Where-Object { [string]$_.printer -eq $PrinterName } | ForEach-Object {
            [pscustomobject]@{ id = [int]$_.id; document = [string]$_.document; mask = [int64]$_.mask }
        })
    }

    function Remove-SpoolerJob([string]$PrinterName, [int]$JobId) {
        $state = Read-MockState
        $state.jobs = @($state.jobs | Where-Object { [int]$_.id -ne $JobId })
        Set-Content -LiteralPath $MockStatePath -Value ($state | ConvertTo-Json -Depth 6)
    }

    function Start-LabelPrint([string]$PrinterName, [string]$FilePath, [bool]$Fit) {
        return [pscustomobject]@{ HasExited = $true; ExitCode = [int](Read-MockState).exitCode }
    }
}

# ---------------------------------------------------------------------------
# Print jobs
# ---------------------------------------------------------------------------

$Jobs = @{}

function Resolve-Printer([string]$Requested, $Printers) {
    if ($Requested -ne '') {
        return ($Printers | Where-Object { $_.name -eq $Requested } | Select-Object -First 1)
    }
    $default = $Printers | Where-Object { $_.default } | Select-Object -First 1
    if ($default) { return $default }
    if (@($Printers).Count -eq 1) { return @($Printers)[0] }
    return $null
}

function Complete-Job($Job, [string]$State, [string]$Reason) {
    $Job.state = $State
    $Job.reason = $Reason
    $Job.finishedAt = Get-Date
    try {
        if (Test-Path -LiteralPath $Job.file) { Remove-Item -LiteralPath $Job.file -Force }
    } catch {
        # A leftover spool file is removed on the next start.
    }
    Write-HelperLog ("job {0} {1} {2}" -f $Job.id, $State, $Reason)
}

function Update-Job($Job) {
    if ($Job.finishedAt) { return }
    $elapsed = ((Get-Date) - $Job.createdAt).TotalSeconds

    if (-not $Job.process.HasExited) {
        if ($elapsed -gt $SendTimeoutSeconds) {
            try { $Job.process.Kill() } catch { }
            Complete-Job $Job 'failed' 'send_timeout'
            return
        }
    } elseif (-not $Job.sentAt) {
        $Job.sendFailed = ([int]$Job.process.ExitCode -ne 0)
        $Job.sentAt = Get-Date
    }

    $spoolerJobs = @(Get-SpoolerJobs $Job.printer)
    $match = $null
    if ($Job.spoolId) {
        $match = $spoolerJobs | Where-Object { $_.id -eq $Job.spoolId } | Select-Object -First 1
    } else {
        $match = $spoolerJobs | Where-Object { $_.document -like ('*' + $Job.token + '*') } | Select-Object -First 1
        if (-not $match) {
            $match = $spoolerJobs | Where-Object { $Job.baseline -notcontains $_.id } | Select-Object -First 1
        }
        if ($match) { $Job.spoolId = $match.id }
    }

    if ($match) {
        $problem = Get-JobProblem $match.mask
        if ($problem -ne '') {
            $Job.state = 'attention'
            $Job.reason = $problem
        } elseif ($match.mask -band 128) {
            Complete-Job $Job 'done' ''
        } else {
            $Job.state = 'printing'
            $Job.reason = ''
        }
        return
    }

    if ($Job.spoolId) {
        # The queue released the job, so the printer accepted all of it.
        Complete-Job $Job 'done' ''
        return
    }
    if (-not $Job.sentAt) {
        $Job.state = 'sending'
        return
    }

    # Small labels can leave the queue before the first poll sees them.
    $printer = Get-StationPrinters | Where-Object { $_.name -eq $Job.printer } | Select-Object -First 1
    if ($printer -and $printer.problem -ne '') {
        $Job.state = 'attention'
        $Job.reason = $printer.problem
    } elseif (((Get-Date) - $Job.sentAt).TotalSeconds -ge $UnseenJobGraceSeconds) {
        # A failed send that never reached the queue printed nothing.
        if ($Job.sendFailed) {
            Complete-Job $Job 'failed' 'send_failed'
        } else {
            Complete-Job $Job 'done' ''
        }
    } else {
        $Job.state = 'printing'
        $Job.reason = ''
    }
}

function Remove-StaleJobs {
    $cutoff = (Get-Date).AddHours(-1)
    foreach ($id in @($Jobs.Keys)) {
        $job = $Jobs[$id]
        if ($job.finishedAt -and $job.finishedAt -lt $cutoff) { $Jobs.Remove($id) }
    }
}

function Get-JobView($Job) {
    return @{ ok = $true; id = $Job.id; state = $Job.state; reason = $Job.reason; printer = $Job.printer }
}

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

function Send-Json($Context, [int]$Status, $Body) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 6 -Compress))
    $response = $Context.Response
    $response.StatusCode = $Status
    $response.ContentType = 'application/json; charset=utf-8'
    $response.Headers['Cache-Control'] = 'no-store'
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
}

# Decoded by hand so printer names are always read as UTF-8.
function Get-QueryValue($Request, [string]$Name) {
    foreach ($pair in $Request.Url.Query.TrimStart('?').Split('&')) {
        $parts = $pair.Split('=', 2)
        if ($parts.Length -eq 2 -and $parts[0] -eq $Name) {
            return [System.Uri]::UnescapeDataString($parts[1].Replace('+', ' '))
        }
    }
    return ''
}

function Read-LabelBody($Request) {
    if ($Request.ContentLength64 -gt $MaxLabelBytes) { return $null }
    $buffer = New-Object System.IO.MemoryStream
    $chunk = New-Object byte[] 65536
    while ($true) {
        $read = $Request.InputStream.Read($chunk, 0, $chunk.Length)
        if ($read -le 0) { break }
        $buffer.Write($chunk, 0, $read)
        if ($buffer.Length -gt $MaxLabelBytes) { return $null }
    }
    return $buffer.ToArray()
}

function Invoke-PrintRequest($Context) {
    $request = $Context.Request
    $bytes = Read-LabelBody $request
    if ($null -eq $bytes -or $bytes.Length -lt 5 -or [System.Text.Encoding]::ASCII.GetString($bytes, 0, 5) -ne '%PDF-') {
        Send-Json $Context 422 @{ ok = $false; reason = 'bad_label' }
        return
    }

    $printers = @(Get-StationPrinters)
    $printer = Resolve-Printer (Get-QueryValue $request 'printer') $printers
    if (-not $printer -or $printer.name.Contains('"')) {
        Send-Json $Context 422 @{ ok = $false; reason = 'no_printer' }
        return
    }
    if ($printer.problem -ne '') {
        # Refuse up front so labels do not pile up behind a stopped printer.
        Send-Json $Context 409 @{ ok = $false; reason = $printer.problem; printer = $printer.name }
        return
    }

    Remove-StaleJobs
    $id = [guid]::NewGuid().ToString('N')
    $token = 'jg-label-' + $id
    $file = Join-Path $SpoolDir ($token + '.pdf')
    [System.IO.File]::WriteAllBytes($file, $bytes)
    $baseline = @(Get-SpoolerJobs $printer.name | ForEach-Object { $_.id })
    $fit = (Get-QueryValue $request 'fit') -eq '1'
    try {
        $process = Start-LabelPrint $printer.name $file $fit
    } catch {
        Write-HelperLog ("print start failed: {0}" -f $_.Exception.Message)
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        Send-Json $Context 500 @{ ok = $false; reason = 'send_failed'; detail = [string]$_.Exception.Message }
        return
    }

    $job = @{
        id = $id
        token = $token
        file = $file
        printer = $printer.name
        process = $process
        baseline = $baseline
        createdAt = Get-Date
        sentAt = $null
        sendFailed = $false
        finishedAt = $null
        spoolId = $null
        state = 'sending'
        reason = ''
    }
    $Jobs[$id] = $job
    Write-HelperLog ("job {0} sent to {1}" -f $id, $printer.name)
    Update-Job $job
    Send-Json $Context 200 (Get-JobView $job)
}

function Invoke-HelperRequest($Context) {
    $request = $Context.Request
    $response = $Context.Response
    $origin = [string]$request.Headers['Origin']
    $path = $request.Url.AbsolutePath.TrimEnd('/')
    $method = $request.HttpMethod

    if ($origin -ne '') {
        if ($AllowedOrigins -notcontains $origin) {
            Send-Json $Context 403 @{ ok = $false; reason = 'origin_not_allowed' }
            return
        }
        $response.Headers['Access-Control-Allow-Origin'] = $origin
        $response.Headers['Vary'] = 'Origin'
        $response.Headers['Access-Control-Allow-Private-Network'] = 'true'
    } elseif (-not ($method -eq 'GET' -and $path -eq '/status')) {
        # Only Store Ops pages may print; a bare browser visit can read status.
        Send-Json $Context 403 @{ ok = $false; reason = 'origin_required' }
        return
    }

    if ($method -eq 'OPTIONS') {
        $response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        $response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
        $response.Headers['Access-Control-Max-Age'] = '600'
        $response.StatusCode = 204
        $response.OutputStream.Close()
        return
    }

    if ($method -eq 'GET' -and $path -eq '/status') {
        $printers = @(Get-StationPrinters)
        Send-Json $Context 200 @{
            ok = $true
            name = 'store-ops-print-helper'
            version = $HelperVersion
            printers = @($printers | ForEach-Object { @{ name = $_.name; default = $_.default; problem = $_.problem } })
        }
        return
    }

    if ($method -eq 'POST' -and $path -eq '/print') {
        Invoke-PrintRequest $Context
        return
    }

    if ($path -match '^/jobs/([0-9a-f]{32})(/cancel)?$') {
        $job = $Jobs[$Matches[1]]
        $isCancel = [bool]$Matches[2]
        if (-not $job) {
            Send-Json $Context 404 @{ ok = $false; reason = 'unknown_job' }
            return
        }
        if ($isCancel -and $method -eq 'POST') {
            Update-Job $job
            if (-not $job.finishedAt) {
                if (-not $job.process.HasExited) {
                    try { $job.process.Kill() } catch { }
                }
                if ($job.spoolId) { Remove-SpoolerJob $job.printer $job.spoolId }
                Complete-Job $job 'canceled' ''
            }
            Send-Json $Context 200 (Get-JobView $job)
            return
        }
        if (-not $isCancel -and $method -eq 'GET') {
            Update-Job $job
            Send-Json $Context 200 (Get-JobView $job)
            return
        }
    }

    Send-Json $Context 404 @{ ok = $false; reason = 'not_found' }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add(('http://127.0.0.1:{0}/' -f $Port))
try {
    $listener.Start()
} catch {
    # Another copy already owns the port.
    Write-HelperLog ("not started: {0}" -f $_.Exception.Message)
    exit 0
}
Get-ChildItem -LiteralPath $SpoolDir -Filter 'jg-label-*.pdf' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Write-HelperLog ("started v{0} on port {1}" -f $HelperVersion, $Port)

while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
        Invoke-HelperRequest $context
    } catch {
        Write-HelperLog ("request failed: {0}" -f $_.Exception.Message)
        try {
            Send-Json $context 500 @{ ok = $false; reason = 'helper_error'; detail = [string]$_.Exception.Message }
        } catch {
            try { $context.Response.Abort() } catch { }
        }
    }
}

@echo off
title Store Ops Print Helper Setup
set "JG_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:JG_SELF); Invoke-Expression $t.Substring($t.LastIndexOf('#JG-SETUP-BODY'))"
echo.
pause
exit /b
#JG-SETUP-BODY
# Everything below runs in PowerShell. api/print-helper/ fills in the
# placeholders when a signed-in Store Ops user downloads this file.
$ErrorActionPreference = 'Stop'
$storeOrigin = '{{ORIGIN}}'
$helperPort = {{PORT}}
$helperSource = '{{HELPER_BASE64}}'
$sumatraUrl = 'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip'
$sumatraSha256 = '66ccb395c9184dce6822dfbb9970c877383b3ead6d9417b5106a844aac512989'

$installDir = Join-Path $env:LOCALAPPDATA 'JGStoreOpsPrint'
$helperPath = Join-Path $installDir 'store-ops-print-helper.ps1'
$configPath = Join-Path $installDir 'config.json'
$sumatraPath = Join-Path $installDir 'SumatraPDF.exe'
$powershellPath = Join-Path $PSHOME 'powershell.exe'

try {
    Write-Host 'Installing the Store Ops print helper...'
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $installDir 'spool') | Out-Null

    # Stop a copy from an earlier setup so the new files can be written.
    Get-CimInstance -ClassName Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -like '*store-ops-print-helper.ps1*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    [IO.File]::WriteAllBytes($helperPath, [Convert]::FromBase64String($helperSource))

    $origins = @($storeOrigin)
    if (Test-Path -LiteralPath $configPath) {
        try {
            $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            foreach ($origin in @($existing.allowedOrigins)) {
                if ($origin -and ($origins -notcontains [string]$origin)) { $origins += [string]$origin }
            }
        } catch {
            # A damaged config is simply replaced.
        }
    }
    $config = @{ port = $helperPort; allowedOrigins = @($origins) }
    Set-Content -LiteralPath $configPath -Value ($config | ConvertTo-Json) -Encoding ASCII

    $haveSumatra = (Test-Path -LiteralPath $sumatraPath)
    if (-not $haveSumatra) {
        Write-Host 'Downloading the PDF printing component (about 8 MB)...'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $zipPath = Join-Path $installDir 'sumatra.zip'
        $unpackDir = Join-Path $installDir 'sumatra-unpack'
        Invoke-WebRequest -Uri $sumatraUrl -OutFile $zipPath -UseBasicParsing
        $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $sumatraSha256) {
            Remove-Item -LiteralPath $zipPath -Force
            throw 'The PDF printing component did not match its expected checksum.'
        }
        if (Test-Path -LiteralPath $unpackDir) { Remove-Item -LiteralPath $unpackDir -Recurse -Force }
        Expand-Archive -LiteralPath $zipPath -DestinationPath $unpackDir
        $exe = Get-ChildItem -LiteralPath $unpackDir -Filter 'SumatraPDF*.exe' | Select-Object -First 1
        if (-not $exe) { throw 'The PDF printing component download was incomplete.' }
        Move-Item -LiteralPath $exe.FullName -Destination $sumatraPath -Force
        Remove-Item -LiteralPath $unpackDir -Recurse -Force
        Remove-Item -LiteralPath $zipPath -Force
    }

    # Start with Windows for this user. No administrator rights are needed.
    $launchArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $helperPath
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Store Ops Print Helper.lnk'))
    $shortcut.TargetPath = $powershellPath
    $shortcut.Arguments = $launchArguments
    $shortcut.WorkingDirectory = $installDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Prints Store Ops shipping labels without the browser print dialog.'
    $shortcut.Save()

    Start-Process -FilePath $powershellPath -ArgumentList $launchArguments -WindowStyle Hidden

    $status = $null
    for ($attempt = 0; $attempt -lt 10 -and -not $status; $attempt++) {
        Start-Sleep -Milliseconds 700
        try {
            $status = Invoke-RestMethod -Uri ('http://127.0.0.1:{0}/status' -f $helperPort) -TimeoutSec 3
        } catch {
            $status = $null
        }
    }
    if (-not $status) { throw ('The helper was installed but did not start. See ' + (Join-Path $installDir 'helper.log')) }

    Write-Host ''
    Write-Host ('Done. Print helper {0} is running for {1}.' -f $status.version, $storeOrigin) -ForegroundColor Green
    Write-Host 'Printers found on this computer:'
    foreach ($printer in @($status.printers)) {
        $note = ''
        if ($printer.default) { $note = ' (Windows default)' }
        Write-Host ('  - {0}{1}' -f $printer.name, $note)
    }
    Write-Host ''
    Write-Host 'Go back to Store Ops > Settings > Label printer and press Recheck.'
} catch {
    Write-Host ''
    Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
}

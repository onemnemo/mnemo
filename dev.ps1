# Launches the two dev processes in the right order.
#
# The host must come up first: it writes mnemo-web/.dev/api.json with the API
# port and this launch's auth token, and Vite reads that port once when its
# config loads. Starting Vite first would pin it to the default port and leave
# it proxying without auth until a restart.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$web = Join-Path $root 'mnemo-web'
$handshake = Join-Path $web '.dev\api.json'

if (-not (Test-Path (Join-Path $web 'node_modules'))) {
    Write-Host 'Installing web dependencies...' -ForegroundColor Cyan
    Push-Location $web
    try { npm install } finally { Pop-Location }
}

# A leftover file from the previous run would satisfy the wait below instantly,
# so drop it and let this host write a fresh port and token.
if (Test-Path $handshake) { Remove-Item $handshake -Force }

Write-Host 'Starting Mnemo.Host (--dev)...' -ForegroundColor Cyan
$host_ = Start-Process powershell `
    -ArgumentList '-NoExit', '-Command', "dotnet run --project Mnemo.Host -- --dev" `
    -WorkingDirectory $root -PassThru

Write-Host 'Waiting for the host handshake file...' -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(180)
while (-not (Test-Path $handshake)) {
    if ($host_.HasExited) {
        Write-Host 'The host exited before writing .dev/api.json. Check its window for the error.' -ForegroundColor Red
        Read-Host 'Press Enter to close'
        exit 1
    }
    if ((Get-Date) -gt $deadline) {
        Write-Host 'Timed out waiting for .dev/api.json (the first build can be slow; try again).' -ForegroundColor Red
        Read-Host 'Press Enter to close'
        exit 1
    }
    Start-Sleep -Milliseconds 250
}

Write-Host 'Starting Vite...' -ForegroundColor Cyan
Start-Process powershell `
    -ArgumentList '-NoExit', '-Command', 'npm run dev' `
    -WorkingDirectory $web | Out-Null

Write-Host 'Both are running in their own windows. The app window opens once Vite is up.' -ForegroundColor Green

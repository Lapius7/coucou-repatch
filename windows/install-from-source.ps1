# Builds Coucou from source and installs it for the current user (no admin prompt).
#
#   powershell -ExecutionPolicy Bypass -File install-from-source.ps1
#   powershell -ExecutionPolicy Bypass -File install-from-source.ps1 -Light   # gentler on a slow PC
#
# -Light uses 4 compile jobs at below-normal priority, so the PC stays usable (the first build
# takes a few minutes either way).

param([switch]$Light)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Need($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "$name was not found. $hint" -ForegroundColor Red
        exit 1
    }
}

Need 'node'  'Install Node 20 or newer: https://nodejs.org'
Need 'cargo' 'Install Rust: https://rustup.rs (it also asks for the Visual Studio C++ build tools).'

if ($Light) {
    $env:CARGO_BUILD_JOBS = '4'
    (Get-Process -Id $PID).PriorityClass = 'BelowNormal'
}

Write-Host '1/3  Installing the front end packages...' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '2/3  Building the installer (a few minutes the first time)...' -ForegroundColor Cyan
npm run pack
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$setup = Join-Path $PSScriptRoot 'release\Coucou-Windows-setup.exe'
if (-not (Test-Path $setup)) {
    Write-Host "The installer was not found at $setup" -ForegroundColor Red
    exit 1
}

Write-Host '3/3  Installing...' -ForegroundColor Cyan
Get-Process coucou -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process $setup -Wait
Write-Host 'Done. Coucou starts by itself; its setup window opens the first time.' -ForegroundColor Green

# Talk to Figma MCP Plugin Installer
# Usage: Download ZIP from GitHub Release, extract, run this script

$ErrorActionPreference = 'Stop'
$pluginDir = "$env:LOCALAPPDATA\FigmaPlugins\talk-to-figma-mcp"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ''
Write-Host '===== Talk to Figma MCP Plugin Installer =====' -ForegroundColor Cyan
Write-Host ''

# Check plugin files exist next to this script
$files = @('manifest.json', 'code.js', 'ui.html')
foreach ($f in $files) {
    $path = Join-Path $scriptDir $f
    if (-not (Test-Path $path)) {
        Write-Host "ERROR: $f not found in $scriptDir" -ForegroundColor Red
        Write-Host 'Make sure manifest.json, code.js, ui.html are in the same folder as this script.' -ForegroundColor Yellow
        Read-Host 'Press Enter to exit'
        exit 1
    }
}

# Copy to standard location
Write-Host '[1/2] Installing plugin files...' -ForegroundColor Yellow
if (Test-Path $pluginDir) { Remove-Item $pluginDir -Recurse -Force }
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null

foreach ($f in $files) {
    Copy-Item (Join-Path $scriptDir $f) (Join-Path $pluginDir $f) -Force
    Write-Host "  Copied $f" -ForegroundColor Gray
}

$manifestPath = Join-Path $pluginDir 'manifest.json'
Write-Host '[2/2] Done!' -ForegroundColor Green
Write-Host ''
Write-Host "Installed to: $pluginDir" -ForegroundColor Green
Write-Host ''
Write-Host '===== First time only =====' -ForegroundColor Cyan
Write-Host '1. Open Figma Desktop'
Write-Host '2. Plugins -> Development -> Import plugin from manifest...'
Write-Host "3. Select: $manifestPath" -ForegroundColor Yellow
Write-Host ''
Write-Host 'Next time: download new ZIP, extract, run this script again.' -ForegroundColor Green
Write-Host ''

explorer.exe $pluginDir
Read-Host 'Press Enter to exit'

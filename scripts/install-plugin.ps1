# Talk to Figma MCP Plugin Installer
# Right-click -> Run with PowerShell

$ErrorActionPreference = 'Stop'
$pluginDir = "$env:LOCALAPPDATA\FigmaPlugins\talk-to-figma-mcp"
$zipUrl = 'https://github.com/KCTW/talk-to-figma-mcp/releases/latest/download/talk-to-figma-plugin-v1.0.0.zip'
$tempZip = "$env:TEMP\talk-to-figma-plugin.zip"

Write-Host ''
Write-Host '===== Talk to Figma MCP Plugin Installer =====' -ForegroundColor Cyan
Write-Host ''

# Step 1: Download
Write-Host '[1/3] Downloading plugin...' -ForegroundColor Yellow
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing
} catch {
    Write-Host 'Download failed. Check repo access.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

# Step 2: Extract
Write-Host '[2/3] Extracting...' -ForegroundColor Yellow
if (Test-Path $pluginDir) { Remove-Item $pluginDir -Recurse -Force }
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
Expand-Archive -Path $tempZip -DestinationPath $pluginDir -Force
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue

# Step 3: Done
$manifestPath = Join-Path $pluginDir 'manifest.json'
Write-Host '[3/3] Done!' -ForegroundColor Green
Write-Host ''
Write-Host "Plugin installed to:" -ForegroundColor Green
Write-Host "  $pluginDir" -ForegroundColor White
Write-Host ''
Write-Host '===== Next Step (first time only) =====' -ForegroundColor Cyan
Write-Host '1. Open Figma Desktop'
Write-Host '2. Menu -> Plugins -> Development -> Import plugin from manifest...'
Write-Host "3. Select: $manifestPath" -ForegroundColor Yellow
Write-Host ''
Write-Host 'Future updates: just re-run this script.' -ForegroundColor Green
Write-Host ''

# Open the plugin folder
explorer.exe $pluginDir

Read-Host 'Press Enter to exit'

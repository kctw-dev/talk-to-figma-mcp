@echo off
chcp 65001 >nul 2>&1
title Talk to Figma MCP Plugin Installer

set "PS1_FILE=%TEMP%\install-figma-plugin.ps1"

echo Writing installer script...

(
echo $ErrorActionPreference = 'Stop'
echo $pluginDir = "$env:LOCALAPPDATA\FigmaPlugins\talk-to-figma-mcp"
echo $zipUrl = 'https://github.com/KCTW/talk-to-figma-mcp/releases/latest/download/talk-to-figma-plugin-v1.0.0.zip'
echo $tempZip = "$env:TEMP\talk-to-figma-plugin.zip"
echo.
echo Write-Host ''
echo Write-Host '===== Talk to Figma MCP Plugin Installer =====' -ForegroundColor Cyan
echo Write-Host ''
echo.
echo Write-Host '[1/3] Downloading plugin...' -ForegroundColor Yellow
echo try {
echo     [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
echo     Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing
echo } catch {
echo     Write-Host 'Download failed. Check repo access.' -ForegroundColor Red
echo     Write-Host $_.Exception.Message -ForegroundColor Red
echo     Read-Host 'Press Enter to exit'
echo     exit 1
echo }
echo.
echo Write-Host '[2/3] Extracting...' -ForegroundColor Yellow
echo if (Test-Path $pluginDir^) { Remove-Item $pluginDir -Recurse -Force }
echo New-Item -ItemType Directory -Path $pluginDir -Force ^| Out-Null
echo Expand-Archive -Path $tempZip -DestinationPath $pluginDir -Force
echo Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
echo.
echo $manifestPath = Join-Path $pluginDir 'manifest.json'
echo Write-Host '[3/3] Done!' -ForegroundColor Green
echo Write-Host ''
echo Write-Host "Plugin installed to: $pluginDir" -ForegroundColor Green
echo Write-Host ''
echo Write-Host '===== Next Step (first time only) =====' -ForegroundColor Cyan
echo Write-Host '1. Open Figma Desktop'
echo Write-Host '2. Menu: Plugins - Development - Import plugin from manifest...'
echo Write-Host "3. Select: $manifestPath" -ForegroundColor Yellow
echo Write-Host ''
echo Write-Host 'Future updates: just re-run this installer.' -ForegroundColor Green
echo Write-Host ''
echo explorer.exe $pluginDir
echo Read-Host 'Press Enter to exit'
) > "%PS1_FILE%"

powershell -ExecutionPolicy Bypass -File "%PS1_FILE%"
del "%PS1_FILE%" >nul 2>&1

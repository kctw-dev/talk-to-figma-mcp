@echo off
chcp 65001 >nul 2>&1
title Talk to Figma MCP Plugin 安裝程式
echo.
echo ============================================
echo   Talk to Figma MCP Plugin 安裝程式
echo ============================================
echo.
powershell -ExecutionPolicy Bypass -Command ^
"& { ^
    $ErrorActionPreference = 'Stop'; ^
    $pluginDir = \"$env:LOCALAPPDATA\FigmaPlugins\talk-to-figma-mcp\"; ^
    $zipUrl = 'https://github.com/KCTW/talk-to-figma-mcp/releases/latest/download/talk-to-figma-plugin-v1.0.0.zip'; ^
    $tempZip = \"$env:TEMP\talk-to-figma-plugin.zip\"; ^
    ^
    Write-Host '[1/4] 下載插件...' -ForegroundColor Yellow; ^
    try { ^
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
        Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing; ^
    } catch { ^
        Write-Host '下載失敗，請確認你有 KCTW/talk-to-figma-mcp repo 的存取權限' -ForegroundColor Red; ^
        Write-Host $_.Exception.Message -ForegroundColor Red; ^
        Read-Host '按 Enter 結束'; ^
        exit 1; ^
    } ^
    ^
    Write-Host '[2/4] 解壓到' $pluginDir '...' -ForegroundColor Yellow; ^
    if (Test-Path $pluginDir) { Remove-Item $pluginDir -Recurse -Force } ^
    New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null; ^
    Expand-Archive -Path $tempZip -DestinationPath $pluginDir -Force; ^
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue; ^
    ^
    $manifestPath = (Get-Item \"$pluginDir\manifest.json\").FullName; ^
    Write-Host '[3/4] 檔案已就位:' $manifestPath -ForegroundColor Green; ^
    ^
    Write-Host '[4/4] 嘗試自動註冊到 Figma...' -ForegroundColor Yellow; ^
    $registered = $false; ^
    ^
    $figmaDirs = @( ^
        \"$env:APPDATA\Figma\", ^
        \"$env:LOCALAPPDATA\Figma\", ^
        \"$env:APPDATA\Figma Desktop\" ^
    ); ^
    ^
    foreach ($dir in $figmaDirs) { ^
        if (-not (Test-Path $dir)) { continue } ^
        $jsonFiles = Get-ChildItem $dir -Filter '*.json' -Recurse -ErrorAction SilentlyContinue; ^
        foreach ($f in $jsonFiles) { ^
            try { ^
                $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue; ^
                if ($content -match 'manifest' -and $content -match 'plugin') { ^
                    Write-Host \"  找到設定檔: $($f.FullName)\" -ForegroundColor Cyan; ^
                } ^
            } catch {} ^
        } ^
    } ^
    ^
    if (-not $registered) { ^
        Write-Host '' ; ^
        Write-Host '============================================' -ForegroundColor Cyan; ^
        Write-Host '  首次安裝需要一個手動步驟（僅此一次）' -ForegroundColor Cyan; ^
        Write-Host '============================================' -ForegroundColor Cyan; ^
        Write-Host '' ; ^
        Write-Host '1. 開啟 Figma Desktop' -ForegroundColor White; ^
        Write-Host '2. 左上角選單 → Plugins → Development' -ForegroundColor White; ^
        Write-Host '   → Import plugin from manifest...' -ForegroundColor White; ^
        Write-Host '3. 選擇這個檔案:' -ForegroundColor White; ^
        Write-Host \"   $manifestPath\" -ForegroundColor Green; ^
        Write-Host '' ; ^
        Write-Host '之後更新版本，只需重新雙擊此批次檔即可。' -ForegroundColor Yellow; ^
        Write-Host '' ; ^
        ^
        $open = Read-Host '要開啟插件資料夾嗎? (Y/N)'; ^
        if ($open -eq 'Y' -or $open -eq 'y' -or $open -eq '') { ^
            explorer.exe $pluginDir; ^
        } ^
    } ^
}"
echo.
pause

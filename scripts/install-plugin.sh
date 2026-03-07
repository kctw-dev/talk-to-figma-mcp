#!/bin/bash
# Talk to Figma MCP Plugin — 一鍵安裝腳本
# 用法: curl -sL https://raw.githubusercontent.com/KCTW/talk-to-figma-mcp/main/scripts/install-plugin.sh | bash

set -e

INSTALL_DIR="$HOME/figma-plugins/talk-to-figma-mcp"
REPO_URL="https://github.com/KCTW/talk-to-figma-mcp"
ZIP_URL="$REPO_URL/archive/refs/heads/main.zip"
TMP_ZIP="/tmp/talk-to-figma-mcp.zip"
TMP_DIR="/tmp/talk-to-figma-mcp-main"

echo "=== Talk to Figma MCP Plugin 安裝 ==="
echo ""

# 下載
echo "[1/3] 下載最新版本..."
curl -sL "$ZIP_URL" -o "$TMP_ZIP"

# 解壓
echo "[2/3] 解壓到 $INSTALL_DIR ..."
rm -rf "$TMP_DIR"
unzip -qo "$TMP_ZIP" -d /tmp/

# 只複製 plugin 需要的檔案
mkdir -p "$INSTALL_DIR"
cp "$TMP_DIR/src/cursor_mcp_plugin/manifest.json" "$INSTALL_DIR/"
cp "$TMP_DIR/src/cursor_mcp_plugin/code.js" "$INSTALL_DIR/"
cp "$TMP_DIR/src/cursor_mcp_plugin/ui.html" "$INSTALL_DIR/"

# 清理
rm -rf "$TMP_ZIP" "$TMP_DIR"

echo "[3/3] 安裝完成!"
echo ""
echo "=== 檔案位置 ==="
echo "$INSTALL_DIR/manifest.json"
echo "$INSTALL_DIR/code.js"
echo "$INSTALL_DIR/ui.html"
echo ""
echo "=== 下一步（僅需一次）==="
echo "1. 開啟 Figma Desktop"
echo "2. 左上角選單 → Plugins → Development → Import plugin from manifest..."
echo "3. 選擇: $INSTALL_DIR/manifest.json"
echo ""
echo "之後每次更新只需重新執行此腳本，Figma 會自動讀取新檔案。"

# Talk to Figma MCP（KCTW Fork）

讓 AI Agent（Claude Code / Cursor）透過 MCP 協定直接操作 Figma Desktop，實現 AI 自主 UI 設計。

基於 [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp) v0.3.4 的私有 fork。

## 與 Upstream 的差異

### 新增工具

| 工具 | 功能 | 狀態 |
|------|------|------|
| `set_reactions` | Prototype 互動（ON_CLICK 導航等） | ✅ |
| `create_component_from_node` | Frame 轉 Component | ✅ |
| `create_component_instance` | 建立 Component Instance（含 componentId 支援）| ✅ |
| `create_variables` | 建立 Variable Collection（COLOR/FLOAT/STRING/BOOLEAN，多模式）| ✅ |
| `rename_node` | 節點重命名 | ✅ |
| `bind_variable_to_fill` | 綁定 Variable 到填色 | 🔄 開發中 |
| `bind_variable_to_stroke` | 綁定 Variable 到邊框色 | 🔄 開發中 |

### 多 Agent 支援

WebSocket Server 支援 **Correlation ID 定向路由**，多個 MCP Agent 可同時操作同一個 Figma 文件而不互相干擾。

- 每個連線分配 `clientId`
- 指令送出時記錄 `messageId → sender`
- Plugin 回應時只路由給原始發送者（非廣播）
- 30 秒 timeout 自動清理過期 request
- 向後相容：無 `id` 的訊息仍廣播

### 連線簡化

- **免驗證模式**：WebSocket 連線不需 ECDSA 簽名，立即放行（適合本地開發）
- **自動加入 Channel**：MCP Server 用 `MCP_CHANNEL` 環境變數，Plugin 用 UI 輸入欄位
- 支援多專案同時使用（每個專案設不同 channel 名稱）

## 架構

```
Windows (Figma Desktop + Plugin)
      ↕ WebSocket (port 3055)
WSL2 / Linux (socket.ts)
      ↕ stdio
Claude Code (MCP Server → dist/server.js)
```

支援環境：
- **Windows + WSL2**：Plugin 在 Windows Figma，Server 在 WSL2
- **本地開發**：全部在同一台
- **遠端**：透過 SSH Tunnel 或 Cloudflare Tunnel

## 安裝

### 前置需求

- [Bun](https://bun.sh/)（WebSocket Server）
- [Node.js 18+](https://nodejs.org/)（MCP Server）
- Figma Desktop App

### 1. Clone + Build

```bash
git clone https://github.com/kctw-dev/talk-to-figma-mcp.git
cd talk-to-figma-mcp
npm install
npm run build
```

### 2. 啟動 WebSocket Server

```bash
bun run src/socket.ts
# WebSocket server running on port 3055
```

### 3. 安裝 Figma Plugin

**Windows + WSL2 環境**：
```bash
# 從 WSL2 複製 Plugin 到 Windows
cp src/cursor_mcp_plugin/code.js /mnt/c/Users/<USERNAME>/figma-plugin/
cp src/cursor_mcp_plugin/manifest.json /mnt/c/Users/<USERNAME>/figma-plugin/
cp src/cursor_mcp_plugin/ui.html /mnt/c/Users/<USERNAME>/figma-plugin/
```

在 Figma Desktop：
1. Plugins → Development → **Import plugin from manifest**
2. 選擇 `C:\Users\<USERNAME>\figma-plugin\manifest.json`
3. 開啟 Plugin，Channel 欄填專案名稱，按 Connect

**本地環境**：
1. Figma Desktop → Plugins → Development → **Import plugin from manifest**
2. 選擇 `src/cursor_mcp_plugin/manifest.json`

### 4. 註冊 MCP（Claude Code）

```bash
claude mcp add -e MCP_CHANNEL=my-project -- talk-to-figma-mcp node /path/to/talk-to-figma-mcp/dist/server.js
```

或在 `.mcp.json`：
```json
{
  "mcpServers": {
    "talk-to-figma-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/talk-to-figma-mcp/dist/server.js"],
      "env": {
        "MCP_CHANNEL": "my-project"
      }
    }
  }
}
```

## MCP 工具一覽（50+）

### 讀取
| 工具 | 說明 |
|------|------|
| `get_document_info` | 文件資訊 |
| `get_selection` / `read_my_design` | 目前選取 |
| `get_node_info` / `get_nodes_info` | 指定節點資訊 |
| `get_local_components` | 本地 Component 清單 |
| `get_styles` | 本地樣式 |
| `get_reactions` | Prototype 互動 |
| `get_annotations` | 註解 |
| `get_instance_overrides` | Component Override |
| `get_plugin_version` | Plugin 版本 |
| `scan_nodes_by_types` | 依類型掃描 |
| `scan_text_nodes` | 掃描文字節點 |

### 建立
| 工具 | 說明 |
|------|------|
| `create_frame` | Frame（含 Auto Layout） |
| `create_rectangle` | 矩形 |
| `create_text` | 文字 |
| `create_component_from_node` | Frame 轉 Component |
| `create_component_instance` | Component Instance |
| `create_connections` | 連接線 |
| `create_variables` | Variable Collection |

### 修改
| 工具 | 說明 |
|------|------|
| `move_node` | 移動 |
| `resize_node` | 縮放 |
| `clone_node` | 複製 |
| `delete_node` / `delete_multiple_nodes` | 刪除 |
| `rename_node` | 重命名 |
| `set_fill_color` | 填色 |
| `set_stroke_color` | 邊框色 |
| `set_corner_radius` | 圓角 |
| `set_text_content` / `set_multiple_text_contents` | 文字內容 |
| `set_layout_mode` | Auto Layout 模式 |
| `set_padding` | 內距 |
| `set_item_spacing` | 間距 |
| `set_axis_align` | 軸對齊 |
| `set_layout_sizing` | 尺寸模式 |
| `set_reactions` | Prototype 互動 |
| `set_annotation` / `set_multiple_annotations` | 註解 |
| `set_instance_overrides` | Component Override |
| `set_default_connector` | 預設連接線 |
| `set_focus` / `set_selections` | 聚焦/選取 |
| `bind_variable_to_fill` | 綁定 Variable 到填色 🔄 |
| `bind_variable_to_stroke` | 綁定 Variable 到邊框 🔄 |

### 匯出
| 工具 | 說明 |
|------|------|
| `export_node_as_image` | PNG/JPG/SVG/PDF |

### 連線
| 工具 | 說明 |
|------|------|
| `join_channel` | 加入通訊頻道 |

## 已知限制

| 功能 | 狀態 | 說明 |
|------|------|------|
| 圖片填充 | ❌ 不支援 | 無法插入圖片，僅能用灰色佔位 |
| 陰影/特效 | ❌ 不支援 | 無 set_effects 工具 |
| 字體選擇 | ❌ 不支援 | create_text 無 fontFamily 參數 |
| 漸層填色 | ❌ 不支援 | 僅支援純色 |
| 頁面管理 | ❌ 不支援 | 無法新增/切換頁面 |
| Pen tool | ❌ 不支援 | 無法畫自定義形狀 |
| Boolean 運算 | ❌ 不支援 | 無 Union/Subtract |

追蹤：[#1 — 擴充 MCP 工具](https://github.com/kctw-dev/talk-to-figma-mcp/issues/1)

## 開發

```bash
# WebSocket Server（開發模式）
bun run src/socket.ts

# MCP Server Build
npm run build        # 單次
npm run build:watch  # 監聽

# 測試
bun test src/socket.test.ts
```

修改 Plugin 後需重新複製到 Figma 讀取的路徑，然後在 Figma 重開 Plugin。

## License

MIT（同 upstream）

## Upstream

- **來源**: [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp)
- **Fork 時版本**: v0.3.4

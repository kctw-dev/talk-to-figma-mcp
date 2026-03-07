# Talk to Figma MCP（KCTW Fork）

Figma MCP 插件的私有 fork，基於 [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp) v0.3.4。

讓 AI Agent（Claude Code）透過 MCP 協議與 Figma 溝通，讀取設計稿並程式化修改。

## 與 Upstream 的差異

### 新增 Command

| Command | 功能 | Figma Plugin API |
|---------|------|-----------------|
| `set_reactions` | 設定 Prototype 互動（ON_CLICK 導航等） | `node.setReactionsAsync()` |
| `create_component_from_node` | Frame 轉 Component | `figma.createComponentFromNode()` |
| `create_variables` | 建立 Variable Collection + 多模式 | `figma.variables.createVariable()` |

### 安全強化

- **ECDSA P-256 Challenge-Response**：WebSocket 連線需通過簽名驗證才能存取
- socket.ts 持有 Public Key（驗證端）
- ui.html + server.ts 持有 Private Key（簽名端）

### 連線簡化

- **自動加入 Channel**：不需手動交換 Channel ID
- **Channel 可設定**：server.ts 用 `MCP_CHANNEL` 環境變數，ui.html 用 UI 輸入欄位
- 支援多專案同時使用（每個專案設不同 channel 名稱）

## 架構

```
NB (Figma Plugin)  ←SSH Tunnel + ECDSA auth→  GCE (socket.ts)  ←→  MCP Server (server.ts)  ←→  Claude Code
     ui.html                                    port 3055              dist/server.js
     code.js
```

## 安裝與使用

### 前置需求

- [Bun](https://bun.sh/)（WebSocket server 用）
- [Node.js](https://nodejs.org/)（MCP server 用）
- Figma Desktop App

### 1. WebSocket Server（GCE 端）

```bash
git clone git@github.com:KCTW/talk-to-figma-mcp.git
cd talk-to-figma-mcp
bun install
bun run src/socket.ts
```

### 2. MCP Server（Claude Code 端）

在專案的 `.mcp.json` 設定：

```json
{
  "mcpServers": {
    "talk-to-figma": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/talk-to-figma-mcp/dist/server.js"],
      "env": {
        "PATH": "/home/user/.bun/bin:/usr/local/bin:/usr/bin:/bin",
        "MCP_CHANNEL": "my-project"
      }
    }
  }
}
```

Build MCP server：

```bash
npm install
npx tsup
```

### 3. Figma Plugin（NB 端）

1. Clone 此 repo 到本機
2. Figma Desktop → Plugins → Development → **Import plugin from manifest**
3. 選擇 `src/cursor_mcp_plugin/manifest.json`
4. 開啟 plugin，Channel 欄填專案名稱，按 Connect

### 4. SSH Tunnel

確保 NB 到 GCE 的 port 3055 有轉發：

```bash
ssh -L 3055:localhost:3055 user@gce-instance
```

## MCP Tools 清單

### 文件與選取
- `get_document_info` — 取得 Figma 文件資訊
- `get_selection` — 取得目前選取
- `read_my_design` — 取得選取的詳細節點資訊
- `get_node_info` / `get_nodes_info` — 取得指定節點資訊
- `set_focus` — 聚焦到指定節點
- `set_selections` — 選取多個節點

### 建立元素
- `create_rectangle` — 建立矩形
- `create_frame` — 建立 Frame
- `create_text` — 建立文字

### 修改元素
- `move_node` — 移動節點
- `resize_node` — 調整大小
- `delete_node` / `delete_multiple_nodes` — 刪除節點
- `clone_node` — 複製節點

### 樣式
- `set_fill_color` — 設定填充色
- `set_stroke_color` — 設定邊框色
- `set_corner_radius` — 設定圓角

### Auto Layout
- `set_layout_mode` — 設定佈局模式
- `set_padding` — 設定內距
- `set_axis_align` — 設定軸對齊
- `set_layout_sizing` — 設定尺寸模式
- `set_item_spacing` — 設定間距

### 文字操作
- `scan_text_nodes` — 掃描文字節點
- `set_text_content` — 設定文字內容
- `set_multiple_text_contents` — 批次更新文字

### Component 與樣式
- `get_styles` — 取得本地樣式
- `get_local_components` — 取得本地 Component
- `create_component_instance` — 建立 Component 實例
- `get_instance_overrides` / `set_instance_overrides` — Component Override

### 註解
- `get_annotations` / `set_annotation` / `set_multiple_annotations` — 註解管理
- `scan_nodes_by_types` — 依類型掃描節點

### Prototype（Fork 新增）
- `set_reactions` — 設定 Prototype 互動反應
- `create_component_from_node` — Frame 轉 Component
- `create_variables` — 建立 Design Variables

### 匯出
- `export_node_as_image` — 匯出節點為圖片

### 連線管理
- `join_channel` — 加入通訊頻道

## 未來改進方案

**傳輸層**（取代 SSH tunnel）：
- Cloudflare Tunnel：免費 zero-trust 方案
- WireGuard/VPN：適合固定團隊
- mTLS：最安全但管理複雜

**應用層**：
- Per-user Keypair 生成
- Private Key 存 `figma.clientStorage`
- Public Key 註冊機制
- Key Rotation 機制

## License

MIT（同 upstream）

## Upstream

- **來源**: [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp)
- **Fork 時版本**: v0.3.4

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
| `bind_variable_to_fill` | 綁定 Variable 到填色 | ✅ |
| `bind_variable_to_stroke` | 綁定 Variable 到邊框色 | ✅ |
| `set_image_fill` | 圖片填充（URL → image fill） | ✅ |
| `set_effects` | 陰影/模糊特效 | ✅ |
| `set_font` | 字體選擇 + 大小 | ✅ |
| `set_gradient_fill` | 漸層填色 | ✅ |
| `create_page` / `switch_page` / `get_pages` | 頁面管理 | ✅ |

### 批次指令（2026-07 新增）

實際重建一個約 350 節點的頁面時撞到的瓶頸：**不在 Figma，在來回次數**。
Plugin sandbox 裡同步建 300 個節點很平常，慢的是 MCP → WebSocket → plugin
每個指令一次來回。Upstream 也沒解這件事（只有 `set_multiple_text_contents` 是批次的）。

| 工具 | 功能 | 效益 |
|------|------|------|
| `create_tree` | 一份巢狀 JSON 建整棵子樹 | 四張優惠券 28 次 → **1 次** |
| `set_props_batch` | 一次改多節點的 fill / stroke / effects / layoutMode / 對齊 / 尺寸 / 間距 / 字型 | 50 個邊框 50 次 → **2 次** |
| `bind_variables_batch` | 一次綁多個 variable | 60 次 → **2 次** |
| `get_node_tree` | 精簡結構讀取（id/name/type/尺寸）| `get_node_info` 在忙的頁面會吐 900KB |
| `find_components` | 用名字搜元件 | 取代「撈整頁 330KB 再 grep」 |
| `reparent_node` | 真的換父層 | `move_node` 只改座標，在 auto-layout 裡無效 |
| `combine_as_variants` | 把多個 COMPONENT 合成變體集 | — |
| `swap_instance` | 換掉 instance 背後的主元件（巢狀 instance 也吃）| 27 張卡各自換圖示，不用 detach |
| `create_svg` | 用 SVG 原始碼建真的向量 | plugin API 沒有畫路徑的方法，設計系統缺圖示時唯一的補法 |

`create_tree` 的 spec 支援 `fillVariable`（建立當下就綁 variable）、
`bindings: [{field, variableName}]`、`componentId`(INSTANCE)、`stroke`、`effects`，
以及 `{type: "SVG", svg: "<svg…>"}` 直接放向量。

`set_props_batch` 除了排版屬性，另外吃 `swapComponentId`（等同 `swap_instance`）、
`clipsContent`、`visible`、`layoutPositioning`、`constraints`、`x` / `y`——
這些刻意掛在既有指令底下，改 plugin 後**只要重跑 plugin，不用重啟 Claude Code**。

### Variables 讀寫

| 工具 | 功能 |
|------|------|
| `get_local_variables` | 讀本地 collection 的 modes 與每個 mode 的值，標成 `ALIAS`（附 `aliasOf`）/ `RAW` / `UNSET`，並附各 mode 的 alias/raw 統計 |
| `bind_variable_to_property` | 綁非顏色屬性（cornerRadius / itemSpacing / padding* / fontSize…）|

Upstream 對 variables 只有寫入（`create_variables`、`bind_variable_to_*`），
沒有讀取窗口——但 `figma.variables` 全套 API 在 plugin sandbox 裡本來就有。

**同時修掉**：`filterFigmaNode` 原本會 `delete boundVariables`（fill/stroke/gradient stop
三處），且節點層級的 `boundVariables` 從未被複製，導致 `get_node_info` 看不出某個值
是綁定 token 還是寫死的。已改為保留。

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

## MCP 工具一覽（60+）

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
| `get_node_tree` | 精簡結構讀取（id/name/type/尺寸，可設 maxDepth）|
| `find_components` | 依名稱搜尋全檔元件 |
| `get_local_variables` | 讀本地 variables（modes / 每 mode 值 / ALIAS 或 RAW）|

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
| `create_tree` | **一份巢狀 JSON 建整棵子樹**（批次）|
| `combine_as_variants` | 多個 COMPONENT 合成變體集 |
| `create_svg` | **用 SVG 原始碼建真向量**（唯一能畫路徑的方法）|

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
| `bind_variable_to_fill` | 綁定 Variable 到填色 |
| `bind_variable_to_stroke` | 綁定 Variable 到邊框 |
| `set_image_fill` | 圖片填充（URL → image fill） |
| `set_effects` | 陰影/模糊特效（DROP_SHADOW 等） |
| `set_font` | 字體選擇 + 大小（fontFamily/fontStyle/fontSize） |
| `set_gradient_fill` | 漸層填色（LINEAR/RADIAL/ANGULAR/DIAMOND） |
| `set_props_batch` | **一次改多節點多屬性**（批次）|
| `bind_variables_batch` | **一次綁多個 variable**（批次）|
| `bind_variable_to_property` | 綁 variable 到非顏色屬性（圓角/間距/字級…）|
| `reparent_node` | 換父層（`move_node` 只改座標）|
| `swap_instance` | **換 instance 的主元件**（巢狀 instance 也吃，不用 detach）|

### 頁面管理
| 工具 | 說明 |
|------|------|
| `create_page` | 新增頁面 |
| `switch_page` | 切換頁面（by ID 或 name） |
| `get_pages` | 取得所有頁面清單 |

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
| Pen tool | ⚠️ 用 SVG 代替 | 沒有畫路徑的 API，改用 `create_svg` 餵 SVG 原始碼 |
| Boolean 運算 | ❌ 不支援 | 無 Union/Subtract |
| Mask | ❌ 不支援 | 無法建遮罩 |
| Grid/Guide | ❌ 不支援 | 無法設定網格線 |
| 匯入 SVG 檔案 | ✅ 已支援 | `create_svg` / `create_tree` 的 `type: "SVG"`（`figma.createNodeFromSvg`）|

### Figma Plugin Sandbox 的坑（實作時務必知道）

| 現象 | 原因 / 解法 |
|------|------|
| `create_tree` 建出空的預設 frame | spec 可能以字串送達，需先 `JSON.parse`（v1.4.1 已修）|
| `layoutSizingHorizontal: FILL` 建立時失敗 | 必須先 `appendChild` 到父層再設 |
| `layoutWrap: WRAP` 設了沒作用 | 這個 plugin 上無效，要多欄請自己建 row frame |
| 頁面層級 frame 設 HUG 沒反應 | HUG 只對 auto-layout 的子層有效；根 frame 需 `layoutSizingVertical: HUG` 且本身有 auto-layout |
| 設 `layoutMode` 後 frame 縮掉 | 會變成 hug，需一併設 `layoutSizing*: FIXED` + width/height |
| `move_node` 移不出 auto-layout | 座標被排版接管，請用 `reparent_node` |
| `set_image_fill` 回 `Failed to fetch` | 來源站沒有 CORS 標頭。起一個帶 `Access-Control-Allow-Origin: *` 的本機靜態伺服器餵圖即可（`figma.createImage()` 會把位元組**內嵌進檔案**，貼完就能關）|
| `code.js` 語法錯誤 | 跑在 sandbox，不支援 arrow function / ternary spread |
| 改完沒生效 | 每次改都 bump `PLUGIN_VERSION`，用 `get_plugin_version` 確認跑的是新 code |
| `get_node_info` 看不到元件屬性（`componentProperties` / `componentPropertyDefinitions`）| 🔴 它不是讀即時節點，是 `exportAsync({format:"JSON_REST_V1"})` 之後再過濾，**REST 匯出格式根本不帶這些欄位**。要讀屬性得用 `figma.getNodeByIdAsync` 拿到的活節點（`get_instance_info` 已改成這樣）|
| `swap_instance` 之後尺寸忽大忽小 | 換主元件**不會清掉 instance 既有的尺寸覆寫**。原本有覆寫的維持舊尺寸、沒覆寫的吃新元件原生尺寸，同一排就會交替。swap 後要**逐一重設寬高**，不能只檢查內容 |
| `swap_instance` 之後文字全變回預設 | 換到結構不同的元件，**文字覆寫對應不上就會整批丟失**。換完要重填內容 |
| 查變體查不到屬性定義 | `componentPropertyDefinitions` 掛在 **COMPONENT_SET** 上，不在個別變體 COMPONENT 上。要往 `main.parent` 取 |
| 用元件名搜不到東西就以為沒有 | 變體成員的名字是 `屬性=值, 屬性=值`，**不含元件集的名字**。用中文名搜一定漏，要改用屬性結構掃或直接列整個 page |
| spec 只給 `width` 沒給 `height`，尺寸整個沒套用 | `resize()` 兩軸都要；缺的那軸現在會用節點現值補上（v1.11.0 已修）|
| 沒給尺寸的 frame 變成 100×100 撐出空白 | Figma 建 frame 的預設值。auto-layout 裡請設 `layoutSizing*: HUG` |
| `create_tree` 的 `x`/`y` 沒作用，新元件全疊在 (0,0) 壓到版面 | 只在非 auto-layout 父層才有意義，v1.11.0 起會套用 |
| `overlayPositionType` 設不了（`no setter for property`）| Figma API 唯讀。抽屜這種要貼齊邊緣的，改做成獨立畫面 + `NAVIGATE`，不要用 OVERLAY |
| `set_reactions` 寫進去但 `action` 是空的 | 舊版只吃 `actions` 陣列；現在 `action`（單數）也收，並帶 `overlayRelativePosition` |
| reaction 的 `MOVE_IN` / `SLIDE_IN` 被 Figma 打回 | 這兩種 transition 必須同時給 `direction` 與 `matchLayers` |

> 動到 `code.js` → Figma 重跑 plugin 即可；動到 `server.ts` → 還要重啟 Claude Code。

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

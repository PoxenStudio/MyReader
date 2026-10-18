# MyReader 阅读页接入 MyBooks AI 伴读（MyNexus）集成方案

状态：**已评审确认，待实施**

本文定义在 MyReader 阅读页接入 MyBooks「AI 伴读」功能的完整方案。AI 伴读由 MyBooks 集成的 MyNexus 提供（对书籍做 AI 分析并支持按用户隔离的会话）。MyBooks 侧的后端接口已实现，MyReader 侧仅需消费这些接口并新增阅读页 UI。

## 1. 需求确认

| 项目 | 结论 |
|---|---|
| 入口 | 阅读页右上角新增一个 `mdi-forum-outline` 图标按钮 |
| 生效范围 | 仅在**桌面端**（macOS/Windows/Linux 的 Tauri 桌面应用）与 **Embedded**（内嵌阅读器部署）有效；移动端（iOS/Android）与普通外部 Web 部署不显示 |
| 显示条件 | `sys.mynexus_enabled === true` 且当前书籍 `ai_companion_available === true` |
| 交互 | 点击后在阅读窗口**右侧展开**会话窗口（对话框/面板） |
| 会话内容 | 保持 MyNexus 的八芒星 logo（✴）；无历史消息时先自动发送一条开场消息 |
| 实现边界 | 全部数据/会话均经 MyBooks 完成；MyReader 只调用 MyBooks 同源接口，不直接连接 MyNexus |
| 交付顺序 | 先产出本方案文档，评审通过后再分阶段实施，每个阶段停下等待确认与提交 |

## 2. 现状调研

### 2.1 MyBooks 侧（已实现，无需改动后端）

MyNexus 集成已在 MyBooks 落地，相关路由见 [mynexus.py](file:///Volumes/data/projects/reader/mybooks/webserver/handlers/mynexus.py#L433-L440)：

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/book/<id>` | 可选登录 | 返回书籍对象，含 `ai_companion_available`（bool，需登录且分析 `completed`）、`ai_reading_guide`（string） |
| GET | `/api/book/<id>/mynexus/availability` | 需登录 | 返回 `{ available: bool, reading_guide: string }`，按需向 MyNexus 同步最新状态 |
| GET | `/api/book/<id>/mynexus/session` | 需登录 | 返回 `{ err: 'ok', session_id, messages: [{role, content}] }`；无会话时 `session_id: null, messages: []`；分析未完成返回 `err: 'not_found'` |
| POST | `/api/book/<id>/mynexus/chat` | 需登录 | `text/event-stream`（SSE）流式回答；请求体 `{ messages }`（最后一条必须为 `user`） |

`ai_companion_available` 的计算见 [book.py](file:///Volumes/data/projects/reader/mybooks/webserver/handlers/book.py#L294-L305)。`sys.mynexus_enabled` 来自 `/api/user/info` 的 `sys`，对应配置 `MYNEXUS_ENABLE`，文档见 [MyBooks_WebAPI.md](file:///Volumes/data/projects/poxenstudio/myreader/document/MyBooks_WebAPI.md#L257)。

SSE 帧格式（OpenAI 兼容）已由 MyBooks 前端 [MyNexusChatDialog.vue](file:///Volumes/data/projects/reader/mybooks/app/src/components/MyNexusChatDialog.vue#L125-L144) 解析确认：

```
data: {"choices":[{"delta":{"content":"..."}}],"citations":[{...}]}\n\n
data: [DONE]\n\n
data: {"error":"<message>"}\n\n   # 仅错误时
```

- 帧以 `\n\n` 分隔，取以 `data:` 开头的行拼接
- 正文增量：`event.choices[0].delta.content`
- 引用：`event.citations`（`[{ content }]`，可选）
- 终止：`[DONE]`
- 错误：`event.error`

### 2.2 MyReader 侧

- 请求基础设施已存在：[fetchMyBooks](file:///Volumes/data/projects/poxenstudio/myreader/app/src/services/mybooksService.ts#L261-L413) 统一处理 host 解析（Tauri 直连 / Web 代理 / 同源）与 Cookie；但**只支持 JSON**（`response.json()`），不能读 SSE。
- 系统信息已缓存：`useMyBooksStatusStore.sysInfo`（[mybooksStatusStore.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/store/mybooksStatusStore.ts)）。`MyBooksSysInfo` 尚未含 `mynexus_enabled` 字段。
- 书籍对象 `Book` 已有 `bookId?: number`（[book.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/types/book.ts#L87-L144)），`MyBooksBook` 接口尚未含 `ai_companion_available`。
- 右侧面板已有成熟实现：`Notebook`（[Notebook.tsx](file:///Volumes/data/projects/poxenstudio/myreader/app/src/app/reader/components/notebook/Notebook.tsx)）——支持 pinned（`relative`，挤压阅读区）/ 非 pinned（`absolute` 覆盖）、宽度拖拽（`usePanelResize`）、移动端全屏与下滑关闭。右侧会话窗口可复用该容器模式。
- 表头工具栏：[HeaderBar.tsx](file:///Volumes/data/projects/poxenstudio/myreader/app/src/app/reader/components/HeaderBar.tsx#L284-L323) 的 `header-tools-end` 是右上角图标（主题、设置、笔记本、视图菜单、窗口按钮）的落点，新增图标插在此处。
- Markdown 渲染已有依赖 `marked`（[utils/md.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/utils/md.ts)）与清洗工具 `sanitize`（[utils/sanitize.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/utils/sanitize.ts)）；另有一个基于 `@assistant-ui/react-markdown` 的 [MarkdownText.tsx](file:///Volumes/data/projects/poxenstudio/myreader/app/src/components/assistant/MarkdownText.tsx)，但它依赖 assistant-ui 运行时，不适用于本对话框。
- 平台判定：`appService?.isDesktopApp`（macOS/Windows/Linux，[nativeAppService.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/services/nativeAppService.ts#L555)）表示桌面；Embedded 由 [embedReturn.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/utils/embedReturn.ts#L32-L35) 的 `hasEmbedReturnUrl(bookHash)` 判定（与 [embedClientLog.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/services/mybooks/clientLog.ts) 同源用法）。
- i18n 采用「key-as-content」：英文原文即 key，其他语言在 `app/public/locales/{en,zh-CN,zh-TW}/translation.json`。

## 3. 总体方案

MyReader 阅读页新增一个「AI 伴读」入口，复用 `Notebook` 的右侧停靠面板容器，在其中渲染一个独立的 MyNexus 会话视图。所有请求经 `mybooksService` 走 MyBooks 同源接口（Tauri 直连 `mybooks_host`；Embedded 同源），MyReader 不接触 MyNexus Token 与远端会话 ID。

```text
阅读页右上角图标（mdi-forum-outline）
  └─ MyNexusToggler ──► 打开右侧面板（Notebook 容器的 companion 视图）
                          │
                          ├─ GET  /api/book/<id>/mynexus/session     ← 历史消息
                          ├─ POST /api/book/<id>/mynexus/chat (SSE)  ← 流式回答
                          └─ GET  /api/book/<id>/mynexus/availability← 判定入口可见性
                                  （均经 mybooksService 走 MyBooks 同源 API）
```

可见性判定，按序短路：

1. 平台：`appService?.isDesktopApp === true` 或 `hasEmbedReturnUrl(bookHash) === true`
2. 站点：`useMyBooksStatusStore.sysInfo?.mynexus_enabled === true`
3. 书籍：**仅当第 2 步为 true 时**才探测当前书籍的能力，要求有 `bookId` 且 `ai_companion_available === true`

即：`mynexus_enabled` 为 false 时**不发起** `ai_companion_available` 探测请求（避免无谓网络开销）。

## 4. 接口契约（补充说明）

MyBooks 后端接口已存在，无需改动。但 [MyBooks_WebAPI.md](file:///Volumes/data/projects/poxenstudio/myreader/document/MyBooks_WebAPI.md) 目前只记录了 `sys.mynexus_enabled`，**未记录**以下三项，需在实施阶段补入该文档（属"接口有欠缺时补充"范围，仅文档，不改后端）：

1. §1.5 `sys` 增补：已在文档中，核对无误即可。
2. §3.9「获取图书详情」增补字段：`book.ai_companion_available`（bool）、`book.ai_reading_guide`（string）。
3. 新增子节：`3.x MyNexus AI 伴读`，记录 `/mynexus/availability`、`/mynexus/session`、`/mynexus/chat` 三个接口的路径、认证、参数、响应与 SSE 帧格式（第 2.1 节表格与帧格式）。

## 5. MyReader 端设计

### 5.1 服务层（`src/services/mybooksService.ts`）

1. `MyBooksSysInfo` 增补 `mynexus_enabled?: boolean`；`MyBooksBook` 增补 `ai_companion_available?: boolean`、`ai_reading_guide?: string`。
2. 新增类型 `MyNexusChatMessage = { role: 'user' | 'assistant'; content: string; citations?: { content: string }[] }`。
3. 新增 `getMyNexusAvailability(bookId): Promise<{ available: boolean; readingGuide: string }>`，调用 `/book/<id>/mynexus/availability`。
4. 新增 `getMyNexusSession(bookId): Promise<{ sessionId: string | null; messages: MyNexusChatMessage[] }>`，调用 `/book/<id>/mynexus/session`。
5. 新增 **流式** 请求函数 `fetchMyBooksStream(endpoint, { method, body, signal })`：复用 `fetchMyBooks` 的 host 解析与 Cookie 逻辑（Tauri 直连 / 同源 / Web 代理），但不做 `json()` 与重试，直接返回原始 `Response` 供上层按 SSE 读取。若响应状态非 2xx，按 JSON 解析 `{err,msg}` 并抛出 `MyBooksApiError`。
6. 新增 `streamMyNexusChat(bookId, messages, onDelta, onCitations, signal)`：用 `fetchMyBooksStream` 发起 `/book/<id>/mynexus/chat`，按 2.1 的 SSE 规则解析，逐帧回调正文增量与引用，遇到 `error` 抛错，`[DONE]` 结束。按用户要求输出调试日志（连接、首帧、错误、结束）。

### 5.2 状态（新增 `src/store/myNexusStore.ts`）

- `availability: Record<number, { available: boolean; fetchedAt: number }>`（按 bookId 缓存；`reading_guide` 不展示，故不缓存）
- `loadAvailability(bookId)`：带节流的加载/刷新，**仅在 `sys.mynexus_enabled` 为 true 时调用**；失败静默（可见性判定失败即视为不可用，不打扰用户）
- 面板可见态与宽度可复用 `Notebook` 容器状态（见 5.4），本 store 只负责「能力探测」缓存

> `sys.mynexus_enabled` 直接读 `useMyBooksStatusStore`；若 `sysInfo` 为空（阅读页冷启动未拉过 `/user/info`），由 `MyNexusToggler` 触发一次 `getUserInfo()` 补齐；补齐后仍为 false 则不继续探测书籍能力。

### 5.3 表头入口（`src/app/reader/components/MyNexusToggler.tsx`）

- 新增组件 `MyNexusToggler`（参考 [NotebookToggler.tsx](file:///Volumes/data/projects/poxenstudio/myreader/app/src/app/reader/components/NotebookToggler.tsx)），图标用 `mdi-forum-outline`（`react-icons/md` 的 `MdOutlineForum`）。
- 在 [HeaderBar.tsx](file:///Volumes/data/projects/poxenstudio/myreader/app/src/app/reader/components/HeaderBar.tsx#L284-L287) 的 `header-tools-end` 中、`NotebookToggler` 之后插入该组件。
- 组件内完成可见性判定（第 3 节三条）；不满足时 `return null`。
- 点击行为：打开 `Notebook` 容器并切到 `companion` 视图（见 5.4）。

### 5.4 右侧会话面板

复用 `Notebook` 容器以获得与现有面板一致的停靠/宽度/移动端行为：

1. `NotebookTab`（[notebookStore.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/store/notebookStore.ts)）扩展为 `'notes' | 'ai' | 'companion'`；`NotebookTabNavigation` 仅当 AI 伴读可用时才追加 `companion` 页签（图标用八芒星 `✴` 文本或 `MdOutlineForum`）。
2. [Notebook.tsx](file:///Volumes/data/projects/poxenstudio/myreader/app/src/app/reader/components/notebook/Notebook.tsx#L467-L471) 内容区新增分支：`notebookActiveTab === 'companion'` 时渲染 `<MyNexusChatPanel bookKey={sideBarBookKey} />`。
3. `MyNexusToggler` 点击等价于：`setSideBarBookKey(bookKey)` + 设置 `notebookActiveTab='companion'` + `setNotebookVisible(true)`（与 `NotebookToggler` 的切换逻辑对齐）。
4. 面板布局沿用 `Notebook` 容器：**本次固定使用非 pinned 的覆盖模式**（`absolute` 覆盖在阅读区右侧，不挤压阅读宽度）；不改变 `Notebook` 现有 pinned 设置与行为。

> 备选方案（不推荐）：新增一个与 `Notebook` 独立的右侧面板。缺点是要重复容器、拖拽、移动端逻辑，且可能出现左右两个面板同时展开。复用容器更简单且不易破坏现有笔记本功能。

### 5.5 会话视图（`src/app/reader/components/mynexus/MyNexusChatPanel.tsx`）

结构对齐 [MyNexusChatDialog.vue](file:///Volumes/data/projects/reader/mybooks/app/src/components/MyNexusChatDialog.vue)：

- **头部**：MyNexus 八芒星 logo `✴` + 标题「AI 伴读」（i18n）。
- **消息列表**：用户消息右对齐气泡；助手消息左对齐，标签为 `✴`，正文用 Markdown 渲染；加载中的空助手消息显示三点跳动动画。
- **引用**：每条助手消息的 `citations` 以可展开项展示（`引用 N` + 原文片段）。
- **输入区**：多行输入框（`Enter` 发送）+ 发送按钮（发送中禁用/loading）。
- **空态**：无消息且非加载时显示「提出一个问题，开始与这本书对话」。

交互逻辑：

1. 面板首次打开（`bookKey` 变化或首次可见）调用 `getMyNexusSession(bookId)`：
   - 用返回的 `messages` 填充列表；
   - **若无历史消息且有书名**，自动先发一条开场消息：`现在我们开始伴读《${book.title}》这本书`（与 MyBooks 端一致的既有逻辑）。
2. 发送：把 `messages.slice(0, -1)`（不含刚 push 的空助手占位）作为请求体，调用 `streamMyNexusChat`；增量追加到助手气泡，引用到达时更新；失败时回滚这对消息并显示错误行（可重试）。
3. 关闭面板不删除远端会话；再次打开恢复历史。
4. 每次渲染输出连接/首帧/错误/结束等调试日志。

### 5.6 Markdown 渲染

- 新增一个轻量渲染组件（例如 `src/app/reader/components/mynexus/MyNexusMarkdown.tsx`），使用 `marked`（`breaks: true, gfm: true`）+ 现有 `sanitize` 清洗后以 `dangerouslySetInnerHTML` 输出，样式参考 MyNexus 定义（标题/段落/列表/代码块）。
- 不引入 `@assistant-ui/react-markdown`（其依赖 assistant 运行时）。

### 5.7 i18n

新增 key（英文为原文，写入 `app/public/locales/{zh-CN,zh-TW}/translation.json`）：

| key（英文） | 中文示例 |
|---|---|
| `AI Companion` | AI 伴读 |
| `Ask a question about this book` | 输入你对这本书的问题 |
| `Ask a question to start the conversation` | 提出问题，开始与这本书对话 |
| `AI Companion request failed, please try again later` | AI 伴读请求失败，请稍后重试 |
| `Citation` | 引用 |
| `You` | 我 |

## 6. 边界与错误处理

| 场景 | 行为 |
|---|---|
| 平台不符（移动/外部 Web） | 不显示入口（`MyNexusToggler` 返回 null） |
| `sys.mynexus_enabled` 为 false 或 `ai_companion_available` 为 false | 不显示入口 |
| 能力探测请求失败 | 视为不可用，静默；不弹错误 |
| session 接口返回 `not_found`（分析未完成） | 面板显示不可用提示，不进入会话 |
| chat SSE 中途断开/返回 `{error}` | 回滚本轮消息并显示可重试的错误行；不伪装成功 |
| 未登录 / 会话过期 | 复用 `MyBooksApiError`，提示需登录 |
| 桌面端 `tauriFetch` 流式能力 | **已验证支持**，SSE 可直接使用（见第 6.1 节），无需降级或改用 WebSocket |

### 6.1 桌面端流式与 WebSocket 备选（结论）

- **桌面端流式可用**：`@tauri-apps/plugin-http` 的 `fetch` 支持增量读取响应体。插件命令 `fetch_read_body` 逐个网络 chunk 读取并单独回传（[commands.rs](file:///Volumes/data/projects/poxenstudio/myreader/packages/tauri-plugins/plugins/http/src/commands.rs#L435) 的 `res.chunk().await`），`allow-fetch-read-body` / `allow-fetch-cancel-body` 已默认授权（`permissions/default.toml:21-22`）。MyReader 现有 [webDownload](file:///Volumes/data/projects/poxenstudio/myreader/app/src/utils/transfer.ts#L120-L158) 就是用 `tauriFetch` + `response.body.getReader()` 做逐块进度上报。因此 **SSE 在桌面端可用，不需要一次性返回**。
- **复用 MyBooks AI 助手 WS 不适合**：`/api/assistant/ws`（[assistant.py](file:///Volumes/data/projects/reader/mybooks/webserver/handlers/assistant.py)）是 MyBooks 自带 AI 助手（`AIAssistantMCPAgent`）的单轮通道，协议为 `{type: status/start/chunk/end/error}`，与 MyNexus 会话（按用户+书籍的会话、OpenAI 兼容 SSE 帧）是两套不同功能，语义与协议都不匹配。
- **新建 WS 通道可行但首期不做**：MyReader 已在桌面端用 `@tauri-apps/plugin-websocket` 连接 MyBooks 的 `/api/sync/events`（[syncEvents.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/services/mybooks/syncEvents.ts#L114-L117)），照此新增一个包装 MyNexus SSE 的 WS 端点在技术上可行。但既然桌面端 SSE 已验证可用，首期直接使用 SSE，避免为 MyBooks 服务端新增 WS 端点与客户端重连逻辑。若将来确有双向中断/多路复用需求，再单列 WS 方案。

## 7. 实施步骤（分阶段，逐阶段等待确认与提交）

> 遵循项目约定：不新增多余注释（必要时 ≤2 行）、代码中补充调试日志、不引用 docs 文档路径、由用户手动提交。

**阶段一：服务层与能力探测**
1. `mybooksService.ts` 增补类型与 `getMyNexusAvailability` / `getMyNexusSession` / `fetchMyBooksStream` / `streamMyNexusChat`。
2. 新增 `myNexusStore.ts` 与可用性加载。
3. 单元测试：SSE 解析、host 解析分支、availability/session 调用。
4. **停下确认，由用户提交。**

**阶段二：右侧会话面板**
1. `NotebookTab` 扩展 `companion`；`Notebook.tsx` 接入 `MyNexusChatPanel`。
2. 新增 `MyNexusChatPanel.tsx`、`MyNexusMarkdown.tsx`。
3. 打开即加载历史、无消息自动首发开场消息、流式渲染、引用与错误处理。
4. **停下确认，由用户提交。**

**阶段三：表头入口与可见性**
1. 新增 `MyNexusToggler.tsx` 并接入 `HeaderBar.tsx`。
2. 完成平台/站点/书籍三重可见性判定与 `sysInfo` 补齐。
3. i18n key 落地。
4. **停下确认，由用户提交。**

**阶段四：文档与验收**
1. 补充 [MyBooks_WebAPI.md](file:///Volumes/data/projects/poxenstudio/myreader/document/MyBooks_WebAPI.md)：图书详情新字段 + MyNexus 三接口。
2. 端到端验收（见第 8 节）。

## 8. 验收清单

- [ ] 桌面端：`mynexus_enabled` 且书籍 `ai_companion_available` 为 true 时，右上角出现 `mdi-forum-outline` 图标；点击右侧展开会话窗口
- [ ] Embedded：同上（书籍经内嵌入口打开）
- [ ] 移动端 / 外部 Web：不出现该图标
- [ ] 无历史消息时自动发送开场消息 `现在我们开始伴读《<书名>》这本书`
- [ ] 助手消息显示八芒星 `✴`，正文 Markdown 正确渲染
- [ ] 流式回答逐段显示，引用可展开
- [ ] 关闭再打开恢复该用户该书的会话历史
- [ ] 服务/网络错误有明确提示且可重试，不伪装成功
- [ ] 相关单元测试通过；`pnpm lint` 通过

## 9. 代码落点索引

### MyReader（本次改动）

- `app/src/services/mybooksService.ts` — 类型与 MyNexus 会话/流式接口
- `app/src/store/myNexusStore.ts` — 新增，可用性缓存
- `app/src/store/notebookStore.ts` — `NotebookTab` 扩展 `companion`
- `app/src/app/reader/components/MyNexusToggler.tsx` — 新增，表头入口
- `app/src/app/reader/components/HeaderBar.tsx` — 挂接入口
- `app/src/app/reader/components/notebook/Notebook.tsx`、`NotebookTabNavigation.tsx` — 接入 companion 视图
- `app/src/app/reader/components/mynexus/MyNexusChatPanel.tsx`、`MyNexusMarkdown.tsx` — 新增
- `app/src/app/reader/components/mynexus/MyNexusMindmap.tsx` — 新增（思维导图渲染，见第 11 节）
- `app/public/locales/{zh-CN,zh-TW}/translation.json` — i18n
- `document/MyBooks_WebAPI.md` — 接口文档补充

### MyBooks（仅参考，不改动）

- `webserver/handlers/mynexus.py`、`webserver/services/mynexus_service.py`、`webserver/handlers/book.py`
- `app/src/components/MyNexusChatDialog.vue`、`MyNexusMarkdown.vue`、`app/src/pages/book/_bookid.vue`

## 10. 待确认项

1. ~~**面板形态**~~ **已确认**：复用 `Notebook` 容器，作为新页签 `companion`。
2. ~~**默认停靠模式**~~ **已确认**：固定覆盖模式（`absolute`），不挤压阅读区。
3. ~~**桌面端流式能力**~~ **已确认**：`tauriFetch` 支持增量流式读取（第 6.1 节），采用 SSE 流式，不做一次性返回、不引入 WebSocket。
4. ~~**能力探测时机**~~ **已确认**：`mynexus_enabled` 为 true 时才探测 `ai_companion_available`；为 false 时不发起任何 MyNexus 相关请求。
5. ~~**是否需要“引用书目/阅读指南”展示**~~ **已确认**：不展示 `ai_reading_guide`。

全部待确认项已闭环，方案定稿，进入实施。

## 11. 思维导图（Mind Map）显示支持（新增需求）

**背景**：MyNexus 在回答过程中可调用 `generate_mindmap` 工具生成思维导图，官方前端已实现「会话内嵌小图 + 放大独立窗口查看 + 下载」。本节定义 MyReader 侧的等价方案，结论是**可以支持，且 MyBooks 侧无需任何改动**。

### 11.1 上游数据链路（已核实）

| 环节 | 位置 | 产出 |
|---|---|---|
| 工具生成 | MyNexus worker `pipelines/qa.py`（`tool_name == 'generate_mindmap'` 分支） | 事件 `{"type":"tool_result","tool_name":"generate_mindmap","result":{...}}`，随后继续流式输出伴读正文 |
| 工具返回值 | MyNexus worker `tools/mindmap.py`（run 返回处） | `{ title, markdown, stats: { node_count } }` |
| 转 SSE 帧 | MyNexus core-api `internal/api/handler/chat_handler.go` | 帧内新增字段 `tool_result: { tool_name, result_json }`，**`result_json` 是 JSON 字符串**（非对象） |
| 落库 | 同上（`AppendMessage` 调用处） | 仅写入 `answer` 与 `citations`，**`tool_result` 不落库** |
| 转发 | MyBooks `webserver/handlers/mynexus.py` | 上游 chunk **原样 `self.write(chunk)` 透传**，无需改动 |

SSE 帧形态（`data:` 行内 JSON）：

```json
{"choices":[{"delta":{"content":"..."}}],"citations":[],"tool_result":{"tool_name":"generate_mindmap","result_json":"{\"title\":\"章节脉络\",\"markdown\":\"# 主题\\n## 分支\\n- 叶子\",\"stats\":{\"node_count\":12}}"}}
```

`result_json` 解析后：`title`（图标题，用于下载文件名）、`markdown`（思维导图的大纲文本，markmap 直接吃 markdown 层级）、`stats.node_count`（节点数）。

### 11.2 三条关键结论

1. **MyBooks 零改动**：`/mynexus/chat` 原样透传上游 chunk，`tool_result` 帧会自然到达 MyReader；`/mynexus/session` 也原样返回 `messages`，无需新增透传逻辑。
2. **思维导图只在产生它的当轮流式响应中可见**：因上游不落库 `tool_result`，重开会话后 `getSession` 拿不到它——这与 MyNexus 官方前端行为**完全一致**（其 `ChatView.vue` 也只在流式回调里设置 `message.mindmap`）。若要历史可回溯，须改上游落库（超出本次范围，见 11.6 Q1）。
3. **渲染本质是 markdown**：`markdown` 字段就是标题层级大纲，复用 markmap（markdown → 树 → SVG），与 Markdown 正文渲染互不干扰。

### 11.3 MyReader 端设计

#### 11.3.1 类型与服务层（`src/services/mybooksService.ts`）

1. `MyNexusChatMessage` 增补 `toolResult?: { toolName: string; resultJson: string }`。
2. `MyNexusResponse` 接口增补 `tool_result?: { tool_name?: string; result_json?: string }`。
3. `streamMyNexusChat` 的选项增补回调 `onToolResult?: (tool: { toolName: string; resultJson: string }) => void`，在既有按 `\n\n` 分帧的解析器内识别 `tool_result` 字段后触发（跨 chunk 重组逻辑已实现并有测试覆盖，无需改动）。

#### 11.3.2 面板内嵌小图（`MyNexusChatPanel.tsx`）

- 收到 `tool_name === 'generate_mindmap'` 的帧 → 解析 `result_json` → 写入**该轮助手消息**的 `toolResult`/`mindmap` 字段（仅内存态）。
- 在助手消息的 Markdown 正文**下方**渲染 `<MyNexusMindmap markdown title />`，高度约 320–380px，随面板宽度自适应；解析失败仅打日志并忽略该帧（不影响正文）。
- 若同一轮先到 `tool_result` 再到正文增量，两者并存显示。

#### 11.3.3 渲染组件（新增 `src/app/reader/components/mynexus/MyNexusMindmap.tsx`）

对齐 MyNexus `MindmapView.vue`：

- `markmap-lib` 的 `Transformer` 把 markdown 转树，`markmap-view` 的 `Markmap.create(svgEl, options, data)` 渲染（`autoFit: true, fitRatio: 0.85, duration: 300, maxWidth: 320, paddingX: 16`）。
- `useEffect` 内创建、卸载时 `destroy()`；`markdown` 变化时 `setData` 重绘；容器尺寸变化（面板拖宽、窗口 resize、独立窗口开合）时调用 `fit()`。
- React 严格模式下 effect 会跑两次，需保证「创建前先销毁上一实例」避免重复 SVG 叠加。
- 头部按钮（复用阶段三的按钮风格）：复原视图 / 放大 / 下载（SVG、PNG、Markdown 见 11.3.5）。
- 职责拆分为受控组件：内嵌小图与独立窗口共用同一个 `MyNexusMindmap`，由外层传入 `height` 与 `autoFit` 差异参数，避免两套渲染逻辑。

#### 11.3.4 独立窗口查看（放大）

- **形态已确认**：使用 MyReader 既有 [Dialog.tsx](file:///Volumes/data/projects/poxenstudio/myreader/app/src/components/Dialog.tsx)（底层为 `components/primitives/dialog.tsx` 的 radix）承载，覆盖式，尺寸约 `75vw × 75vh`（小屏退化为近全屏），`Esc` 关闭。
- 打开时挂载新实例并 `fit()`，关闭时卸载销毁；窗口 resize 时重新 `fit()`。
- 与 MyNexus 的差异：MyNexus 用 `Teleport to=body` 的裸 modal，MyReader 用既有 Dialog 以保持一致的可访问性与层级管理；`z-index` 需高于 Notebook 覆盖层（Notebook 非 pinned 时为 `z-[45]`，Dialog 取 ≥ `z-50`）。
- 不采用 Tauri 原生新窗口（跨窗口状态传递复杂，收益不足）。

#### 11.3.5 下载（SVG / PNG / Markdown，三种格式）

统一入口：内嵌小图与独立窗口头部共用一个「下载」菜单（或三个按钮），全部经 `appService.saveFile` 落盘（[system.ts](file:///Volumes/data/projects/poxenstudio/myreader/app/src/types/system.ts#L147-L160)）：桌面端弹原生保存对话框，Web/Embedded 走浏览器下载。**不要用裸 `a[download]`**，Tauri WebView 对 `download` 属性支持不可靠。

三种格式共用同一份「自包含 SVG 字符串」作为源，先构造一次再分别导出：

1. **SVG**（对齐 MyNexus 做法）：`getBBox()` 计算并扩边 `viewBox` → clone `<svg>` → 注入白色背景 `<rect>` → 把 CSS 变量的 `fill` 替换为字面量颜色 → 序列化字符串 → `saveFile('${title}.svg', svgText, { mimeType: 'image/svg+xml' })`。文件名 `${title || 'mindmap'}`。
2. **PNG**：把上面的自包含 SVG 字符串包成 `Blob(type=image/svg+xml)` → `URL.createObjectURL` → `new Image()` 加载 → 以 2 倍图尺寸绘制到 `canvas`（先铺白底，避免透明底）→ `canvas.toBlob('image/png')` → `blob.arrayBuffer()` → `saveFile('${title}.png', buffer, { mimeType: 'image/png' })`；用后 `URL.revokeObjectURL`。
   - 前提与注意：SVG 必须自包含（已内联颜色、无外链 CSS/字体/图片），且需显式给出 `width`/`height`（否则部分 WebView 下 Image 加载后尺寸为 0）；文字可能回退到系统字体，属可接受。
3. **Markdown**：直接用 tool_result 里的 `markdown` 大纲文本 → `saveFile('${title}.md', markdown, { mimeType: 'text/markdown' })`。零额外成本。

文件名中的非法字符（`/ \ : * ? " < > |`）需替换为 `-`，避免移动端/Windows 保存失败。

#### 11.3.6 主题、i18n 与日志

- 配色跟随 MyReader 主题（`useThemeStore` / `bg-base-*`、`currentColor`），不引入 MyNexus 的 `markmap-dark` 类；深色/浅色切换时触发一次重绘或重新 `fit()`。
- 新增 i18n key（英文为原文，写入 `zh-CN`/`zh-TW`，`en` 走 key-as-content）：`Mind Map`、`Reset View`、`Expand`、`Download SVG`、`Close`。
- 调试日志：收到 tool_result（tool_name / markdown 长度 / node_count）、解析失败原因、渲染实例创建/销毁、下载文件名与大小。

### 11.4 依赖与构建风险

- 新增依赖：`markmap-lib`、`markmap-view`（均 MIT；`markmap-view` 会引入 d3 系列子依赖）。体积需实测，若影响冷启动再考虑动态 `import()` 懒加载（仅在内嵌图首次出现时加载）。
- **必须验证构建检查**：项目有 `check:optional-chaining`（构建产物中不得出现 `?.`）与 `check:lookbehind-regex` 两道闸门。第三方包（d3/markmap）若含可选链或 lookbehind 正则，打包后可能触发失败。新增依赖后需跑 `pnpm build-web && pnpm check:all`；若触发，优先在 [next.config.mjs](file:///Volumes/data/projects/poxenstudio/myreader/app/next.config.mjs#L97) 的 `transpilePackages` 中加入该包（或调整编译目标）后重跑。
- 备选（不推荐）：自研极简 SVG 树渲染，避免新依赖，但要自行处理布局、缩放、自适应与文本换行，维护成本更高。

**Q3 实测结果（阶段五已执行）**：

- 直接 `import { Transformer } from 'markmap-lib'` 会经其 `dist/plugins.js` 拉入 `yaml`，而 `yaml` 内部用「动态 RegExp + try/catch 回退」探测 lookbehind，打包后触发 `check:lookbehind-regex` → 闸门失败。
- 解决：改从子路径入口 `markmap-lib/no-plugins` 导入（其 `builtInPlugins` 为空，只依赖 markdown-it，不拉 `yaml` / `highlight.js` / `katex`）。改动后 `pnpm build-web && pnpm check:all` 全绿；同时顺带减小体积。
- `check:optional-chaining` 属**基线已失败**（改动前的既有 `out` 产物在 131/192 个 chunk 中存在 9380 处 `?.`，与本次新增依赖无关），且 CI（`.github/workflows/pull-request.yml`）只跑 `pnpm build-web && pnpm check:all`，不含该脚本。

### 11.5 实施阶段（继承「逐阶段停下确认与提交」约定）

**阶段五：数据链路与内嵌渲染**
1. 服务层增补 `toolResult` 类型与 `onToolResult` 回调 + 单元测试（含 `tool_result` 帧、`result_json` 非法 JSON、与正文增量同帧并存）。
2. 面板解析并存储当轮思维导图。
3. 新增 `MyNexusMindmap.tsx`，在助手消息内嵌显示小图。
4. i18n key 落地（内嵌部分）。
5. **停下确认，由用户提交。**

**阶段六：独立窗口与下载**
1. 接入 `Dialog` 实现放大独立查看（挂载/卸载/refit）。
2. 实现 SVG 下载（`appService.saveFile`）。
3. 主题联动、日志补齐、i18n 补齐。
4. **停下确认，由用户提交。**

### 11.6 待确认项（已全部闭环）

1. ~~**Q1 历史思维导图是否要持久化？**~~ **已确认：不做持久化**，仅当轮流式响应内可见（与 MyNexus 官方前端一致）；不本地缓存，不改上游落库。
2. ~~**Q2 下载格式**~~ **已确认：SVG + PNG + Markdown** 三种（见 11.3.5）。
3. ~~**Q3 是否接受新增 `markmap-*` 依赖**~~ **已确认：接受**；仍需按 11.4 跑 `pnpm build-web && pnpm check:all` 验证两道构建闸门。
4. ~~**Q4 独立窗口形态**~~ **已确认：MyReader 既有 `Dialog` 模态**（见 11.3.4）。

### 11.7 验收清单（思维导图）

- [ ] 当 MyNexus 回答触发 `generate_mindmap` 时，助手消息下出现内嵌思维导图，正文同时正常流式显示
- [ ] 导图随面板宽度变化自适应，拖宽/缩窄后不重叠、不溢出
- [ ] 点「放大」在独立窗口查看，可交互展开/收起节点，`Esc` 可关闭
- [ ] 三种下载格式均可用：SVG 可正常打开且颜色/白底正确；PNG 不透明底、2 倍清晰度；Markdown 内容与大纲一致
- [ ] 文件名非法字符被替换；桌面端弹原生保存框，Web 端触发下载
- [ ] `result_json` 非法或 tool_name 不匹配时不报错、不影响正文渲染
- [ ] 重开会话后不显示历史思维导图（与 MyNexus 行为一致，Q1 已确认不持久化）
- [ ] `pnpm check:all` 通过（含 optional-chaining / lookbehind 两道闸门）


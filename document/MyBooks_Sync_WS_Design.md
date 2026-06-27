# Readest Native Sync — WebSocket 实时同步方案设计（可行性评估）

**状态**：设计草案 / 待评审，尚未实现
**关联文档**：
- [`MyBooks_Sync_API.md`](./MyBooks_Sync_API.md) — Readest Native Sync 的 REST 协议规范（服务端待实现，客户端待实现，当前 `ENABLE_SYNC_FEATURE = false`）
- [`MyBooks_WebAPI.md`](./MyBooks_WebAPI.md) — mybooks 现有后台 REST API（图书库、用户、OPDS 等）
- 客户端当前唯一已上线的阅读数据同步通道：`app/src/services/webdav/WebDAVSync.ts`（WebDAV，轮询 + 防抖）

---

## 一、背景

MyReader 作为 mybooks 的专属阅读器，目前只需要同步"阅读数据"，不需要承担书籍文件本身的跨设备传输（书籍文件由 mybooks 图书库统一管理，阅读器只读取/下载，不需要把书籍文件当作同步对象）。

"阅读数据"对应 Readest Native Sync 协议中的 **Legacy Record Sync**（`MyBooks_Sync_API.md` §1），不含 Replica Sync（CRDT，词典/字体/纹理/OPDS订阅/App设置）——后者本期不在范围内，按需可作为独立的后续课题。

| 子系统 | 内容 | 排除项 |
|---|---|---|
| Legacy Record Sync (`/api/sync`) | 书籍元数据（标题/作者/标签/分类/封面 URL 等，**不含文件本体**）、阅读进度/位置（`BookConfig`）、笔记/划线/书签（`BookNote`） | 书籍二进制文件、封面二进制（走 `/api/storage/*`，本方案不覆盖）；Replica Sync（词典/字体/纹理/OPDS/设置，不在本期范围） |

当前现状：

1. **mybooks 后端尚未实现** `MyBooks_Sync_API.md` §1 描述的 `/api/sync` 接口；客户端也没有落地对应的 `SyncClient`（`app/src/libs/` 下没有实现文件）。`ENABLE_SYNC_FEATURE` 当前为 `false`。
2. **实际生产可用的同步通道是 WebDAV**（`WebDAVSync.ts` + `useWebDAVSync.ts`），其特征是：
   - 推送防抖 `PUSH_DEBOUNCE_MS = 15s`；
   - 拉取冷却 `PULL_COOLDOWN_MS = 60s`，仅在窗口聚焦 / 打开书籍时触发；
   - **没有服务端到客户端的推送能力** —— 跨设备同步延迟下限就是这两个时间窗口（最坏情况下另一台设备要等到下次窗口聚焦 + 60s 冷却才能看到更新）。

因此提出"是否引入基于 WebSocket 的同步通道，以获得更快（接近实时）的跨设备同步体验"这一问题，本文档先给出可行性评估与实现方案。

---

## 二、目标与非目标

**目标**

- 多设备间阅读进度 / 笔记 / 书籍元数据等"阅读数据"的同步延迟从"分钟级（轮询窗口）"降到"秒级以内"。
- 保持与现有 REST 语义（LWW by `updated_at`）完全一致 —— WebSocket 只是更快的**传输层**，不应该引入第二套合并逻辑。
- 在 WS 不可用（防火墙、企业代理、应用被系统挂起等）时**优雅降级**为现有轮询/REST 路径，不能让同步功能整体依赖 WS。

**非目标**

- 不传输书籍文件或封面二进制（继续走 `/api/storage/*` 签名 URL 或 mybooks 既有的 `/api/book/<id>.<ext>` 下载接口）。
- 不取代 WebDAV 通道 —— WebDAV 面向"自托管 / 无需 mybooks 账号也能同步"的用户场景，与面向 mybooks 账号体系的 Native Sync 是两条独立、并行存在的同步路径，互不依赖。
- 不涉及 Replica Sync（CRDT，`/api/sync/replicas`）——词典、字体、纹理、OPDS 订阅、App 设置的同步本期不在范围内。
- 本阶段不做端到端加密通道设计。

---

## 三、两种候选架构

### 方案 A —— "WS 仅作变更通知（change notification），数据体仍走 REST"（推荐先行）

服务端在 REST 写入（`POST /api/sync`）成功落库后，向该用户的其他在线连接广播一条**极简事件**：

```json
{ "type": "changed", "scope": "configs", "bookHash": "abcd1234", "ts": 1750000000000 }
{ "type": "changed", "scope": "notes", "bookHash": "abcd1234", "ts": 1750000000000 }
{ "type": "changed", "scope": "books", "bookHash": "abcd1234", "ts": 1750000000000 }
```

客户端收到事件后，立即触发一次对应的 REST 增量拉取（`GET /api/sync?since=...&type=...`），而不是等待轮询间隔。

**优点**

- 完全复用现有/规划中的 REST 校验、合并、错误处理逻辑，WS 层不需要重新实现一遍业务规则，出 bug 的面非常小。
- 协议极简，消息体 <200 字节，对服务端资源占用低，容易在任意后端框架上加一个轻量 WS/SSE 网关。
- 即使 WS 网关挂了，REST 轮询路径原样工作，是天然的降级路径——不需要额外写"降级逻辑"，两条路径本来就独立存在。
- 实现成本和风险都低，可以作为第一阶段交付。

**缺点**

- 一次变更仍需要"WS 通知 + REST 拉取"两次网络往返，不是真正的单连接全双工同步；在弱网下比纯 WS 方案多一点延迟（但仍远好于轮询）。

### 方案 B —— "WS 承载完整同步语义（push/pull 都通过 WS 消息帧）"

把 `/api/sync` 的请求/响应整体搬到 WS 消息帧上（每条消息带 `requestId` 做请求-响应配对），WS 成为唯一的同步通道，REST 仅作首次全量同步或 WS 不可用时的兜底。

**优点**

- 真正的单连接全双工，理论延迟和带宽开销最优。
- 服务端可以在收到一个客户端的 push 后，直接把合并后的增量结果原样转发给同用户的其它在线连接，无需对方再发一次 pull 请求。

**缺点**

- 必须在 WS 处理器里完整复刻一遍 REST 的校验与 LWW 合并规则——相当于维护两套等价但物理上分离的实现，长期一致性维护成本高，且 mybooks 后端框架是否方便承载这套逻辑（鉴权、限流）尚未验证。
- 断线重连、消息丢失重传、与 REST 兜底路径的状态对齐（"WS 在线时千万不能也走 REST，否则同一条变更两次落库"）都需要额外设计，复杂度显著上升。
- 没有现成的 mybooks 服务端实现可以参考改造，风险不可控。

### 结论

**采用方案 A 作为第一阶段方案**：低风险、复用现有/规划中的 REST 实现，且能拿到大部分延迟收益（把延迟瓶颈从"轮询间隔"降到"一次 REST 往返"，量级从分钟级降到通常 <1s）。方案 B 留作"如果方案 A 上线后用户仍嫌延迟高"的后续选项，不在本阶段投入。

下文的协议设计、鉴权、容灾均按**方案 A**展开。

---

## 四、协议设计（方案 A）

### 4.1 连接建立

```
wss://<mybooks-host>/api/sync/events
```

mybooks 的 WS 鉴权**只支持基于登录 Cookie**（`user_id` 等，见 `MyBooks_WebAPI.md` 附录D），不做单独的 WS token 签发——WS 握手本质上是一次带 `Upgrade` 头的 HTTP 请求，服务端按现有登录态解析逻辑直接拿到 `user_id` 即可，不需要额外接口。

客户端必须保证发起 WS 连接时，登录 Cookie 能被带到 `/api/sync/events` 的握手请求里，但 Web 和 Tauri 两端的实际可行路径不同（已实测确认，详见下文），**不能假设"标准 WS 客户端会自动带上目标域 Cookie"对两端都成立**：

- **Web（浏览器）**：mybooks 的登录 Cookie 实际并不存在浏览器的 mybooks 域下——现有 REST 请求经 `/api/mybooks/proxy/[...path]` 转发时，响应里的 `Set-Cookie` 会被**去掉 `Domain` 属性后重写**，使 Cookie 落在 MyReader 自己的页面源（origin）下，从而绕开跨域/混合内容问题（见该路由的注释）。这意味着浏览器原生 `WebSocket` 如果直接连 `wss://<mybooks-host>/api/sync/events`，**握手请求不会带上这个 Cookie**（Cookie 根本不在那个域下）。因此 Web 端必须经由 MyReader 自己的同源代理路由转发：客户端连 `wss://<myreader-origin>/api/mybooks/sync-events?host=<mybooks-host>`（同源，浏览器自动带上 MyReader 域下的 Cookie），代理路由再用收到的 Cookie 值向真正的 `wss://<mybooks-host>/api/sync/events` 发起带 `Cookie` 头的连接，双向转发消息帧。这与现有 REST 代理（`src/app/api/mybooks/proxy/[...path]/route.ts`）是同一套思路在 WS 上的延伸。
- **Tauri 桌面/移动端**：现有 REST 请求走 `@tauri-apps/plugin-http` 的 `fetch`，其 Cookie 由该插件内部的 reqwest cookie jar 自动管理，但**这个 cookie jar 不对外暴露**（`tauri-plugin-http` 2.5.9 源码中持有它的类型是 `pub(crate)`，没有读取 API），而本项目用来发 WS 的 `@tauri-apps/plugin-websocket` 是完全独立的 `tokio-tungstenite` 客户端，**不会**自动带上 plugin-http 那份 Cookie，必须显式通过 `connect(url, { headers: { Cookie: ... } })` 传入。因此 Tauri 端改为**自管 Cookie**：登录成功的响应里，plugin-http 的 `fetch()` 会把 `Set-Cookie` 原样透传给 JS（这点不同于浏览器——浏览器的 `fetch()` 出于安全考虑会隐藏 `Set-Cookie`，但 `@tauri-apps/plugin-http` 的实现特意保留了它，源码注释明确写了这一点），客户端登录时读取并持久化这个 Cookie 值，之后发起 WS 连接时显式带上 `Cookie` 头。REST 请求路径不受影响，继续依赖 plugin-http 的隐式 cookie jar。
- 若 Cookie 缺失或会话已过期，服务端在 WS 升级阶段直接拒绝（标准 HTTP 401，不完成 Upgrade），客户端按 4.4 节的重连逻辑处理（重连前提示用户重新登录，而不是无限重试）。
- 握手成功后，服务端把该连接加入 `user:<user_id>` 的广播分组（同一用户可能同时有多台设备/多个标签页连接，必须支持一对多）。

### 4.2 消息类型

| `type` | 方向 | 用途 |
|---|---|---|
| `changed` | server → client | 见上文，携带 `scope` + 最小定位信息，不带完整数据体 |
| `ping` / `pong` | 双向 | 心跳，建议客户端每 25–30s 发一次 `ping`，服务端原样 `pong`；超过 2 个心跳周期无响应判定连接失活 |
| `hello` | client → server（握手后第一条） | 携带客户端已知的各 scope 游标（`{ configsSince, notesSince, booksSince }`），服务端可据此判断"我推的 `changed` 事件客户端是否已经知道"，避免握手瞬间的冗余通知（非必须优化，第一版可以直接全量推） |
| `error` | server → client | 会话过期 / 鉴权失败 / 限流，客户端据此决定是否提示重新登录、是否重连 |

`changed` 事件本质上是"缓存失效信号"，**不携带也不需要携带合并后的数据** —— 数据一致性永远以 REST pull 的响应为准，这是方案 A 能保持单一事实来源（single source of truth）的关键约束，设计和实现时必须坚持。

### 4.3 客户端行为

收到 `changed` 事件后：

1. 按 `scope` 路由到对应的现有拉取函数（按 `bookHash` 拉取单本书的 config/notes/books，或全量 `since` 拉取）。
2. 对同一 `scope`/`bookHash` 在短时间窗口内的多次 `changed` 事件做合并（例如 1–2s 去抖），避免对方设备连续翻页时每次 progress 更新都触发一次拉取。
3. 拉取结果照旧走现有的合并/落盘逻辑（`pullBookConfig` 的等价 REST 实现），WS 通知路径和"打开书籍时主动 pull"路径在落盘层面完全复用同一套代码，不另起一套。

### 4.4 断线与重连

- 标准指数退避：1s → 2s → 4s → … 上限 30s，加 ±20% 抖动，避免服务端重启后所有客户端同时重连造成惊群。
- 重连成功后，**必须补一次全量/增量 pull**（基于本地游标），因为断线期间错过的 `changed` 事件无法重放——这进一步印证了方案 A 的"WS 只是加速器，REST 游标才是权威状态"的设计取舍，断线容错几乎是免费的。
- 移动端/Tauri WebView 进入后台时操作系统可能直接断开 WS（iOS Safari/WKWebView 后台网络受限），App 恢复前台时复用"重连后补 pull"的同一套逻辑即可，无需为后台场景单独设计。

---

## 五、服务端可行性评估

> 以下三点已与 mybooks 后端确认，第三节列出的前提风险已解除，方案 A 可以直接进入实现阶段。

1. **WS 连接 + 异步 IO**：mybooks 后端原生支持 WebSocket 连接与异步 IO，可以直接在现有 Web 进程内挂载 `wss://.../api/sync/events` 端点，**不需要**额外的旁路网关服务。
2. **多连接在线状态共享**：mybooks 部署形态是**单实例**，因此"谁在线"的广播分组（`user:<id>` → 一组 socket）直接用**进程内内存**维护即可（例如一个 `Dict[user_id, set[WebSocket]]`），不需要引入 Redis Pub/Sub 或其它跨实例协调机制。若未来部署形态变为多实例，这里是预留的唯一扩展点。
3. **广播触发时机**：由后端在 `POST /api/sync` 完成数据库落库（事务提交）之后，在同一个请求处理函数内直接触发对该用户其它在线连接的广播。广播调用必须是非阻塞/fire-and-forget 的（不等待客户端 ack），避免广播逻辑反过来拖慢或影响 REST 写入本身的成功率。

**结论**：服务端落地路径已经明确，**没有遗留的架构级阻塞项**。具体接口与数据模型见下方新增的「十一、服务端实现规范」一章，后端可直接依据该章节实现完整的 `/api/sync` 同步能力 + WS 广播。

---

## 六、客户端可行性评估

- **Web（CloudFlare Workers 部署）**：不能直接用浏览器原生 `WebSocket` 连 `wss://<mybooks-host>/...`——见 §4.1，mybooks 登录 Cookie 实际落在 MyReader 自己的源下，跨域直连带不上 Cookie。客户端连同源的 `wss://<myreader-origin>/api/mybooks/sync-events?host=...`，由一个新的 Next.js 路由做转发（同源 WS 接入 + 对 mybooks 的出站 WS 连接，挟带 Cookie 头）。出站连接部分复用本项目已有的 CF Workers WS 升级模式（`src/libs/edgeTTS.ts` 的 `fetch(..., { headers: { Upgrade: 'websocket' } })` 分支，见 `app/.claude/memory/cloudflare-workers-websocket.md`）；入站接受客户端连接需要 Cloudflare Workers 的 `WebSocketPair`，这部分在本项目里还没有先例，**需要在实现时单独验证**（CF Workers 原生支持，但 Next.js on OpenNext-Cloudflare 这层适配是否透传良好尚未在本项目验证过）。
- **Tauri 桌面端/移动端**：不能直接用浏览器端 `WebSocket` API 假设它能带上登录 Cookie——Tauri WebView 的 Cookie 存储和 `@tauri-apps/plugin-http` 的内部 cookie jar是两套互不相通的东西，且后者不提供读取 API。改用 `@tauri-apps/plugin-websocket`（已是项目依赖，`src/libs/edgeTTS.ts` 已有使用先例）显式连接 `wss://<mybooks-host>/api/sync/events`，并在 `connect()` 的 `headers` 里带上登录时自管捕获的 Cookie 值（见 §4.1）。
- **Tauri 移动端（iOS/Android）**：需要验证 App 进入后台后 `plugin-websocket` 的连接是否保活（大概率不会，操作系统会限制后台网络）。由于第四节已经把"重连后补 pull"设计为标准恢复路径，这里不需要额外的平台特判代码，只是要在测试计划里明确覆盖"切后台再切回前台"场景。
- 与现有 `useWebDAVSync.ts` 类比，建议新增一个同级的 `useNativeSyncEvents.ts` hook，内部按平台分两个分支（Tauri 直连 / Web 经代理路由），只负责维护 WS 连接 + 把 `changed` 事件路由到既有的 pull 触发函数，不重新实现合并逻辑。

---

## 七、与现有 WebDAV 通道的关系

WS 方案是 Native Sync（mybooks 账号体系下的 `/api/sync`）的传输增强，**不影响、不替代** WebDAV 同步通道：

- 已经启用 WebDAV 的用户不受任何影响，两条通道在数据模型上是独立的（WebDAV 用 `RemoteBookConfig` 信封 + 文件系统路径；Native Sync 用 `BookRecord`/`BookConfigRecord`/`BookNoteRecord` + 数据库）。
- 如果未来产品决策是"逐步用 mybooks 账号同步取代 WebDAV"，那也是一个独立的迁移决策，和本文档讨论的"给 Native Sync 加 WS 加速"是两件事，不应该混在一次改动里做。

---

## 八、风险与缓解

| 风险 | 缓解 |
|---|---|
| 企业网络/代理屏蔽 WS 升级请求 | REST 轮询路径始终保留，WS 连接失败时静默降级，不弹错误打扰用户 |
| mybooks 现有框架不支持长连接 | 见第五节，独立旁路网关兜底；本阶段先确认这一前提，再决定是否继续往下排期 |
| 多设备/多实例广播不可达 | 单实例部署可先用进程内内存分组；多实例部署需要 Redis Pub/Sub 或等价机制，作为后续扩展点而非第一版必需项 |
| `changed` 事件风暴（如批量操作触发大量小事件） | 客户端按 scope 去抖（§4.3 第2点）；服务端可选按 `(user_id, scope)` 做 200ms 级合并后再广播 |
| 登录 Cookie 在 WS 场景下的安全性 | 与现有 REST 接口共用同一套登录 Cookie/会话机制，没有引入新的凭证形态；仍要求 `wss://`（TLS）传输，避免 Cookie 被网络中间人窃取 |
| 断线期间错过通知导致"看起来没同步" | 重连后强制补一次 pull（§4.4），用户不会感知到丢失通知 |

---

## 九、分阶段实施建议

1. **Phase 1**：mybooks 依据「十一、服务端实现规范」落地 `/api/sync` REST 接口本身（当前还是 0 → 1，这是 WS 加速能生效的前提，没有这一步 WS 无的放矢）。
2. **Phase 2**：按本文档方案 A 落地 `wss://.../api/sync/events` 通知通道（基于现有登录 Cookie 鉴权，无需新增 token 接口），服务端在 `POST /api/sync` 落库后触发广播；客户端新增 `useNativeSyncEvents.ts`。
3. **Phase 3（按需）**：上线后观察"通知到落盘"的实际延迟分布；如果用户反馈仍不够快（理论上方案 A 应该能做到亚秒级到 1-2s），再评估是否值得投入方案 B。

---

## 十、可行性结论

- **协议/客户端层面**：方案 A 可行性高，复杂度可控，可以与 Phase 1 的 REST 落地并行设计、稍后于 REST 完成后接入。
- **服务端层面**：已确认 mybooks 支持 WS + 异步 IO、单实例部署可直接用内存维护在线状态、广播由落库后的请求处理函数触发——**没有遗留的架构级阻塞项**，可以直接排期实现。
- **建议**：按「十一、服务端实现规范」实现 `/api/sync` 本身（同步功能能否上线的前提），WS 通知层作为紧随其后的体验优化迭代，不阻塞 REST 的上线节奏。

---

## 十一、服务端实现规范 —— `/api/sync` 数据模型与接口（供后端直接实现）

本章是独立、自包含的服务端实现说明：后端只需阅读本章（必要时参照 `MyBooks_Sync_API.md` §1 的背景），即可实现完整的 Legacy Record Sync 同步能力，并在此基础上挂载第四节描述的 WS 广播。

### 11.1 鉴权

复用 mybooks 现有的 Cookie 登录态（`MyBooks_WebAPI.md` 附录D，`user_id` Cookie）。所有 `/api/sync` 接口要求已登录，未登录返回标准的 `{ "err": "permission.denied" }`（401）。每条同步记录都归属于发起请求的 `user_id`，服务端必须以会话解析出的 `user_id` 为准，**不信任请求体里的 `user_id` 字段**（即便客户端传了也要忽略/校验一致）。

### 11.2 接口

#### `GET /api/sync` —— 拉取增量变更

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `since` | number | 是 | Unix 毫秒时间戳；返回 `updated_at > since` 的记录（含 `deleted_at > since` 的墓碑记录） |
| `type` | string | 否 | `books` \| `configs` \| `notes` 之一；省略则三类都返回 |
| `book` | string | 否 | 按 `book_hash` 过滤到单本书 |

**响应 `200`：**

```json
{
  "books":   [ /* BookRecord[]   | null */ ],
  "notes":   [ /* BookNoteRecord[] | null */ ],
  "configs": [ /* BookConfigRecord[] | null */ ]
}
```

`type` 指定的类别必须返回数组（即使是空数组 `[]`），未指定的类别可以返回 `null`。

#### `POST /api/sync` —— 推送本地变更

**请求体：**

```json
{
  "books":   [ /* Partial<BookRecord>[] */ ],
  "notes":   [ /* Partial<BookNoteRecord>[] */ ],
  "configs": [ /* Partial<BookConfigRecord>[] */ ]
}
```

**服务端处理流程（每条记录独立处理，互不影响）：**

1. 校验 `user_id` 归属（取会话 `user_id`，忽略请求体里的同名字段）。
2. 按 `(user_id, book_hash, id)` 或单独的 `id`（视主键设计，见 11.4）查找已存在的记录。
3. **Last-Write-Wins 合并**：若不存在，直接插入；若存在，比较 `updated_at`，新记录的 `updated_at` 更大（或相等且来源需要覆盖时）才覆盖落库，否则保留已存在的记录不变（不报错，静默忽略这条）。
4. 落库成功后（建议在同一数据库事务提交之后），**触发对该 `user_id` 的 WS 广播**（见 11.5），随后才返回响应——但广播本身是 fire-and-forget，不应阻塞或影响 HTTP 响应的返回。
5. 收集每条记录"合并后的最终状态"，按响应格式返回。

**响应 `200`**：与 `GET /api/sync` 同形状 —— 返回这次推送涉及的记录在服务端合并后的最终值（包括客户端没发但服务端已有的字段），客户端用这个响应覆盖本地缓存以保持收敛。

**错误**：任何非 2xx 返回 `{ "err": "<message-or-code>" }`，状态码遵循 mybooks 现有约定（401 未登录、403 无权限、422/400 参数错误、500 服务端错误）。

### 11.3 记录公共字段 —— `BookDataRecord`

`books`、`notes`、`configs` 三类记录都携带以下公共字段：

```ts
interface BookDataRecord {
  id: string;                 // 该记录的稳定唯一 id（建议 UUID，由客户端生成，服务端不重新分配）
  book_hash: string;           // 对应 Book.hash —— 书籍文件内容的部分 MD5
  meta_hash?: string;          // 对应 Book.metaHash —— 书籍元数据 MD5，用于聚合同一本书的不同版本
  user_id: string;             // 记录归属用户（服务端从会话解析，不取请求体）
  updated_at: number | null;   // 毫秒时间戳；驱动 last-write-wins
  deleted_at: number | null;   // 毫秒时间戳墓碑；null = 未删除
}
```

### 11.4 `books` —— `BookRecord = BookDataRecord & Book`

```ts
interface Book {
  hash: string;                 // = book_hash，主键的一部分
  metaHash?: string;             // = meta_hash
  format: string;                // 'EPUB' | 'PDF' | 'TXT' | ... 书籍格式
  title: string;
  sourceTitle?: string;
  author: string;
  group?: string;                 // 旧字段，已被 groupId/groupName 取代，仍需兼容存储
  groupId?: string;
  groupName?: string;
  tags?: string[];
  coverImageUrl?: string | null;  // 封面 URL（如 mybooks 的 /api/book/<id>/cover），不是二进制本体

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;

  progress?: [number, number];           // [当前页, 总页数]，从 1 开始
  readingStatus?: 'unread' | 'reading' | 'finished';
  primaryLanguage?: string;

  metadata?: Record<string, unknown>;    // 透传存储即可，服务端不需要理解结构
  files?: { format: string; size: number; href: string }[];
}
```

**这条记录不包含书籍文件或封面的二进制数据** —— 二进制传输继续走 mybooks 既有的图书库接口（`MyBooks_WebAPI.md` §3，如 `/api/book/<id>.<ext>`、`/api/book/<id>/cover`），`/api/sync` 只同步上表这些"元数据 + 阅读状态"字段。

服务端落库时，建议把 `hash`（即 `book_hash`）与 mybooks 现有图书库中的书籍记录关联起来（例如通过 ISBN/文件 MD5 做一次映射），但这属于 mybooks 业务侧的图书匹配逻辑，不在本同步协议的职责范围内 —— 同步协议只负责存取这条 JSON 记录本身。

### 11.5 `notes` —— `BookNoteRecord = BookDataRecord & BookNote`

承载书签、划线高亮、批注：

```ts
type BookNoteType = 'bookmark' | 'annotation' | 'excerpt';
type HighlightStyle = 'highlight' | 'underline' | 'squiggly';

interface BookNote {
  bookHash?: string;     // = book_hash
  metaHash?: string;      // = meta_hash
  id: string;              // = id
  type: BookNoteType;
  cfi: string;              // EPUB CFI，标识笔记所在位置
  page?: number;            // 分页/固定排版格式下的页码
  text?: string;            // 选中/摘录的原文文本
  style?: HighlightStyle;
  color?: string;           // 预设颜色名或十六进制色值
  note: string;             // 用户书写的笔记内容
  global?: boolean;         // 是否对全文中所有出现的 text 都生效

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}
```

### 11.6 `configs` —— `BookConfigRecord = BookDataRecord & BookConfig`

每本书的阅读进度与视图设置：

```ts
interface BookConfig {
  bookHash?: string;
  metaHash?: string;
  progress?: [number, number];   // [当前页, 总页数]
  location?: string;              // 当前阅读位置的 CFI

  updatedAt?: number;
}
```

> 注：客户端实际的 `BookConfig` 还包含 `viewSettings`（字号/主题等设备本地偏好）、`searchConfig`、`rsvpPosition` 等字段——这些是"设备本地 UI 偏好"，**不应该**通过跨设备同步覆盖（同一逻辑已经在 WebDAV 通道的 `buildRemotePayload` 中实践，见 `app/src/services/webdav/WebDAVSync.ts`）。服务端实现 `/api/sync` 时，`configs` 记录只需要存取客户端实际发送的字段，**不需要**对字段集合做白名单校验——"哪些字段算阅读状态、哪些算设备偏好"完全由客户端决定发不发，服务端只是存取容器。

### 11.7 存储方案

mybooks 的用户总数少、同步操作频率低（阅读进度防抖后大约几十秒一次，远谈不上高并发），**不需要为此引入数据库表/迁移**。推荐用文件存储；如果 mybooks 后端已经有现成的 DB 访问层并且加表很轻量，方案二（关系表）也可以，两者任选其一，不互斥也不需要都做。

#### 方案一：按用户的 JSON 文件存储（推荐）

目录约定（路径可按 mybooks 现有数据目录规范调整）：

```
<data-dir>/sync/<user_id>/books.json
<data-dir>/sync/<user_id>/configs.json
<data-dir>/sync/<user_id>/notes.json
```

每个文件是一个 JSON 对象，**以记录的自然主键为 key**，方便 O(1) upsert，避免每次写入都要解析整个数组找对应项：

- `books.json` / `configs.json`：以 `book_hash` 为 key（每个用户每本书只有一条记录）：
  ```json
  { "<book_hash>": { /* BookRecord 去掉 user_id 后的字段 */ }, "...": { ... } }
  ```
- `notes.json`：以 `id` 为 key（一本书可以有多条笔记）：
  ```json
  { "<note_id>": { /* BookNoteRecord 去掉 user_id 后的字段 */ }, "...": { ... } }
  ```

`user_id` 不需要存进文件内容——它已经体现在目录路径里，文件本身就是单用户的数据。

**`GET /api/sync?since=&type=&book=` 的实现**：读取目标用户对应的 1～3 个 JSON 文件（按 `type` 决定读哪些），遍历 value，筛选 `updated_at > since`（含 `deleted_at > since` 的墓碑），如指定 `book` 则再按 `book_hash` 过滤。用户级别的记录数量级很小（几十到几百本书 × 几条笔记），全量加载到内存里筛选完全够用，不需要任何索引结构。

**`POST /api/sync` 的实现**：
1. 读取目标用户对应的 JSON 文件（不存在则视为空对象 `{}`）。
2. 对请求体里每条记录，按 key（`book_hash` 或 `id`）查现有值，做 11.2 节描述的 LWW 合并（比较 `updated_at`，新值更大才覆盖）。
3. 把合并后的整份对象**原子写回**：先写到同目录下的临时文件（如 `configs.json.tmp`），`fsync` 后 `rename` 覆盖原文件——`rename` 在同一文件系统内是原子操作，避免进程崩溃或并发写入导致 JSON 文件半写损坏。
4. 触发 11.8 节描述的 WS 广播。

**并发控制**：同一用户的两次 `POST /api/sync` 理论上可能并发到达（例如两台设备几乎同时触发推送）。由于是单实例部署，用一个**进程内按 `user_id` 分片的锁**（例如 `Dict[user_id, threading.Lock]` 或 asyncio 版本的 `asyncio.Lock`）包住"读文件→合并→写文件"这一段即可，不需要文件系统级锁或数据库事务。锁粒度细到每个用户一把锁，不同用户之间互不影响。

**优点**：零迁移成本，数据模型变化（客户端加字段）不需要改任何存储代码；调试方便（直接 `cat` 文件就能看到某用户的同步状态）；备份就是复制 `sync/` 目录。
**适用边界**：这个方案的伸缩上限取决于"单用户的记录是否能轻松全量放进内存"——对 mybooks 当前的用户规模和单用户书籍量级完全没问题；如果未来变成数据库驱动、单用户书籍数到几万级别，再迁移到方案二也不晚（两种方案的读写接口/合并语义完全一致，迁移只是换存储层实现）。

#### 方案二：关系表（仅当已有 DB 层时作为备选）

```sql
CREATE TABLE sync_books (
  id          VARCHAR PRIMARY KEY,   -- BookDataRecord.id
  user_id     INTEGER NOT NULL,
  book_hash   VARCHAR NOT NULL,
  meta_hash   VARCHAR,
  payload     JSONB NOT NULL,        -- Book 字段整体存为 JSON，避免逐字段建列
  updated_at  BIGINT,
  deleted_at  BIGINT,
  UNIQUE (user_id, book_hash)
);
CREATE INDEX idx_sync_books_user_updated ON sync_books (user_id, updated_at);

CREATE TABLE sync_notes (
  id          VARCHAR PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  book_hash   VARCHAR NOT NULL,
  meta_hash   VARCHAR,
  payload     JSONB NOT NULL,
  updated_at  BIGINT,
  deleted_at  BIGINT
);
CREATE INDEX idx_sync_notes_user_updated ON sync_notes (user_id, updated_at);
CREATE INDEX idx_sync_notes_book ON sync_notes (user_id, book_hash);

CREATE TABLE sync_configs (
  id          VARCHAR PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  book_hash   VARCHAR NOT NULL,
  meta_hash   VARCHAR,
  payload     JSONB NOT NULL,
  updated_at  BIGINT,
  deleted_at  BIGINT,
  UNIQUE (user_id, book_hash)
);
CREATE INDEX idx_sync_configs_user_updated ON sync_configs (user_id, updated_at);
```

要点：
- `payload` 用 JSON 列整体存储业务字段，避免客户端新增字段时需要跟着改表结构 —— `BookDataRecord` 公共字段（`id`/`user_id`/`book_hash`/`meta_hash`/`updated_at`/`deleted_at`）拆成实际列，用于索引和增量查询；其余字段（`title`/`progress`/`note` 等）都进 `payload`。
- `sync_books`、`sync_configs` 每个用户每本书只有一条记录（`UNIQUE(user_id, book_hash)`），新记录直接 upsert；`sync_notes` 每个用户可以有多条（一本书可以有多条笔记），主键是 `id`。
- `(user_id, updated_at)` 复合索引是 `GET /api/sync?since=` 增量查询的核心，必须建立，否则随着记录增多全表扫描会变慢。

两种方案对 `GET`/`POST /api/sync` 的外部行为（请求/响应格式、LWW 合并语义、WS 广播挂载点）完全一致，差异只在存储层内部实现，客户端和第四节的 WS 协议设计不需要关心具体选了哪一种。

### 11.8 WS 连接地址、鉴权与消息协议

本节独立给出 WS 部分的完整约定（与第四节内容一致，重复列出是为了让本章本身自包含）。

#### 连接地址

```
wss://<mybooks-host>/api/sync/events
```

- 路径固定为 `/api/sync/events`，挂载在 mybooks 现有 Web 进程内（已确认支持 WS + 异步 IO，§5），不需要独立网关进程。
- **鉴权方式：只支持基于登录 Cookie**，不新增任何 token 签发接口。WS 握手在协议层面是一次带 `Upgrade: websocket` 头的 HTTP 请求，服务端按现有 REST 接口同款的会话解析逻辑（`MyBooks_WebAPI.md` 附录D，解析 `user_id` Cookie）从握手请求的 `Cookie` 头取出 `user_id` 即可，**不需要额外的鉴权代码路径**。
- 握手阶段校验：若请求未带有效登录 Cookie（未登录或会话已过期），直接拒绝本次 WS 升级，返回标准 HTTP 401，不完成 Upgrade——这与现有 REST 接口对未登录请求的处理方式完全一致，不需要发明新的错误约定。
- **谁会真正带着 Cookie 来连接**：从 mybooks 的角度看，所有连接到 `/api/sync/events` 的请求都应该带有效的登录 Cookie——MyReader 客户端侧的复杂度（Web 端经由自己的同源代理转发 Cookie、Tauri 端自管捕获 Cookie 后显式带上）完全是**客户端内部的事**，对 mybooks 服务端没有任何额外要求，服务端只需要按现有规则解析收到的 Cookie 即可（详见本文档第四、六节）。

#### 连接建立后的分组

握手成功后，服务端把该连接加入按 `user_id` 分组的**进程内内存**集合（§5 已确认单实例部署，不需要 Redis）：

```python
# 全局状态，进程内维护即可
connections: Dict[int, Set[WebSocketConnection]] = defaultdict(set)

def on_ws_connect(ws, user_id):
    connections[user_id].add(ws)

def on_ws_disconnect(ws, user_id):
    connections[user_id].discard(ws)
```

同一用户可能同时有多台设备/多个浏览器标签页连接，必须支持一对多（即 `Set[WebSocketConnection]` 而不是单个连接）。

#### 消息类型

WS 连接上收发的消息体均为 JSON，顶层必有 `type` 字段：

| `type` | 方向 | 字段 | 用途 |
|---|---|---|---|
| `changed` | server → client | `scope`（`books`\|`notes`\|`configs`）、`bookHash`、`ts` | 通知客户端某个用户的某条数据发生了变更，客户端收到后会自行发起一次 `GET /api/sync` 增量拉取；服务端**不需要、也不应该**在这条消息里携带合并后的完整数据 |
| `ping` | client → server | 无 | 心跳，客户端约每 25–30s 发一次 |
| `pong` | server → client | 无 | 收到 `ping` 后原样回复；服务端若发现某连接超过约 2 个心跳周期（~60s）没有发过 `ping`，可以主动关闭该连接以回收资源 |
| `hello` | client → server（握手后第一条，可选） | `{ configsSince, notesSince, booksSince }` | 客户端告知自己当前的游标，服务端可选择性地据此判断要不要压低首次连接时的冗余通知；**第一版服务端实现可以完全忽略这条消息**，直接按上面的广播规则工作即可，不影响功能正确性 |
| `error` | server → client | `code`、`message` | 会话过期 / 鉴权失败 / 限流等场景下发出，随后服务端主动关闭连接 |

服务端实现 `changed` 消息时只需要：知道目标 `user_id`、`scope`、`bookHash`、当前时间戳，组装成上表格式的 JSON，调用 11.8 节下方的广播函数发给该用户的所有在线连接（`ping`/`pong`/`hello`/`error` 是协议完整性需要，但核心价值全部在 `changed` 这一种消息上）。

### 11.9 WS 广播挂载点

在 `POST /api/sync` 的处理函数中，第 11.2 节步骤 4 提到的广播实现示意（伪代码）：

```python
def handle_post_sync(request):
    user_id = get_current_user_id(request)
    result = {"books": [], "notes": [], "configs": []}
    changed_scopes = set()  # {(scope, book_hash)}

    with db.transaction():
        for kind in ("books", "notes", "configs"):
            for incoming in request.json.get(kind) or []:
                merged, was_applied = upsert_with_lww(user_id, kind, incoming)
                result[kind].append(merged)
                if was_applied:
                    changed_scopes.add((kind, merged["book_hash"]))
        # 事务在这里提交

    for scope, book_hash in changed_scopes:
        ws_broadcast.fire_and_forget(user_id, {
            "type": "changed", "scope": scope, "bookHash": book_hash,
            "ts": now_ms(),
        })  # 非阻塞；广播失败只记日志，不影响本次响应

    return json_response(result)
```

`ws_broadcast.fire_and_forget` 对应 11.8 节定义的 `connections` 字典，实现上就是查 `connections[user_id]`，逐个连接 `send`（无需等待 ack）：

```python
def fire_and_forget(user_id, message):
    for ws in list(connections.get(user_id, ())):
        try:
            ws.send_json(message)  # 同步调用即可丢给底层异步框架的 IO 队列；不在此处 await/阻塞等待发送完成
        except Exception:
            log.warning("ws send failed, will be cleaned up on next disconnect", exc_info=True)
```

广播失败（连接已死但还没收到断开事件）只记日志，不影响 `POST /api/sync` 本身的响应——这条连接会在下一次心跳超时或客户端重连时被 `on_ws_disconnect` 清理掉。

`ws_broadcast` 即第四节描述的"按 `user_id` 分组的内存连接表"：维护一个 `Dict[user_id, Set[WebSocketConnection]]`，广播时遍历该用户的所有连接逐个 `send`（跳过发起这次推送的连接本身，避免自己推给自己造成一次无意义的拉取——可选优化，按连接 id 排除即可）。

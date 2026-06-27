# WebDAV 同步机制说明

本文档基于源码
`app/src/services/webdav/{WebDAVSync.ts,WebDAVPaths.ts,WebDAVClient.ts}`
与 `app/src/types/settings.ts` 中的 `WebDAVSettings` 整理，描述WebDAV 同步通
道的运行机制、目录结构、同步内容范围，以及与其他同步通道（Readest 原生 Supabase 同步、KOSync）的关系。

---

## 1. 定位：一条独立的、用户自建的同步通道

WebDAV 同步是与 Readest 原生云同步、KOSync、Readwise、Hardcover **并行的**
另一条同步通道，运行在用户自己的 WebDAV 服务器（Nextcloud、群晖 NAS 等）上，
完全独立于 Readest 官方账号体系——不需要登录 Readest 账号，只需在设置中填写
WebDAV 服务器地址 + 用户名/密码即可。

`WebDAVSettings`（`src/types/settings.ts:97`）字段：

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关 |
| `serverUrl` / `username` / `password` / `rootPath` | WebDAV 连接信息，`rootPath` 是用户在自己 WebDAV 空间内指定的根目录 |
| `syncProgress` | 子开关：是否同步阅读进度（config.json） |
| `syncNotes` | 子开关：是否同步笔记/标注（随 config.json 一起，见下） |
| `syncBooks` | 子开关：是否同步书籍文件本体 + 封面 |
| `strategy` | 冲突策略，与 KOSync 共用同一套词汇（`silent` / `send` / `receive` / `prompt`） |
| `deviceId` | 稳定的设备 ID（uuid），写入每次推送的 config 信封，用于追踪"最后写入设备" |
| `lastSyncedAt` | 上次成功同步的时间戳 |
| `syncLog` | 最近 10 次"立即同步"的诊断日志（环形缓冲区） |

---

## 2. 远端目录结构

整个同步功能被限定在 `<rootPath>/MyReader/` 子树下，不会触碰用户 WebDAV 空间
中的其他文件（`WebDAVPaths.ts`）：

```
<rootPath>/
  MyReader/
    library.json                 ← 共享的书库索引
    books/
      <bookHash>/
        <安全文件名>.<ext>        ← 书籍文件本体（仅 syncBooks=true 时上传）
        cover.png                 ← 封面（best-effort，仅 syncBooks=true 时上传）
        config.json               ← 阅读进度 + 标注/笔记（书签、高亮、划线笔记）
```

- 以 `bookHash`（书籍文件内容的部分 MD5）作为目录名，避免标题冲突，标题修改
  不会触发远端重命名。
- `library.json` 是跨设备共享的书库索引（`RemoteLibraryIndex`），记录所有
  已知书籍的元数据（`Book[]`）及整体 `updatedAt`。

---

## 3. 同步的内容范围

### 3.1 `config.json` —— 阅读进度 + 标注/笔记（核心同步内容）

每本书一个 `config.json`，结构为 `RemoteBookConfig`：

```ts
interface RemoteBookConfig {
  schemaVersion: 1;
  bookHash: string;
  metaHash?: string;
  config: Partial<BookConfig>;   // 仅包含下面"会同步的字段"
  booknotes: BookNote[];         // 书签 / 高亮划线 / 笔记
  writerDeviceId: string;
  writerVersion: 'myreader-webdav-1';
  updatedAt: number;             // 写入时的客户端墙钟时间
}
```

**会同步的 `BookConfig` 字段**（`buildRemotePayload` 中的 `trimmed`）：

- `progress`：阅读进度 `[当前页, 总页数]`
- `location`：当前位置的 CFI
- `xpointer`：当前位置的 XPointer（用于与 KOReader 互通）
- `updatedAt`：该配置的最后更新时间，用于按字段做 LWW（Last-Write-Wins）合并

**明确不同步**（即"设备本地偏好"，刻意被 `trimmed` 排除）：

- `viewSettings`（排版、字体、边距等显示设置）—— 不同设备屏幕尺寸/DPI 不同，
  不希望手机的字号设置覆盖桌面端
- `searchConfig`（搜索范围/选项）
- `rsvpPosition`（RSVP 阅读位置）

这一"白名单"既是推送时的裁剪依据，也是拉取合并时的过滤依据——服务器/远端
即使被篡改塞入 `viewSettings` 等字段，客户端在 `pullBookConfig` 时也会因
`filteredRemote` 的字段裁剪而忽略它们。

**`booknotes: BookNote[]`** —— 即书签、高亮/划线、笔记标注，字段包括：

```ts
interface BookNote {
  id: string;
  type: 'bookmark' | 'annotation' | 'excerpt';
  cfi: string;            // 标注位置
  xpointer0?: string; xpointer1?: string;
  page?: number;
  text?: string;          // 划线/摘录的原文
  style?: 'highlight' | 'underline' | 'squiggly';
  color?: string;
  note: string;           // 用户写的笔记内容
  global?: boolean;
  createdAt: number; updatedAt: number; deletedAt?: number | null;
}
```

是这条同步链路里**唯一负责同步书签/高亮/笔记的部分**——与 KOSync（只同步
阅读进度）和 Readest 原生 Replica 同步（只同步字典/字体/背景纹理/OPDS/设置）
都不重叠。

### 3.2 书籍文件本体与封面（`syncBooks` 开关）

仅当 `syncBooks: true` 时：

- `pushBookFile`：上传书籍二进制文件到 `<hash>/<安全标题>.<ext>`。先发
  `HEAD` 探测远端文件大小，若大小相同则视为"已是最新"跳过上传（不做内容
  hash 比较，仅按文件大小短路）。
- `pushBookCover`：上传封面到 `<hash>/cover.png`，同样的 HEAD+尺寸短路逻辑，
  失败仅作为警告（封面是 best-effort）。

但**下载侧不受 `syncBooks` 限制**：只要远端存在本地没有的书（通过
`library.json` 索引 + 扫描 `books/` 目录发现），无论 `syncBooks` 是否开启都
会被下载下来——因为"看到远端已有的书"本身就是同步的目的，存储成本已经由
推送方承担过了。下载到本地后，会顺带：
1. 下载封面（best-effort）
2. 拉取并合并 `config.json`（即第 3.1 节的进度+标注）

### 3.3 `library.json` —— 书库索引

```ts
interface RemoteLibraryIndex {
  schemaVersion: 1;
  books: Book[];     // 完整 Book 元数据（标题/作者/格式/标签/分组等）
  updatedAt: number;
}
```

每次"立即同步"结束后（只要允许写远端），都会把本地+远端合并后的全量书目
写回 `library.json`，作为后续发现远端新增/已删除书籍的索引来源。

---

## 4. 同步触发方式与流程（`syncLibrary`）

`syncLibrary(settings, books, options)` 是一次"立即同步"的入口，按
`strategy` 决定方向：

| `strategy` | 允许拉取（pull） | 允许推送（push） |
|---|---|---|
| `silent` / `prompt`（默认） | ✓ | ✓ |
| `send` | ✗ | ✓（只上传，不下载） |
| `receive` | ✓（只下载，不上传） | ✗ |

单次同步的步骤：

1. **拉取远端索引** `pullLibraryIndex`（失败不致命，仅警告）。
2. **发现远端独有的书**：
   - 来源一：`library.json` 中存在、本地不存在、且未被标记 `deletedAt` 的书；
   - 来源二：直接 `listDirectory` 扫描 `books/` 目录，兜底没有索引记录的
     "野" hash 目录（兼容老版本上传/索引漂移）。
   - 对每个候选 hash，再列出其 `books/<hash>/` 目录，找到真正的书籍文件
     （排除 `config.json`/`cover.png`），以这个文件的真实文件名推断
     标题/格式——而不是信任 `library.json` 里可能过期的字段。
3. **下载远端独有的书**（不受 `syncBooks` 限制）：写入文件 → 下载封面
   → 拉取合并 `config.json`（进度+标注）→ 加入本地书库。
4. **推送本地书**（排除刚下载的、排除本地已标记 `deletedAt` 的）：
   - 推送 `config.json`（进度+标注，按 `updatedAt`/`deletedAt` LWW 合并）；
   - 若 `syncBooks=true`：推送书籍文件（HEAD+尺寸短路）和封面；
5. **回写 `library.json`**（仅当允许推送时），把本地+远端合并后的全量书目
   写回，供其他设备下次发现。

### 4.1 合并/冲突策略细节

- **`config.json` 顶层字段**（`progress`/`location`/`xpointer`）：比较
  `remote.config.updatedAt`（或信封的 `updatedAt`）与本地 `updatedAt`，
  整体取较新一侧为基底，再用另一侧补齐缺失字段——即"按整条 config 的
  `updatedAt` 做粗粒度 LWW"，而不是逐字段比较。
- **`booknotes`（书签/高亮/笔记）**：逐条按 `id` 做合并（`mergeNotes`）——
  双方都有的笔记，取 `updatedAt` 更大、或 `deletedAt` 更新的一侧为主，
  另一侧字段补充合并；只在一侧存在的笔记直接保留。这一逻辑与 Readest 原生
  云同步中 `useNotesSync.ts` 的 `processNewNote` 保持一致的合并语义。
- **书籍文件/封面**：仅按"远端是否存在 + 文件大小是否一致"判断是否需要
  重新上传，不做按 `updatedAt` 的冲突判定——本质是"幂等上传"而非"双向合并"，
  因为同一个 `bookHash` 目录下理论上只会有一份内容相同的文件。
- **已删除的书**：本地 `deletedAt` 被设置的书既不会被推送，也不会触发远端
  目录清理（清理是 WebDAV 浏览面板里手动触发的"清理孤儿"功能，
  `deleteRemoteBookDir`），避免还没拉取到该删除标记的设备出现"幽灵消失"。

---

## 5. 与其他同步通道的对比

| 通道 | 同步范围 | 账号体系 |
|---|---|---|
| **WebDAV 同步**（本文档） | 阅读进度 + 书签/高亮/笔记（`config.json`），可选书籍文件+封面（`syncBooks`），书库索引 | 用户自建 WebDAV，无需 Readest 账号 |
| KOSync | 仅阅读进度（`document` MD5 + `progress` + `percentage`） | KOReader 兼容账号（独立用户名/密码） |
| Readest 原生 Replica 同步（`/api/sync/replicas`） | 字典、自定义字体、背景纹理、OPDS 订阅、应用设置（CRDT，字段级 LWW） | Readest 账号（Supabase） |
| Readest 原生 Legacy 同步（`/api/sync`） | 书籍元数据、阅读进度/配置、笔记（`books`/`configs`/`notes`，记录级 LWW） | Readest 账号（Supabase） |

可见 **"书签/高亮/笔记"** 在 WebDAV 通道和 Readest 原生 Legacy 同步通道中都
有覆盖（两者互不感知，用户可以同时开启，各自维护一份远端副本），而 KOSync
和 Replica 同步则完全不涉及标注内容。

Readest 电子书阅读器内置了两种主要的数据同步方案：其一是其原生基于 Supabase 的自研同步服务，其二是完全兼容主流开源的 KOReader Sync（KOSync）协议。这两套协议可以分别处理全平台（Tauri + Next.js）的无缝同步以及与各类墨水屏阅读器之间的跨设备进度互通。 [1, 2, 3, 4, 5]
有关其具体协议、实现机制和技术文档的详细信息如下：
## 一、 数据同步协议详解
Readest 的同步机制依场景分为以下两种协议实现：

   1. Readest Native Sync 协议（增量同步）
   * 技术基底：Readest 官方服务器基于 Supabase 实时后端 构建，在客户端则配合本地数据库（如加密的 [Turso/SQLite](https://github.com/readest/tauri-plugin-turso)）使用。
      * 协议特点：采用毫秒级增量同步算法与离线优先（Offline-First）设计。它不仅通过 RESTful/WebSocket 协议同步阅读进度，还能同步完整的书籍文件、高亮划线、笔记、自定义字体、字典及规则。 [2, 3, 4, 5, 6, 7, 8]
   2. KOSync 协议（KOReader 兼容协议）
   * 技术基底：基于标准的 [KOReader Sync Server RESTful API](https://github.com/readest/readest/issues/1729) 规范。
      * 协议特点：专用于阅读进度同步。客户端在打开、关闭书籍或定时（每10秒）向服务器的 /syncs/progress 接口发送请求。
      * 匹配机制：它使用书籍文件的二进制 MD5 校验和（Checksum）而非文件名来作为唯一标识符，确保跨设备（如 iPhone 与 Kobo 墨水屏）数据流的绝对精准。 [1, 3, 4, 9, 10, 11]

------------------------------
## 二、 技术文档与源码参考
Readest 是一个活跃的开源项目，官方并没有将文档独立拆分，而是将其直接作为开发者资源整合在代码库与社群中：

* 核心技术文档（Wiki）：关于如何配置多端同步、连接自建服务器或解决同步偏离，可以直接查阅官方维护的 [Readest GitHub Wiki：Sync with KOReader 指南](https://github.com/readest/readest/discussions/1838)。 [10]
* 同步逻辑源码（核心实现）：如果你需要研究它的底层数据交换协议，可以查阅代码库中的同步核心服务目录。具体路径为 src/services/sync/。 [12]
* KOReader 插件源码：Readest 为 KOReader 开发了专用的双向同步插件。如果你想深入其通信协议，可在其源码仓库下的 plugins/readest.koplugin 目录中直接查看。
* 协议生态扩展：如果你计划在 NAS 或自建服务器上跑兼容服务，可以参考生态内的第三方开源实现，例如使用 Gleam 语言重写的轻量级 [Cmooon/kosync 协议服务器](https://codeberg.org/Cmooon/kosync)。 [4]

如果需要，我可以为你提供 KOSync 协议的 RESTful API 接口请求与返回示例，或者提供本地自建 Docker 部署 KOSync 同步服务器的配置步骤。你更倾向于研究哪一部分？

[1] [https://www.reddit.com](https://www.reddit.com/r/koreader/comments/1mofa1q/newest_version_of_readest_syncs_progress_w/)
[2] [https://www.zhihu.com](https://www.zhihu.com/question/20230318)
[3] [https://blog.csdn.net](https://blog.csdn.net/gitblog_00297/article/details/153231155)
[4] [https://codeberg.org](https://codeberg.org/Cmooon/kosync)
[5] [https://www.reddit.com](https://www.reddit.com/r/opensource/comments/1ij0569/readest_a_fast_opensource_ebook_reader_with/?tl=zh-hans)
[6] [https://github.com](https://github.com/readest/readest/releases)
[7] [https://github.com](https://github.com/readest/tauri-plugin-turso)
[8] [https://meta.appinn.net](https://meta.appinn.net/t/topic/64506)
[9] [https://github.com](https://github.com/readest/readest/issues/1729)
[10] [https://github.com](https://github.com/readest/readest/discussions/1838)
[11] [https://github.com](https://github.com/readest/readest/issues/3122)
[12] [https://adg.csdn.net](https://adg.csdn.net/694d023c5b9f5f31781aca59.html)

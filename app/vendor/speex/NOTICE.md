# Speex 解码器（第三方组件）

`speex.min.js` / `bitstring.min.js` 来自 [jpemartins/speex.js](https://github.com/jpemartins/speex.js)
（用 emscripten 把 [libspeex](https://www.speex.org/) 1.2.0RC 编译成 JavaScript 的移植，libspeex 本身为
BSD-3-Clause），`pcmdata.min.js` 来自 [jussi-kalliokoski/pcmdata.js](https://github.com/jussi-kalliokoski/pcmdata.js)。
用于在浏览器里解码 MDict 词典自带的 Ogg Speex 发音文件。

**许可状况（2026-09-25 核实）**：两个上游仓库都没有 LICENSE 文件，README 里也没有许可声明，三个 min
构建产物自身不带许可头。未声明许可在法律上等同于保留所有权利——在向上游取得授权、或替换为有明确许可
的解码器之前，对外分发包含这三个文件的镜像存在合规风险。（同一份文件取自 poxenstudio/mydict 的 `frontend/public/speex/`。）

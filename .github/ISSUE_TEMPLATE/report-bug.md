---
name: 报个bug
about: 报告 bug 或功能回归
title: '示例：深色模式下滚动时右下角出现空白方块'
labels: ['type: bug']
assignees: ''
---

## Bug Description

简洁地描述当前的行为。
请同时添加现有应用的**截图**。

> **示例：**
> 在深色模式下，当显示滚动条时（例如在公司列表页面，列表中有足够多的公司），我们在右下角看到一个空白方块
> [截图]

## Expected behavior

简洁地描述期望的行为。

> **示例：**
> 空白方块应该是透明的（不可见）

## Technical inputs

操作系统：
MyReader 版本：
> **示例：**
> 操作系统：Android 14 (WebView 135.0)
> MyReader 版本：0.9.0
> 我们显示自定义滚动条，当用户不滚动时会消失。参见 ScrollWrapper。
> 可能可以通过 CSS 修复

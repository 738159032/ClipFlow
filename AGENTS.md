# AGENTS.md

本文件是 ClipFlow 的通用编码与验收规则。任何自动化代理或人工贡献者在修改本仓库前必须先读这里。

## 1. 技术基线

- Next.js 15（App Router）+ React 19 + TypeScript（strict）。
- 3D：`three` + `@react-three/fiber`（相机控制、阴影均使用 three 官方 addon / 内置材质，不额外引入 drei）。
- 状态：`zustand`（单一 store，纯 JSON 数据）。
- 视频导出：WebCodecs `VideoEncoder` + `mp4-muxer`（ISO-BMFF / H.264）。
- 不得为了"跑通"而引入未在 `docs/DECISIONS.md` 记录的重量级依赖。

## 2. 目录约定

```
src/app/            路由与页面（默认 Server Component）
src/components/     UI 组件（交互型组件必须 'use client'）
src/lib/            纯函数与领域逻辑（不得 import React）
src/store/          zustand store
src/hooks/          React 状态机/副作用封装
tests/unit/         vitest（node 环境，纯逻辑）
tests/e2e/          Playwright（真实 Chrome）
docs/               产品、架构、决策、任务、验收
```

依赖方向：`app → components → hooks → store → lib`。`lib` 不允许反向依赖 React 或组件。

## 3. 编码规则

1. **数据与运行时分离**：`ProjectConfig` 只能包含可 JSON 序列化的字段。THREE 对象、Canvas、Blob、Object URL 一律不得进入 store。
2. **单一动画真源**：预览与导出必须调用 `sampleAnimation()`，禁止在组件里另写一套旋转逻辑。
3. **单一 2D 光栅器**：2D 图层只能用 `src/lib/layers/render.ts` 绘制；禁止用 DOM 节点实现"预览用一套、导出用另一套"。
4. **归一化坐标**：图层几何只存 0–1 的 `rect` 与设计基准字号（`DESIGN_WIDTH = 1080`），不得存绝对像素。
5. **资源生命周期显式化**：创建 Object URL / THREE 资源 / Worker / 编码器的地方，必须同时写释放路径。
6. **交互只写归一化坐标**：图层交互（拖动/缩放/键盘）只能通过 `src/lib/layers/transform.ts` 的纯函数修改 `rect`；禁止把 `clientX/clientY`、`getBoundingClientRect` 的结果存进 store 或模块状态。
7. **拖拽期间禁止写 store**：pointermove 只更新本地 draft（canvas 重绘 + DOM style），指针抬起时才提交一次 `updateLayer`；单帧重绘必须用 rAF 合并。
8. **外部纹理必须打所有权标记**：图片贴图产生的 `THREE.Texture` 由 `ProductModel` 创建/释放，必须 `userData.external = true`；`disposeObject3D()` 只释放 GLB 自带贴图与"停放"的原始 map，禁止无差别 dispose 材质上的所有纹理。
9. **素材运行时对象集中管理**：图片的 Object URL / ImageBitmap / HTMLImageElement 只能存在 `src/lib/assets/registry.ts`；store 只允许 `ImageAssetMeta`。创建与释放必须成对（替换、移除、重置、卸载走 `release()` / `clear()`），禁止把 Blob 或解码结果塞进 config。
10. **错误必须可见**：加载、渲染、编码失败要落到 UI 状态与日志，不得 `catch {}` 后静默继续。
11. **状态机是唯一真相**：会改变风格/内容的 store 写操作必须经过 `markStyleEdit()` / `markContentEdit()`（`src/store/editor.ts`），被拒时直接放弃写入；禁止用 toast/短暂提示假装成功，也禁止在 `exporting` 状态下改动场景。
12. **不做隐式持久化**：业务数据不得写入 localStorage / IndexedDB / 服务端。需要持久化时先出设计并等待确认（见 DECISIONS D14）。
13. **不得伪造结果**：导出失败就是失败。禁止用 WebM 改名 `.mp4`、禁止用模拟下载冒充成功。
14. 新增公开函数需有 JSDoc 说明其职责与副作用。

## 4. 验收规则

提交前必须全部通过：

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run test        # vitest（纯逻辑）
npm run build       # next build
```

涉及 3D / 2D / 导出链路的改动，还必须运行：

```bash
npm run test:e2e    # Playwright + 本地 Chrome，真实编码 MP4
```

验收判据：

- 单元测试覆盖坐标换算、动画采样、MP4 结构解析等纯逻辑。
- e2e 必须验证：页面可加载、模型就绪、图层画布非空、下载文件是**真实 MP4**（`ftyp` + `moov` + `mdat`）且能在浏览器中播放。
- 文档中不得把未实现/未验证的能力标记为已完成；未验证项统一标注 `[待验证]`。

## 5. 明确禁止

- 在 `src/lib/**` 中 `import react` / `import * as THREE from 'three'` 之外引入 DOM 依赖（`scene/model.ts` 允许 THREE，因为它就是场景几何逻辑）。
- 在导出循环中使用 `html2canvas` 之类依赖 DOM 布局的截图方案。
- 在渲染循环里 `setState` 驱动 60fps 更新。
- 删除或覆盖用户已有修改（`agent.md` 等未跟踪文件不要动）。

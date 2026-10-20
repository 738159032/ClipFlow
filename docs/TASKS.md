# TASKS

状态图例：`[x]` 已完成并验证 · `[~]` 已实现待验证 · `[ ]` 未开始 · `[!]` 阻塞/未通过

## 阶段 0 · 工程初始化与关键技术验证（当前）

### 0.1 工程基线

- [x] package.json / tsconfig / next.config / eslint / vitest / playwright 配置
- [x] `.gitignore`、`AGENTS.md`、`docs/*`
- [x] `npm run typecheck` / `lint` / `test` / `build`（`npm run verify` 全绿）
- [x] 健康检查 `/api/health`

### 0.2 验证项 ①：客户端渲染与错误处理

- [x] `/lab` 页面挂载 R3F `<Canvas>`（`frameloop="always"`）
- [x] WebGL2 能力探测 + 不支持时降级提示
- [x] `SceneErrorBoundary` 捕获渲染异常并保留其余 UI
- [x] 模型 404 → `modelStatus=error` + 页面提示（e2e 覆盖）

### 0.3 验证项 ②：GLB 加载 / 居中 / 相机 / 释放

- [x] 命令式 `GLTFLoader` + 显式 cleanup
- [x] 包围盒自动居中 + 统一最长边到 2.4 世界单位
- [x] 配置驱动相机 + OrbitControls（three addon，无额外依赖）
- [x] `disposeObject3D` 统计几何体/材质/贴图数量并显示到 UI（e2e 断言通过）
- [x] 替换/卸载模型不重复持有（URL revoke + dispose）

### 0.4 验证项 ③：2D 图层与统一坐标

- [x] 归一化 `rect` + 设计基准宽 1080
- [x] 文字/价格标签/水印三种图层 + 属性面板
- [x] 预览覆盖层与导出共用 `drawLayers()`
- [x] 切换 9:16 / 1:1 / 16:9 位置不漂移（单测 + e2e）
- [x] 图层点选 / 拖动 / 四角缩放（捕获式命中测试，零新增依赖）
- [x] 键盘操作：方向键移动、Shift 快速移动、Ctrl/Cmd 缩放、Esc 取消选择
- [x] 触摸拖动（`touch-action: none`）不滚动页面
- [x] 拖拽期间不写 store、每帧最多一次重绘（rAF 合并）
- [x] a11y：每图层 `role=button` + `aria-label` + `aria-pressed` + 焦点框
- [x] 拖拽时禁用 OrbitControls，空白区域仍可旋转商品

### 0.5 验证项 ④：合成帧

- [x] `FrameCompositor`：背景 + WebGL 帧 + 2D 图层
- [x] 导出 PNG 静帧（1080×1920）

### 0.6 验证项 ⑤：MP4 导出

- [x] 固定分辨率/帧率/时长（1080×1920@30fps，时长取自动画配置）
- [x] H.264 能力探测（三个候选 profile + MediaRecorder 探测）
- [x] WebCodecs `VideoEncoder` + `mp4-muxer` 封装
- [x] 编码队列背压、进度回调、AbortController 取消
- [x] `encoder.close()` / `frame.close()` / canvas 释放
- [x] 导出后立即做 ISO-BMFF 结构校验，失败即报错
- [x] e2e：下载文件结构校验 + 浏览器内解码/seek + 抽帧确认 2D 文字与 3D 主体
- [x] 取消导出：状态退出、编码器释放、取消后可再次成功导出（e2e 通过）
- [x] 性能实测：1080×1920 / 150 帧 ≈ 57ms/帧（8.5s / 4.86MB）
- [ ] `[待验证]` 长视频（>15s）与 60fps 导出耗时、主线程阻塞情况
- [ ] `[待验证]` 移动端 Safari WebCodecs 支持
- [ ] `[待验证]` 编码器错误注入（`VideoEncoder.error` 回调路径未强制触发）
- [ ] `[待验证]` 无 H.264 环境下的明确失败提示（未在无专有编解码器浏览器实测）

### 0.7 未在本阶段实现（已记录）

- [ ] 图片素材上传 / 贴图替换
- [ ] 项目持久化（localStorage / 云端）
- [ ] 多场景拼接 / 音轨 / 关键帧时间轴
- [ ] 导出迁移 Worker（OffscreenCanvas）

## 阶段 1 · 编辑器 MVP（下一个入口）

1. 图层交互：canvas 命中测试 → 拖拽/缩放/旋转手柄，属性面板双向绑定。
2. 图片素材：上传 PNG/WebP → 作为图层或贴图（含 Object URL 生命周期）。
3. 工程持久化：`ProjectConfig` 存 localStorage + schema 版本迁移；资产元数据不存 Blob。
4. 导出增强：分辨率/码率预设、取消后资源复核、长视频性能（先测量再决定 Worker）。
5. 模板与图层联动规则的最终确认（见 DECISIONS D8）。

## 阶段 0 收尾状态

- typecheck / lint / unit / build：全部通过（`npm run verify`）。
- e2e：6/6 通过（真实 Chrome，含 2 次完整 MP4 导出）。
- 验收记录：`docs/ACCEPTANCE.md`；未验证项已登记在其中第 4 节。

## 阶段 1 增量 · 图片素材（已交付）

- [x] 图片素材入口：PNG / JPEG / WEBP，默认 50MB，点击选择 + 拖拽上传
- [x] 四层客户端校验：扩展名/MIME → 大小 → 魔数嗅探 → 解码结果（+16384px 尺寸上限）
- [x] UI 状态：文件名、大小、读取/解码进度、成功、中文错误
- [x] 「作为图片图层使用」真实生效：等比 rect、预览可拖动缩放、进入 PNG/MP4
- [x] 元数据（store）与运行时对象（`imageRegistry`）分离，store 不含 Blob/Bitmap/Element/Canvas
- [x] 释放矩阵：重复上传（未被引用）、移除素材、重置工程、离开编辑器、解码失败
- [x] 断言资源释放的 e2e：URL 创建/撤销计数 + ImageBitmap.close 计数
- [x] 商品材质贴图：`MaterialConfig.mapAssetId` + external 纹理所有权 + 停放/归还原始 map（e2e 像素级验证）
- [x] 上传取消按钮（AbortController + FileReader，取消后无残留）
- [x] 贴图占用保护：素材被贴图使用时拒绝移除、拒绝被"重复上传"释放
- [ ] 多素材库管理界面（当前为单槽 + 元数据表）

## 当前待办（阶段 1 入口）

1. 图层旋转手柄（当前旋转仅能通过属性面板滑杆）。
2. 图片素材：多素材库管理界面（当前单槽 + 库记录）、贴图 UV/投影编辑。
2. 图片素材上传（图层 + 贴图），沿用 Object URL + dispose 的生命周期模式。
3. 工程持久化（localStorage + schema 迁移）。
4. 导出性能复测（15s / 60fps），决定是否迁移 Worker。
5. 编码器错误注入测试 + 无 H.264 环境的失败提示实测。

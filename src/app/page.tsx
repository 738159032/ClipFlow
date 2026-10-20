import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="landing">
      <h1 className="landing__title">ClipFlow</h1>
      <p className="landing__sub">
        商品 3D 展示与短视频制作工具 · 阶段 0：工程初始化与关键技术验证
      </p>

      <div className="landing__card">
        <h2>当前阶段状态</h2>
        <table className="status-table">
          <thead>
            <tr>
              <th>验证项</th>
              <th>状态</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Next.js + TS 工程基线</td>
              <td className="tag-ok">已完成</td>
              <td>typecheck / lint / unit / build</td>
            </tr>
            <tr>
              <td>3D 客户端渲染 + 错误边界</td>
              <td className="tag-ok">已完成</td>
              <td>R3F Canvas, WebGL2 探测</td>
            </tr>
            <tr>
              <td>GLB 加载 / 居中 / 释放</td>
              <td className="tag-ok">已完成</td>
              <td>自动 framing + 显式 dispose</td>
            </tr>
            <tr>
              <td>2D 图层与归一化坐标</td>
              <td className="tag-ok">已完成</td>
              <td>预览与导出同一 Canvas2D 光栅器</td>
            </tr>
            <tr>
              <td>MP4 导出（WebCodecs H.264）</td>
              <td className="tag-ok">见验证报告</td>
              <td>真实封装 + 浏览器播放校验</td>
            </tr>
            <tr>
              <td>图片素材上传 / 贴图替换</td>
              <td className="tag-todo">未实现</td>
              <td>阶段 1</td>
            </tr>
            <tr>
              <td>图层直接拖拽 / 时间轴关键帧</td>
              <td className="tag-todo">未实现</td>
              <td>阶段 1</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="landing__card">
        <h2>技术验证台</h2>
        <p className="small muted">
          验证台会真实运行 3D 渲染、2D 合成与 MP4 编码。请在桌面版 Chrome / Edge 中打开，并保持硬件加速开启。
        </p>
        <div className="landing__links">
          <Link className="btn btn--primary" href="/lab">
            进入验证台
          </Link>
          <a className="btn btn--ghost" href="/api/health" target="_blank" rel="noreferrer">
            健康检查
          </a>
        </div>
      </div>

      <div className="landing__card">
        <h2>文档</h2>
        <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
          <li>docs/PRD.md · 产品目标与 MVP 范围</li>
          <li>docs/ARCHITECTURE.md · 模块边界与数据流</li>
          <li>docs/DECISIONS.md · 技术决策与风险</li>
          <li>docs/TASKS.md · 阶段计划</li>
          <li>docs/ACCEPTANCE.md · 验收标准与验证结果</li>
        </ul>
      </div>
    </main>
  );
}

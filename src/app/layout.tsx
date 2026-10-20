import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClipFlow · 3D 商品视频工作台',
  description: '3D 商品展示与短视频合成工具的工程基础（阶段 0 技术验证）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

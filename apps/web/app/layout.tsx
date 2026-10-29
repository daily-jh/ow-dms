import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OW-DMS 후원관리',
  description: '복지기관 후원금·후원품 관리 시스템(오픈소스, 합성자료 개발판)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Codespaces 등 앞단 프록시가 호스트를 바꾸는 환경에서 server action 출처 검사를 통과시킬 도메인(쉼표 구분, 예: *.app.github.dev)
  ...(process.env.SERVER_ACTIONS_ALLOWED_ORIGINS
    ? { experimental: { serverActions: { allowedOrigins: process.env.SERVER_ACTIONS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()) } } }
    : {}),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;

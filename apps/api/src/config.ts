export interface ApiConfig { databaseUrl: string; sessionSecret: string; devLoginEnabled: boolean; demoMode: boolean; piiKey: string; port: number; }

export function loadConfig(env = process.env): ApiConfig {
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const demoMode = env.DEMO_MODE === 'true';
  const devLoginEnabled = env.DEV_LOGIN_ENABLED === 'true';
  // 공개 시연판(합성자료 전용)만 운영 빌드에서 개발용 로그인을 허용한다. 실제 기관 운영은 OIDC.
  if (devLoginEnabled && env.NODE_ENV === 'production' && !demoMode) throw new Error('DEV_LOGIN_ENABLED must be false in production');
  if (!env.PII_ENCRYPTION_KEY && env.NODE_ENV === 'production') throw new Error('PII_ENCRYPTION_KEY is required in production');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://owdms_app:owdms_app_dev@localhost:5432/owdms',
    sessionSecret,
    devLoginEnabled,
    demoMode,
    piiKey: env.PII_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString('base64'),
    port: Number(env.API_PORT ?? 4000),
  };
}

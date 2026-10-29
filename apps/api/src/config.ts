export interface ApiConfig {
  databaseUrl: string;
  sessionSecret: string;
  devLoginEnabled: boolean;
  piiKey: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const devLoginEnabled = env.DEV_LOGIN_ENABLED === 'true';
  if (devLoginEnabled && env.NODE_ENV === 'production') throw new Error('DEV_LOGIN_ENABLED must be false in production');
  if (!env.PII_ENCRYPTION_KEY && env.NODE_ENV === 'production') throw new Error('PII_ENCRYPTION_KEY is required in production');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://owdms_app:owdms_app_dev@localhost:5432/owdms',
    sessionSecret,
    devLoginEnabled,
    // 개발 기본키는 합성자료 전용(seed와 동일)
    piiKey: env.PII_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString('base64'),
    port: Number(env.API_PORT ?? 4000),
  };
}

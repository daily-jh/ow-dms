import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const SECRET = 'x'.repeat(32);
const KEY = Buffer.alloc(32, 1).toString('base64');

describe('API 설정', () => {
  it('운영에서 개발용 로그인은 시연 모드가 아니면 거부한다', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: SECRET, PII_ENCRYPTION_KEY: KEY, DEV_LOGIN_ENABLED: 'true' }))
      .toThrow(/DEV_LOGIN_ENABLED/);
  });

  it('공개 시연판(DEMO_MODE=true)에서는 합성 계정 로그인을 허용한다', () => {
    const c = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: SECRET, PII_ENCRYPTION_KEY: KEY, DEV_LOGIN_ENABLED: 'true', DEMO_MODE: 'true' });
    expect(c.devLoginEnabled).toBe(true);
    expect(c.demoMode).toBe(true);
  });

  it('시연 모드여도 운영 빌드는 개인정보 암호화 키와 충분한 세션 키를 요구한다', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: SECRET, DEV_LOGIN_ENABLED: 'true', DEMO_MODE: 'true' }))
      .toThrow(/PII_ENCRYPTION_KEY/);
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short', PII_ENCRYPTION_KEY: KEY, DEMO_MODE: 'true' }))
      .toThrow(/SESSION_SECRET/);
  });
});

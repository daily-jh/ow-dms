import type pg from 'pg';
import { migrate } from './migrate';
import { seedMasterData, seedScenario } from './seed';

export interface BootstrapOptions {
  /** 앱 런타임 계정(owdms_app) 비밀번호. 지정하면 migration 기본값(개발용)을 덮어쓴다. */
  appPassword?: string;
  /** true일 때만, 그리고 기관이 하나도 없을 때만 합성 시연자료를 넣는다. */
  seedDemo: boolean;
  piiKey?: string;
  production: boolean;
}

/**
 * 배포 컨테이너 시작 시 1회 실행: migration → 앱 계정 비밀번호 교체 → (빈 DB이고 시연판이면) 합성자료.
 * 이미 자료가 있는 DB는 절대 다시 seed하거나 초기화하지 않는다.
 */
export async function bootstrap(
  owner: pg.Pool,
  makeAppPool: () => pg.Pool,
  opts: BootstrapOptions,
  log: (m: string) => void = () => undefined,
): Promise<{ seeded: boolean }> {
  if (opts.production && !opts.appPassword) throw new Error('APP_DB_PASSWORD is required in production');
  if (opts.production && opts.appPassword === 'owdms_app_dev') throw new Error('APP_DB_PASSWORD must not be the development default');
  await migrate(owner, log);
  if (opts.appPassword) {
    // ALTER ROLE은 바인드 변수를 받지 않으므로 quote_literal로 인용한 리터럴을 쓴다.
    const { rows } = await owner.query<{ q: string }>('select quote_literal($1) as q', [opts.appPassword]);
    await owner.query(`alter role owdms_app password ${rows[0]!.q}`);
    log('app role password updated');
  }
  if (!opts.seedDemo) return { seeded: false };
  const { rows } = await owner.query<{ n: string }>('select count(*)::text as n from tenants');
  if (rows[0]!.n !== '0') {
    log('tenants already exist; demo seed skipped');
    return { seeded: false };
  }
  await seedMasterData(owner);
  const app = makeAppPool();
  try {
    await seedScenario(app, opts.piiKey);
  } finally {
    await app.end();
  }
  log('demo seed inserted (synthetic data only)');
  return { seeded: true };
}

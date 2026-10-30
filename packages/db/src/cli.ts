import { createPool } from './pool';
import { migrate } from './migrate';
import { resetDatabase, seedMasterData, seedScenario } from './seed';
import { bootstrap } from './bootstrap';
import { createInstitutionAdmin } from './admin';
import { hashPassword, temporaryPassword } from '@owdms/domain';

const cmd = process.argv[2];
const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres@localhost:5432/owdms';
const appUrl = process.env.DATABASE_URL ?? 'postgres://owdms_app:owdms_app_dev@localhost:5432/owdms';
const owner = createPool(ownerUrl, 2);
const app = createPool(appUrl, 4);
try {
  if (cmd === 'reset') {
    await resetDatabase(owner);
    await migrate(owner, console.log);
    await seedMasterData(owner);
    console.log(await seedScenario(app));
  } else if (cmd === 'migrate') {
    await migrate(owner, console.log);
  } else if (cmd === 'seed') {
    await seedMasterData(owner);
    console.log(await seedScenario(app));
  } else if (cmd === 'bootstrap') {
    // 비밀번호 교체 후 접속해야 하므로 앱 pool은 bootstrap 안에서 새로 만든다.
    await bootstrap(owner, () => createPool(appUrl, 2), {
      appPassword: process.env.APP_DB_PASSWORD || undefined,
      seedDemo: process.env.DEMO_MODE === 'true',
      piiKey: process.env.PII_ENCRYPTION_KEY || undefined,
      production: process.env.NODE_ENV === 'production',
    }, console.log);
  } else if (cmd === 'create-admin') {
    // 사용: cli.ts create-admin <기관코드> <기관이름> <아이디> <이름>
    const [tenantCode, tenantName, username, displayName] = process.argv.slice(3);
    if (!tenantCode || !tenantName || !username || !displayName || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
      console.error('usage: cli.ts create-admin <기관코드> <기관이름> <아이디(영문 소문자·숫자 3~32자)> <이름>');
      process.exitCode = 2;
    } else {
      const temp = temporaryPassword();
      const r = await createInstitutionAdmin(owner, { tenantCode, tenantName, username, displayName }, await hashPassword(temp));
      console.log(r.tenantCreated ? `기관 생성: ${tenantName} (${tenantCode})` : `기존 기관에 추가: ${tenantCode}`);
      console.log(`관리자 아이디: ${username}`);
      // 임시 비밀번호는 이 화면에만 한 번 표시된다(저장·로그 금지). 첫 로그인 때 바꾸고 2단계 인증을 등록한다.
      console.log(`임시 비밀번호: ${temp}`);
    }
  } else {
    console.error('usage: cli.ts migrate|seed|reset|bootstrap|create-admin');
    process.exitCode = 2;
  }
} finally {
  await owner.end();
  await app.end();
}

import { createPool } from './pool';
import { migrate } from './migrate';
import { resetDatabase, seedMasterData, seedScenario } from './seed';

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
  } else {
    console.error('usage: cli.ts migrate|seed|reset');
    process.exitCode = 2;
  }
} finally {
  await owner.end();
  await app.end();
}

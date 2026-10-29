import { createPool } from '@owdms/db';
import { processOutboxOnce } from './process';

const pool = createPool(process.env.DATABASE_URL ?? 'postgres://owdms_app:owdms_app_dev@localhost:5432/owdms', 4);
const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 2000);
let stopping = false;
process.on('SIGTERM', () => (stopping = true));
process.on('SIGINT', () => (stopping = true));

console.log('OW-DMS worker started');
while (!stopping) {
  const n = await processOutboxOnce(pool, { log: console.error }).catch((e) => {
    console.error('worker loop error', (e as Error).message);
    return 0;
  });
  if (n === 0) await new Promise((r) => setTimeout(r, intervalMs));
}
await pool.end();

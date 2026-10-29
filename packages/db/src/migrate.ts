import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** 순서대로 SQL migration을 적용한다. 적용된 파일의 해시가 바뀌면 중단한다. */
export async function migrate(pool: pg.Pool, log: (m: string) => void = () => undefined): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);
    await client.query('select pg_advisory_lock(727001)');
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const done = new Map(
      (await client.query<{ name: string; sha256: string }>('select name, sha256 from schema_migrations')).rows.map((r) => [
        r.name,
        r.sha256,
      ]),
    );
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const prev = done.get(file);
      if (prev) {
        if (prev !== hash) throw new Error(`migration ${file} changed after being applied`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name, sha256) values ($1, $2)', [file, hash]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query('select pg_advisory_unlock(727001)').catch(() => undefined);
    client.release();
  }
  return applied;
}

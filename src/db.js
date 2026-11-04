// Database access. Uses real PostgreSQL when DATABASE_URL is set (production),
// otherwise an embedded Postgres (PGlite) stored in ./data for local testing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let impl = null;

export async function connect({ url = process.env.DATABASE_URL, memory = false } = {}) {
  if (url) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(1082, (v) => v); // DATE -> 'YYYY-MM-DD'
    pg.types.setTypeParser(20, (v) => v); // BIGINT -> string
    const ssl = /sslmode=require|railway|supabase|neon/.test(url) && !/localhost|\.internal/.test(url)
      ? { rejectUnauthorized: false } : undefined;
    const pool = new pg.Pool({ connectionString: url, ssl, max: 5 });
    impl = {
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const opts = { parsers: { 1082: (v) => v, 20: (v) => String(v) } };
    if (!memory) opts.dataDir = path.join(here, '..', 'data');
    const db = new PGlite(opts);
    impl = {
      query: (text, params) => db.query(text, params),
      exec: (text) => db.exec(text),
      close: () => db.close(),
    };
  }
  await migrate();
  return impl;
}

export async function q(text, params = []) {
  const r = await impl.query(text, params);
  return r.rows;
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

export async function close() {
  if (impl) await impl.close();
  impl = null;
}

async function migrate() {
  const sql = readFileSync(path.join(here, 'schema.sql'), 'utf8');
  await impl.exec(sql);
}

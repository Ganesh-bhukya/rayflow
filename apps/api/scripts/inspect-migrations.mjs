import dotenv from 'dotenv';
import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const migrationsDir = path.resolve(new URL(import.meta.url).pathname.replace(/(^[A-Za-z]:)/, (m) => m), '../../src/infrastructure/database/migrations');

function winPath(p) {
  return p.replace(/^\//, '');
}

async function listLocalMigrations() {
  try {
    // adjust path for Windows if needed
    const p = process.platform === 'win32' ? winPath(migrationsDir) : migrationsDir;
    const files = await fs.readdir(p);
    return files.filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    return { error: `Failed to list migrations folder: ${String(err)}` };
  }
}

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set in environment.');
    process.exit(2);
  }

  const pool = new Pool({ connectionString });

  try {
    console.log('Local migration files (in repo):');
    const local = await listLocalMigrations();
    console.log(JSON.stringify(local, null, 2));

    console.log('\nQuerying database for all user tables (read-only)...');
    const tablesRes = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type='BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    `);

    const tables = tablesRes.rows;
    console.log(JSON.stringify(tables, null, 2));

    console.log('\nLooking for migration-related tables (name ILIKE "%migr%")...');
    const migrRes = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name ILIKE '%migr%'
      ORDER BY table_name;
    `);

    const migrTables = migrRes.rows.map((r) => r.table_name);
    console.log(JSON.stringify(migrTables, null, 2));

    for (const t of migrTables) {
      console.log(`\nContents of migration table: ${t} (first 50 rows)`);
      try {
        const r = await pool.query(`SELECT * FROM public."${t}" LIMIT 50`);
        console.log(JSON.stringify(r.rows, null, 2));
      } catch (err) {
        console.log(`  Failed to read table ${t}: ${String(err)}`);
      }
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error while inspecting migrations/tables:', String(err));
    await pool.end().catch(() => {});
    process.exit(3);
  }
}

run();

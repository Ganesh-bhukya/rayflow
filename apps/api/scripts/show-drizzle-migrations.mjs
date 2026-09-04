import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(2);
  }
  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_name ILIKE '%migr%'
      ORDER BY table_schema, table_name;
    `);
    const migrTables = res.rows;
    console.log('Migration-like tables found:');
    console.log(JSON.stringify(migrTables, null, 2));

    for (const row of migrTables) {
      const schema = row.table_schema;
      const table = row.table_name;
      console.log(`\nSelecting top rows from ${schema}.${table}:`);
      try {
        const q = `SELECT * FROM ${schema}."${table}" ORDER BY 1 DESC LIMIT 50`;
        const r = await pool.query(q);
        console.log(JSON.stringify(r.rows, null, 2));
      } catch (err) {
        console.log(`  Failed to read ${schema}.${table}: ${String(err)}`);
      }
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', String(err));
    await pool.end().catch(() => {});
    process.exit(3);
  }
}

run();

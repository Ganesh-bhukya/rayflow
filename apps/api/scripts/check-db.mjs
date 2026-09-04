import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: './.env' });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set in apps/api/.env');
  process.exit(2);
}

// Redact password for safe logging
const redacted = dbUrl.replace(/:(?:[^:@]+)@/, ':REDACTED@');
console.log('Using DATABASE_URL (redacted):', redacted);

const pool = new Pool({ connectionString: dbUrl });

(async () => {
  try {
    const res = await pool.query('SELECT current_database() AS db, current_user AS user, NOW() as now');
    console.log('Connection successful:', {
      database: res.rows[0].db,
      user: res.rows[0].user,
      now: res.rows[0].now,
    });
    process.exit(0);
  } catch (err) {
    console.error('Connection failed:', err?.message ?? String(err));
    process.exit(3);
  } finally {
    await pool.end().catch(() => {});
  }
})();

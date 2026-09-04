import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run(){
  try{
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM public.users)::int as users,
        (SELECT COUNT(*) FROM public.merchants)::int as merchants,
        (SELECT COUNT(*) FROM public.customers)::int as customers,
        (SELECT COUNT(*) FROM public.payment_orders)::int as orders,
        (SELECT COUNT(*) FROM public.payment_attempts)::int as attempts,
        (SELECT COUNT(*) FROM public.transactions)::int as transactions,
        (SELECT COUNT(*) FROM public.refunds)::int as refunds
    `);
    console.log('counts:', counts.rows[0]);

    const txs = await pool.query('SELECT id, order_id, attempt_id, amount, status, created_at FROM public.transactions ORDER BY created_at DESC LIMIT 20');
    console.log('transactions rows:', txs.rows);

    const atts = await pool.query('SELECT id, order_id, status, provider_reference FROM public.payment_attempts ORDER BY created_at DESC LIMIT 20');
    console.log('attempts rows:', atts.rows);

    await pool.end();
  }catch(err){
    console.error(err);
    await pool.end().catch(()=>{});
  }
}

run();

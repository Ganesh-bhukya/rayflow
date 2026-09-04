import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not set in environment');
  process.exit(2);
}

const pool = new Pool({ connectionString });

async function findOne(query, params, clientOverride){
  const runner = clientOverride ?? pool;
  const r = await runner.query(query, params);
  return r.rows[0];
}

async function run(){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');

    // 1) user
    const userEmail = 'seed-admin@rayflow.local';
    let user = await findOne('SELECT id FROM public.users WHERE email=$1', [userEmail], client);
    let userId;
    if(user){
      userId = user.id;
    } else {
      const r = await client.query(
        `INSERT INTO public.users (email, password_hash, first_name, last_name, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [userEmail, 'seed-hash', 'Seed', 'Admin']
      );
      userId = r.rows[0].id;
      console.log('Inserted user', userEmail);
    }

    // 2) customer
    const custEmail = 'seed-customer@rayflow.local';
    let customer = await findOne('SELECT id FROM public.customers WHERE email=$1', [custEmail], client);
    let customerId;
    if(customer){
      customerId = customer.id;
    } else {
      const r = await client.query(
        `INSERT INTO public.customers (email, name, phone) VALUES ($1,$2,$3) RETURNING id`,
        [custEmail, 'Seed Customer', '+911234567890']
      );
      customerId = r.rows[0].id;
      console.log('Inserted customer', custEmail);
    }

    // 3) merchant
    const merchantCode = 'SEED_MERCHANT_001';
    let merchant = await findOne('SELECT id FROM public.merchants WHERE merchant_code=$1', [merchantCode], client);
    let merchantId;
    if(merchant){
      merchantId = merchant.id;
    } else {
      const r = await client.query(
        `INSERT INTO public.merchants (user_id, business_name, merchant_code, is_active)
         VALUES ($1,$2,$3,true) RETURNING id`,
        [userId, 'Seed Merchant Co', merchantCode]
      );
      merchantId = r.rows[0].id;
      console.log('Inserted merchant', merchantCode);
    }

    // 4) payment orders (3 orders)
    for(let i=1;i<=3;i++){
      const idempotency = `seed_order_${i}`;
      let order = await findOne('SELECT id FROM public.payment_orders WHERE idempotency_key=$1', [idempotency], client);
      let orderId;
      if(order){
        orderId = order.id;
      } else {
        const amount = 10000 * i; // in paise
        const r = await client.query(
          `INSERT INTO public.payment_orders (merchant_id, customer_id, amount, currency, status, idempotency_key)
           VALUES ($1,$2,$3,$4,'created',$5) RETURNING id`,
          [merchantId, customerId, amount, 'INR', idempotency]
        );
        orderId = r.rows[0].id;
        console.log('Inserted payment_order', idempotency);
      }

      // 5) payment_attempts: if none for this order, create one
      const existingAttempt = await findOne('SELECT id, status FROM public.payment_attempts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1', [orderId], client);
      let attemptId;
      if(existingAttempt){
        attemptId = existingAttempt.id;
      } else {
        const pm = i % 2 === 0 ? 'netbanking' : 'card';
        const status = i === 1 ? 'failed' : 'success';
        const r = await client.query(
          `INSERT INTO public.payment_attempts (order_id, payment_method, status, provider_reference)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [orderId, pm, status, `seed_pr_${i}`]
        );
        attemptId = r.rows[0].id;
        console.log('Inserted payment_attempt for order', orderId, 'status', status);
      }

      // 6) transactions: if a success attempt exists and no transaction exists, create one
      const attemptRow = await findOne('SELECT id, status FROM public.payment_attempts WHERE id=$1', [attemptId], client);
      const hasTx = await findOne('SELECT id FROM public.transactions WHERE attempt_id=$1', [attemptId], client);
      if(attemptRow?.status === 'success' && !hasTx){
        const r = await client.query(
          `INSERT INTO public.transactions (order_id, attempt_id, amount, currency, type, status)
           VALUES ($1,$2,$3,$4,'payment','success') RETURNING id`,
          [orderId, attemptId, 10000 * i, 'INR']
        );
        console.log('Inserted transaction for attempt', attemptId);
      }

      // 7) refunds: for order 2, create a refund if transaction exists and no refund
      if(i===2){
        const tx = await findOne('SELECT id FROM public.transactions WHERE order_id=$1 LIMIT 1', [orderId], client);
        if(tx){
          const hasRefund = await findOne('SELECT id FROM public.refunds WHERE transaction_id=$1', [tx.id], client);
          if(!hasRefund){
            await client.query(
              `INSERT INTO public.refunds (transaction_id, amount, status, reason) VALUES ($1,$2,'pending','Test refund')`,
              [tx.id, 5000]
            );
            console.log('Inserted refund for transaction', tx.id);
          }
        }
      }

    }

    await client.query('COMMIT');
    console.log('Seed completed successfully');
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('Seed failed:', String(err));
    process.exitCode = 3;
  }finally{
    client.release();
    await pool.end();
  }
}

run();

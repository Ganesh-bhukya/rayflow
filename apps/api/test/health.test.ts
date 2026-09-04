import request from 'supertest';
import app from '../src/app.js';

async function run() {
  try {
    const res = await request(app).get('/health');
    if (res.status !== 200) {
      console.error('GET /health returned non-200 status:', res.status, res.text);
      process.exit(2);
    }
    console.log('GET /health response body:', JSON.stringify(res.body));
    process.exit(0);
  } catch (err: any) {
    console.error('Health test failed:', err?.message ?? err);
    process.exit(3);
  }
}

run();

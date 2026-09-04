import request from 'supertest';
import app from '../src/app.js';
async function run() {
    try {
        const res = await request(app).get('/health/db').timeout({ deadline: 10000 });
        if (res.status !== 200) {
            console.error('GET /health/db returned non-200 status:', res.status, res.text);
            process.exit(2);
        }
        console.log('GET /health/db response body:', JSON.stringify(res.body));
        process.exit(0);
    }
    catch (err) {
        console.error('DB health test failed:', err?.message ?? err);
        process.exit(3);
    }
}
run();
//# sourceMappingURL=db.test.js.map
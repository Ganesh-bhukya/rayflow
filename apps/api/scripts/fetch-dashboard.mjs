const API = 'http://localhost:4000';

async function run(){
  for (const path of ['/dashboard/metrics', '/dashboard/recent-transactions?limit=5']){
    try{
      const res = await fetch(API+path);
      const text = await res.text();
      console.log('===', path, 'status=', res.status);
      console.log(text);
    }catch(err){
      console.error('ERR', path, err.toString());
    }
  }
}

run();

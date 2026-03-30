import app from './src/app';
import { initPool, closePool } from './src/db/connection';

async function testApi() {
  await initPool();
  // @ts-ignore
  const res = {
    json: (data: any) => {
      console.log('API Response:', JSON.stringify(data, null, 2));
    },
    status: (code: number) => {
      console.log('Status Code:', code);
      return res;
    }
  };

  // @ts-ignore
  const req = {};

  const characterRoutes = require('./src/characters/routes/character-routes').default;
  // We need to find the GET / route handler
  const layer = characterRoutes.stack.find((s: any) => s.route && s.route.path === '/');
  if (layer) {
    try {
      await layer.route.stack[0].handle(req, res, (err: any) => {
        if (err) console.error('Next error:', err);
      });
    } catch (e) {
      console.error('Catch error:', e);
    }
  } else {
    console.log('Route not found');
  }

  await closePool();
}

testApi();

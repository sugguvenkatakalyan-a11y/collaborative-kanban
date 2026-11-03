const http = require('http');
require('./models'); // register models before syncing indexes
const env = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');
const { initSockets } = require('./sockets');

async function start() {
  await connectDB();
  const server = http.createServer(app);
  initSockets(server);
  server.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}  (REST: /api, WebSocket: socket.io)`);
  });

  const shutdown = () => {
    console.log('\n[api] shutting down');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('[api] failed to start:', err.message);
  process.exit(1);
});

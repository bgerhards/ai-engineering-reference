import { createHttpServer } from './adapters/inbound/http/server.js';
import { createAppRouter, createDefaultAdapters } from './composition/container.js';

const port = Number(process.env['PORT'] ?? 3000);

const server = createHttpServer(createAppRouter(createDefaultAdapters()));

server.listen(port, () => {
  console.log(`app-sample listening on http://localhost:${String(port)}`);
});

const shutdown = (): void => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

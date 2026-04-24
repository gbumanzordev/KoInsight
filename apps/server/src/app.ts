import cors from 'cors';
import express, { Request, Response } from 'express';
import { Server } from 'http';
import morgan from 'morgan';
import path from 'path';
import { openAiRouter } from './ai/open-ai-router';
import { booksRouter } from './books/books-router';
import { appConfig } from './config';
import { devicesRouter } from './devices/devices-router';
import { runBackfill } from './enrichment/backfill';
import { startEnrichmentWorker, type EnrichmentWorker } from './enrichment/worker';
import { db } from './knex';
import { kopluginRouter } from './koplugin/koplugin-router';
import { kosyncRouter } from './kosync/kosync-router';
import { openLibraryRouter } from './open-library/open-library-router';
import { statsRouter } from './stats/stats-router';
import { uploadRouter } from './upload/upload-router';

async function setupServer() {
  const app = express();
  // Increase the limit to be able to upload the whole database
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(morgan('tiny'));

  // if (appConfig.env === 'development') {
  // Allow requests from dev build
  app.use(cors({ origin: '*' }));
  // }

  app.use('/', kosyncRouter); // Needs to be mounted at root to follow KoSync API
  app.use('/api/plugin', kopluginRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/books', booksRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/upload', uploadRouter);
  app.use('/api/open-library', openLibraryRouter);
  app.use('/api/ai', openAiRouter);

  // Serve react app
  app.use(express.static(appConfig.webBuildPath));
  app.get(/.*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(appConfig.webBuildPath, 'index.html'));
  });

  // Start :)
  const server = app.listen(appConfig.port, appConfig.hostname, () => {
    console.info(`KoInsight back-end is running on http://${appConfig.hostname}:${appConfig.port}`);
    // D-11: kick off backfill AFTER app.listen without blocking the event loop.
    setImmediate(() => {
      runBackfill(db).catch((err) => console.warn('Backfill failed:', err));
    });
  });

  return server;
}

async function stopServer(
  signal: NodeJS.Signals,
  server: Server,
  worker: EnrichmentWorker
) {
  console.log(`Received ${signal.toString()}. Gracefully shutting down...`);
  // Guarantee the process exits even if server.close() never drains. Keep-alive
  // connections or long-running uploads can otherwise hold the listener open
  // past any container grace period.
  const forceExit = setTimeout(() => {
    console.warn('Forced exit after 10s grace period');
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  await worker.stop();
  server.close(() => {
    clearTimeout(forceExit);
    console.log('Server closed.');
    process.exit(0);
  });
}

async function main() {
  console.log('Running database migrations');
  await db.migrate.latest({ directory: path.join(__dirname, 'db', 'migrations') });
  console.log('Database migrated successfully');

  // D-03 + D-05: start the worker (which runs the crash-recovery sweep) BEFORE
  // binding the HTTP listener so no job can be claimed twice and the sync
  // endpoints are up only once the worker is already polling.
  const worker = startEnrichmentWorker(db);

  setupServer()
    .then((server) => {
      process.on('SIGINT', (signal) => stopServer(signal, server, worker));
      process.on('SIGTERM', (signal) => stopServer(signal, server, worker));
    })
    .catch((err) => {
      console.error('setupServer failed:', err);
      process.exit(1);
    });
}

main().catch((err) => {
  console.error('Fatal startup failure:', err);
  process.exit(1);
});

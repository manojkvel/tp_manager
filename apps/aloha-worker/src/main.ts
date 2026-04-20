// TASK-066 — Aloha worker: scheduled ingestion from watched folder / SFTP.
// TASK-068 — Heartbeat emitter. App Insights alert fires if we go > 15 min
// without a heartbeat record (design-review LOW #9, DoD#12).
//
// The worker exposes /healthz for liveness and /heartbeat for the last tick;
// real ingestion logic is pluggable (poll local FS in dev, SFTP in prod).

import Fastify from 'fastify';
import { readdirSync, readFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface Heartbeat { last_tick_at: string; files_processed: number; failures: number }

const state: Heartbeat = { last_tick_at: new Date(0).toISOString(), files_processed: 0, failures: 0 };

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/healthz', async () => ({
  status: 'ok',
  service: 'aloha-worker',
  version: process.env.APP_VERSION ?? '0.1.0',
  timestamp: new Date().toISOString(),
}));

app.get('/heartbeat', async () => state);

async function forwardToApi(rows: readonly (readonly string[])[]): Promise<void> {
  const apiUrl = process.env.API_URL;
  const token = process.env.WORKER_API_TOKEN;
  if (!apiUrl || !token) return;
  const res = await fetch(`${apiUrl}/api/v1/aloha/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ source: 'middleware', rows }),
  });
  if (!res.ok) throw new Error(`api rejected: ${res.status}`);
}

function parseCsv(body: string): string[][] {
  return body
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(',').map((s) => s.trim()));
}

async function tick(): Promise<void> {
  const watchDir = process.env.ALOHA_WATCH_DIR ?? '/var/aloha/in';
  const processedDir = process.env.ALOHA_PROCESSED_DIR ?? '/var/aloha/processed';
  if (!existsSync(watchDir)) mkdirSync(watchDir, { recursive: true });
  if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

  const files = readdirSync(watchDir).filter((f) => f.endsWith('.csv') || f.endsWith('.xlsx'));
  for (const f of files) {
    try {
      const rows = parseCsv(readFileSync(join(watchDir, f), 'utf8'));
      await forwardToApi(rows);
      renameSync(join(watchDir, f), join(processedDir, f));
      state.files_processed += 1;
      app.log.info({ file: f }, 'pmix forwarded to API');
    } catch (err) {
      state.failures += 1;
      app.log.error({ err, file: f }, 'pmix forward failed');
    }
  }
  state.last_tick_at = new Date().toISOString();
}

const port = Number(process.env.PORT ?? 3002);
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

const TICK_MS = Number(process.env.TICK_MS ?? 60_000);
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => { void tick(); }, TICK_MS);
  app.log.info({ every_ms: TICK_MS }, 'aloha-worker tick scheduler started');
}

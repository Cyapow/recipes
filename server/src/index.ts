import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { startBackupSchedule } from './backup/schedule.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const config = loadConfig(process.env);
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'recipes.sqlite'));
const app = buildApp({ config, db });
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`recipes listening on ${config.port}`);

const schedule = startBackupSchedule({
  hour: config.backupHour,
  run: async () => {
    const out = await app.backup.runNow();
    if (out.status === 'busy') console.log('scheduled backup skipped: a backup is already running');
    else if (out.status === 'not_connected') console.log('scheduled backup skipped: Google Drive not connected');
    else if (out.result.ok) console.log(`scheduled backup done (${out.result.uploadedImages} images)`);
    else console.error(`scheduled backup failed: ${out.result.error}`);
  },
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  schedule.stop();
  try {
    await app.close();
  } finally {
    db.close();
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

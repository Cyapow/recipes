import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const config = loadConfig(process.env);
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'recipes.sqlite'));
const app = buildApp({ config, db });
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`recipes listening on ${config.port}`);

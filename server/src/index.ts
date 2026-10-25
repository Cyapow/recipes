import Database from 'better-sqlite3';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
// Placeholder in-memory DB until openDb (Task 2) lands.
const app = buildApp({ config, db: new Database(':memory:') });
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`recipes listening on ${config.port}`);

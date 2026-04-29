require('dotenv').config();

import path from 'path';

const BASE_PATH = __dirname;
const DATA_PATH = process.env.DATA_PATH || path.resolve(BASE_PATH, '../../../', 'data');
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB) || 100;

const UPLOAD_DB_FILENAME = 'statistics.sqlite3';

const REPORT_TZ_RAW = process.env.REPORT_TZ ?? 'UTC';
let REPORT_TZ = REPORT_TZ_RAW;
try {
  // Validate the IANA zone once at module load. Throws RangeError on invalid.
  new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TZ_RAW });
} catch {
  console.error(`Invalid REPORT_TZ='${REPORT_TZ_RAW}', falling back to UTC`);
  REPORT_TZ = 'UTC';
}

export const appConfig = {
  hostname: process.env.HOSTNAME || '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  env: process.env.NODE_ENV,

  // Admin endpoints (`/api/admin/*`) are gated behind this flag until proper
  // auth middleware lands. Off by default because CORS is currently `*`.
  adminEnabled: process.env.ADMIN_ENABLED === 'true',

  coversPath: path.resolve(DATA_PATH, 'covers'),

  dataPath: DATA_PATH,

  webBuildPath: path.join(BASE_PATH, '../../web/dist'),

  upload: {
    filename: UPLOAD_DB_FILENAME,
    path: path.resolve(DATA_PATH, UPLOAD_DB_FILENAME),
    maxFileSizeMegaBytes: MAX_FILE_SIZE_MB,
  },

  db: {
    dev: path.resolve(DATA_PATH, 'dev.sqlite3'),
    prod: path.resolve(DATA_PATH, 'prod.sqlite3'),
  },

  reports: {
    timeZone: REPORT_TZ,
  },
};

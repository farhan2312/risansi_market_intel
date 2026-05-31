import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var _risansiPool: Pool | undefined;
}

const risansiPool: Pool =
  global._risansiPool ??
  new Pool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.RISANSI_DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      { rejectUnauthorized: false },
    // Serverless-friendly settings: time out fast, keep pool small,
    // release idle connections quickly.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis:       30_000,
    max:                     10,
  });

if (process.env.NODE_ENV !== 'production') {
  global._risansiPool = risansiPool;
}

export default risansiPool;

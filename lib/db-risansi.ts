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
    // Keep connections warm between requests so we don't pay a TLS
    // handshake to a far-region DB on every page load. A larger pool
    // lets multi-query pages (e.g. 6 parallel queries) run in one wave.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis:       300_000, // 5 min — hold idle connections open
    max:                     15,
  });

if (process.env.NODE_ENV !== 'production') {
  global._risansiPool = risansiPool;
}

export default risansiPool;

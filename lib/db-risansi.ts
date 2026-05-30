import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var _risansiPool: Pool | undefined;
}

const risansiPool: Pool =
  global._risansiPool ??
  new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.RISANSI_DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== 'production') {
  global._risansiPool = risansiPool;
}

export default risansiPool;

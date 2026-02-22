require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const dbDir = path.join(__dirname, '../db');
    const files = fs.readdirSync(dbDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM _migrations WHERE filename = $1',
        [file]
      );
      if (rowCount > 0) {
        console.log(`[migrate] skip ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(dbDir, file), 'utf8');
      console.log(`[migrate] apply ${file}`);
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    }

    console.log('[migrate] done');
  } finally {
    client.release();
  }
}

module.exports = migrate;

'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'ocr_engine',
    user: process.env.DB_USER || 'ocr_user',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  console.log('Connected to MySQL. Running migrations...');

  const migrationFiles = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    console.log(`Applying: ${file}`);
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    try {
      await conn.query(sql);
      console.log(`  ✓ ${file} applied`);
    } catch (err) {
      console.error(`  ✗ Error in ${file}: ${err.message}`);
      await conn.end();
      process.exit(1);
    }
  }

  await conn.end();
  console.log('All migrations complete.');
}

runMigrations().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});

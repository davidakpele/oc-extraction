'use strict';

const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

let pool = null;

async function initDb() {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'ocr_engine',
    user: process.env.DB_USER || 'ocr_user',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
  });

  // Test connection
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  logger.info('MySQL pool created and connection verified');
  return pool;
}

function getDb() {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

async function query(sql, params = []) {
  const db = getDb();
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

module.exports = { initDb, getDb, query, queryOne };

'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const formats = [
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
];

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(...formats),
  transports: [
    // Console (pretty in dev, JSON in prod)
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development'
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, msg, ...meta }) => {
              const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
              return `${timestamp} [${level}] ${msg} ${metaStr}`;
            })
          )
        : winston.format.json(),
    }),
    // Rotating file: combined
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'ocr-engine-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      zippedArchive: true,
    }),
    // Rotating file: errors only
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'ocr-engine-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '60d',
      zippedArchive: true,
    }),
  ],
});

module.exports = logger;

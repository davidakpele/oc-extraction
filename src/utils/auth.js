'use strict';

function authMiddleware(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next(); // disabled

  const provided = req.headers['x-api-key'] || req.query.api_key;
  if (provided === apiKey) return next();

  return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
}

module.exports = { authMiddleware };

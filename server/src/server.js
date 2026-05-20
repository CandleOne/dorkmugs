// src/server.js — HTTP server entry point
require('dotenv').config();
const app = require('./app');
const config = require('./config');

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`[server] Dork Mugs API running on http://localhost:${PORT}`);
  console.log(`[server] Environment: ${config.env}`);
});

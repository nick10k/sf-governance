const jsforce = require('jsforce');
const pool = require('../db');

function createConnection(org) {
  const conn = new jsforce.Connection({
    oauth2: {
      clientId: process.env.SF_CLIENT_ID,
      clientSecret: process.env.SF_CLIENT_SECRET,
      redirectUri: process.env.SF_REDIRECT_URI,
    },
    instanceUrl: org.instance_url,
    accessToken: org.access_token,
    refreshToken: org.refresh_token,
  });

  // Persist refreshed tokens back to DB
  conn.on('refresh', async (newAccessToken) => {
    await pool.query('UPDATE orgs SET access_token = $1 WHERE id = $2', [
      newAccessToken,
      org.id,
    ]);
  });

  return conn;
}

module.exports = { createConnection };

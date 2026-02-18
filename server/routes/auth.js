const express = require('express');
const jsforce = require('jsforce');
const pool = require('../db');

const router = express.Router();

const oauth2 = new jsforce.OAuth2({
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  redirectUri: process.env.SF_REDIRECT_URI,
});

// Redirect to Salesforce OAuth consent screen
router.get('/login', (req, res) => {
  const authUrl = oauth2.getAuthorizationUrl({ scope: 'api refresh_token' });
  res.redirect(authUrl);
});

// Salesforce redirects here with ?code=...
router.get('/callback', async (req, res) => {
  const conn = new jsforce.Connection({ oauth2 });
  try {
    await conn.authorize(req.query.code);

    // Get org info for display name
    const identity = await conn.identity();
    const orgName = identity.display_name || identity.organization_id;

    await pool.query(
      `INSERT INTO orgs (name, instance_url, access_token, refresh_token)
       VALUES ($1, $2, $3, $4)`,
      [orgName, conn.instanceUrl, conn.accessToken, conn.refreshToken]
    );

    res.redirect('http://localhost:5173');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).json({ error: 'OAuth failed', detail: err.message });
  }
});

module.exports = router;

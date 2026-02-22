const express = require('express');
const jsforce = require('jsforce');
const pool = require('../db');

const router = express.Router();

const LOGIN_URLS = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com',
};

function buildOAuth2(env) {
  return new jsforce.OAuth2({
    loginUrl: LOGIN_URLS[env] || LOGIN_URLS.production,
    clientId: process.env.SF_CLIENT_ID,
    clientSecret: process.env.SF_CLIENT_SECRET,
    redirectUri: process.env.SF_REDIRECT_URI,
  });
}

// Redirect to Salesforce OAuth consent screen
router.get('/login', (req, res) => {
  const env = req.query.env === 'sandbox' ? 'sandbox' : 'production';
  const stateData = { env };
  if (req.query.accountId) stateData.accountId = parseInt(req.query.accountId);
  if (req.query.accountName) stateData.accountName = req.query.accountName;
  if (req.query.envLabel) stateData.envLabel = req.query.envLabel;

  const oauth2 = buildOAuth2(env);
  const authUrl = oauth2.getAuthorizationUrl({
    scope: 'api refresh_token',
    state: JSON.stringify(stateData),
  });
  res.redirect(authUrl);
});

// Salesforce redirects here with ?code=...&state=...
router.get('/callback', async (req, res) => {
  let stateData;
  try {
    stateData = JSON.parse(req.query.state);
  } catch {
    // backward compat: state was just the env string
    stateData = { env: req.query.state };
  }

  const env = stateData.env === 'sandbox' ? 'sandbox' : 'production';
  const oauth2 = buildOAuth2(env);
  const conn = new jsforce.Connection({ oauth2 });

  try {
    await conn.authorize(req.query.code);

    const identity = await conn.identity();
    const orgName = identity.display_name || identity.organization_id;

    // Resolve account: use existing id, create new from name, or leave null
    let accountId = stateData.accountId || null;
    if (!accountId && stateData.accountName) {
      const result = await pool.query(
        'INSERT INTO accounts (name) VALUES ($1) RETURNING id',
        [stateData.accountName]
      );
      accountId = result.rows[0].id;
    }

    const envLabel = stateData.envLabel || null;

    await pool.query(
      `INSERT INTO orgs (name, instance_url, access_token, refresh_token, account_id, env, env_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (instance_url) DO UPDATE
       SET name = EXCLUDED.name,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           account_id = COALESCE(EXCLUDED.account_id, orgs.account_id),
           env = EXCLUDED.env,
           env_label = EXCLUDED.env_label`,
      [orgName, conn.instanceUrl, conn.accessToken, conn.refreshToken, accountId, env, envLabel]
    );

    res.redirect('http://localhost:5173');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).json({ error: 'OAuth failed', detail: err.message });
  }
});

module.exports = router;

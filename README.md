# SF Governance — Salesforce Automation Governance Tool

Scans a Salesforce org's automation metadata and produces prioritized remediation recommendations.

## Prerequisites

- Node.js 18+
- Docker (for PostgreSQL)
- A Salesforce org (Developer Edition or sandbox)

## Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Copy env file and fill in Salesforce credentials (see below)
cp .env.example .env

# 3. Install and start the backend
npm install
npm run dev

# 4. Install and start the frontend (separate terminal)
cd client
npm install
npm run dev
```

Backend runs on http://localhost:3001, frontend on http://localhost:5173.

## Salesforce Connected App Setup

### Step 1: Create a Connected App

1. In your Salesforce org, go to **Setup** → search **App Manager** → click **New Connected App**
2. Fill in:
   - **Connected App Name**: SF Governance Tool
   - **API Name**: SF_Governance_Tool (auto-populated)
   - **Contact Email**: your email
3. Check **Enable OAuth Settings**
4. Set **Callback URL**: `http://localhost:3001/auth/callback`
5. Under **Selected OAuth Scopes**, add:
   - `Access and manage your data (api)`
   - `Perform requests at any time (refresh_token, offline_access)`
6. Uncheck **Require Proof Key for Code Exchange (PKCE)**
7. Click **Save**, then **Continue**

### Step 2: Get Consumer Credentials

1. After saving, click **Manage Consumer Details**
2. You may need to verify via email code
3. Copy **Consumer Key** → this is your `SF_CLIENT_ID`
4. Copy **Consumer Secret** → this is your `SF_CLIENT_SECRET`

### Step 3: Configure IP Relaxation (Development Only)

1. Go to the Connected App you created
2. Click **Manage** → **Edit Policies**
3. Under **IP Relaxation**, select **Relax IP restrictions**
4. Click **Save**

> **Warning:** This setting is for local development only.

### Step 4: Wait for Propagation

Connected Apps can take 2–10 minutes to propagate. If you get `invalid_client_id` errors immediately after creation, wait and try again.

### Step 5: Update .env

```bash
SF_CLIENT_ID=<Consumer Key from Step 2>
SF_CLIENT_SECRET=<Consumer Secret from Step 2>
SF_REDIRECT_URI=http://localhost:3001/auth/callback
```

## Metadata API Access Notes

The scan uses the Salesforce Metadata API which requires:
- The connected user must have **Modify All Data** or **Modify Metadata** permission (System Administrator profile has this by default)
- Pulls three metadata types: Flow, WorkflowRule, ApexTrigger

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/login` | Redirects to Salesforce OAuth |
| GET | `/auth/callback` | OAuth callback (exchanges code for tokens) |
| GET | `/api/orgs` | List connected orgs |
| POST | `/api/orgs/:orgId/scans` | Run a metadata scan |
| GET | `/api/scans/:id` | Get scan results |

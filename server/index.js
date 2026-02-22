require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const migrate = require('./migrate');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const orgRoutes = require('./routes/orgs');
const scanRoutes = require('./routes/scans');
const ruleRoutes = require('./routes/rules');
const recommendationRoutes = require('./routes/recommendations');
const automationRoutes = require('./routes/automations');
const remediationJobRoutes = require('./routes/remediationJobs');
const progressStore = require('./services/progressStore');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/orgs', orgRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/remediation-jobs', remediationJobRoutes);

app.get('/api/progress/:jobId', (req, res) => {
  const job = progressStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Serve built React app
const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
migrate()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch(err => { console.error('Migration failed:', err); process.exit(1); });

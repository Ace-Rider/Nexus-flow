const express = require('express');

const app = express();
app.use(express.json());

const flows = {
  'demo-flow-001': {
    nodes: [],
    edges: [],
  },
};

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (username && password) {
    res.json({
      accessToken: `mock_access_${Date.now()}`,
      refreshToken: `mock_refresh_${Date.now()}`,
    });
    return;
  }

  res.status(401).json({ message: 'Invalid credentials' });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken && refreshToken.startsWith('mock_refresh')) {
    res.json({ accessToken: `new_access_${Date.now()}` });
    return;
  }

  res.status(401).json({ message: 'Invalid refresh token' });
});

app.get('/api/flows/:id', (req, res) => {
  const flow = flows[req.params.id];
  if (!flow) {
    res.status(404).json({ message: 'Flow not found' });
    return;
  }

  res.json(flow);
});

app.post('/api/flows/:id', (req, res) => {
  flows[req.params.id] = req.body;
  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('Mock server running on http://localhost:3000');
});

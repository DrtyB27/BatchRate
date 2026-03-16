require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const rateRoutes = require('./routes/rate');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
}));

// Serve Vite build in production
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

app.use('/api/auth', authRoutes);
app.use('/api', rateRoutes);

// Fallback to SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

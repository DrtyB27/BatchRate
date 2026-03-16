require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const ratingRoutes = require('./routes/rating');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve React build in production
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

// File upload config
const upload = multer({ dest: 'uploads/' });

// API routes
app.use('/api/rating', upload.single('file'), ratingRoutes);

// Fallback to React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

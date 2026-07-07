const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8888;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`MoonPlayer server is running on port ${PORT}`);
    console.log(`Local URL: http://localhost:${PORT}`);
});

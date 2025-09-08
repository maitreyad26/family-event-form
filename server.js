const express = require('express');
const bodyParser = require('body-parser');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// File paths for CSV backup
const csvFilePath = path.join(__dirname, 'family_event_data.csv');
const editCountsFilePath = path.join(__dirname, 'edit_counts.json');

// MongoDB URI from environment
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: { version: '1', strict: true, deprecationErrors: true }
});

// CSV headers for backup
const csvHeaders = [
    { id: 'name', title: 'Name' },
    { id: 'email', title: 'Email' },
    { id: 'dateOfEvent', title: 'Date of Event' },
    { id: 'eventDescription', title: 'Event Description' },
    { id: 'gotra', title: 'Gotra' },
    { id: 'nakshatra', title: 'Nakshatra' },
    { id: 'rashi', title: 'Rashi' },
    { id: 'phone', title: 'Phone No.' },
    { id: 'address', title: 'Address' },
    { id: 'relation', title: 'Relation to Primary' },
    { id: 'submittedAt', title: 'Submitted At' }
];

// Initialize CSV writer for backup
const csvWriter = createObjectCsvWriter({
    path: csvFilePath,
    header: csvHeaders
});

// Initialize files if not exist
if (!fs.existsSync(csvFilePath)) {
    csvWriter.writeRecords([]).then(() => console.log('CSV file created with headers'))
        .catch(err => console.error('Error creating CSV:', err));
}
if (!fs.existsSync(editCountsFilePath)) {
    fs.writeFileSync(editCountsFilePath, JSON.stringify({}), 'utf8');
}

// Admin password from environment
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminpswd6885';

// Connect to MongoDB
async function connectDB() {
    try {
        await client.connect();
        const db = client.db('family_event_db');
        return db.collection('entries');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

// Save form data
app.post('/save', async (req, res) => {
    try {
        const { primary, family = [] } = req.body || {};
        if (!primary || !primary.email || !primary.name) {
            throw new Error('Missing required primary data');
        }
        const submittedAt = new Date().toISOString();
        const emailKey = primary.email.toLowerCase();

        // Load and update edit counts
        let editCounts = {};
        if (fs.existsSync(editCountsFilePath)) {
            editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8')) || {};
        }
        const editCount = editCounts[emailKey] || 0;
        if (editCount >= 3) {
            return res.status(400).json({ message: 'Edit limit of 3 reached' });
        }
        editCounts[emailKey] = editCount + 1;
        fs.writeFileSync(editCountsFilePath, JSON.stringify(editCounts, null, 2), 'utf8');

        // Prepare records for MongoDB and CSV
        const newRecords = [
            {
                name: primary.name || 'N/A',
                email: primary.email || 'N/A',
                dateOfEvent: primary.dateOfEvent || '',
                eventDescription: primary.eventDescription || '',
                gotra: primary.gotra || 'N/A',
                nakshatra: primary.nakshatra || 'N/A',
                rashi: primary.rashi || 'N/A',
                phone: primary.phone || 'N/A',
                address: primary.address || '',
                relation: 'Self (Primary)',
                submittedAt
            },
            ...family.map(member => ({
                name: member.name || 'N/A',
                email: primary.email || 'N/A', // Self's email included
                dateOfEvent: member.dateOfEvent || '',
                eventDescription: member.eventDescription || '',
                gotra: member.gotra || 'N/A',
                nakshatra: member.nakshatra || 'N/A',
                rashi: member.rashi || 'N/A',
                phone: member.phone || 'N/A',
                address: member.address || '',
                relation: member.relation || 'N/A',
                submittedAt
            }))
        ];

        // Save to MongoDB
        const collection = await connectDB();
        await collection.insertMany(newRecords, { ordered: false });

        // Save to CSV as backup
        await csvWriter.writeRecords(newRecords).then(() => console.log('Data backed up to CSV'));
        res.json({ message: 'Data saved to database and CSV successfully!' });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ message: 'Error saving data: ' + error.message });
    }
});

// Admin view (sorted by Date of Event)
app.get('/admin', async (req, res) => {
    const password = req.query.password;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Unauthorized');
    }
    try {
        const collection = await connectDB();
        const records = await collection.find({}).toArray();
        records.sort((a, b) => new Date(a.dateOfEvent) - new Date(b.dateOfEvent));
        res.send(`
            <h1>Family Event Admin Data (Sorted by Date)</h1>
            <table border="1">
                <thead><tr>${csvHeaders.map(h => `<th>${h.title}</th>`).join('')}</tr></thead>
                <tbody>${records.length ? records.map(r => `<tr>${csvHeaders.map(h => `<td>${r[h.id] || 'N/A'}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="' + csvHeaders.length + '">No data</td></tr>'}</tbody>
            </table>
            <p><a href="/family_form.html">Back to Form</a></p>
        `);
    } catch (error) {
        console.error('Admin error:', error);
        res.status(500).send('Error fetching data: ' + error.message);
    }
});

// Edit count
app.get('/edit-count/:email', (req, res) => {
    try {
        const editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8')) || {};
        const editCount = editCounts[req.params.email.toLowerCase()] || 0;
        res.json({ editCount });
    } catch (error) {
        console.error('Edit count error:', error);
        res.status(500).json({ message: 'Error fetching edit count' });
    }
});

// Delete by email
app.post('/delete', async (req, res) => {
    try {
        const { password, email } = req.body || {};
        if (!password || password !== ADMIN_PASSWORD) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const collection = await connectDB();
        await collection.deleteMany({ email: email.toLowerCase() });
        res.json({ message: 'Data deleted successfully!' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Error deleting data' });
    }
});

// Start server with MongoDB connection cleanup
const port = process.env.PORT || 10000;
app.listen(port, async () => {
    console.log(`Server running on http://localhost:${port}`);
    try {
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } catch (error) {
        console.error("MongoDB connection failed:", error);
    }
});

process.on('SIGTERM', async () => {
    await client.close();
    process.exit(0);
});
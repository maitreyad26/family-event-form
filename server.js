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
const client = new MongoClient(uri, { serverApi: { version: '1', strict: true, deprecationErrors: true } });

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
    csvWriter.writeRecords([]).catch(err => console.error('Error creating CSV:', err));
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

// Save form data (with true editing on resubmit)
app.post('/save', async (req, res) => {
    try {
        const { primary, family = [] } = req.body || {};
        if (!primary || !primary.email || !primary.name) {
            return res.status(400).json({ message: 'Missing required primary data (name or email)' });
        }
        const submittedAt = new Date().toISOString();
        const emailKey = primary.email.toLowerCase();

        // Load and update edit counts
        let editCounts = {};
        try {
            if (fs.existsSync(editCountsFilePath)) {
                editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8')) || {};
            }
        } catch (e) {
            console.error('Error reading edit_counts.json:', e);
            editCounts = {}; // Reset if corrupted
        }
        const editCount = editCounts[emailKey] || 0;
        if (editCount >= 3) {
            return res.status(400).json({ message: 'Edit limit of 3 reached' });
        }

        const collection = await connectDB();
        let updatedRecords = [
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
            ...family.map((member, index) => ({
                name: member.name || 'N/A',
                email: primary.email || 'N/A',
                dateOfEvent: member.dateOfEvent || '',
                eventDescription: member.eventDescription || '',
                gotra: member.gotra || 'N/A',
                nakshatra: member.nakshatra || 'N/A',
                rashi: member.rashi || 'N/A',
                phone: member.phone || 'N/A',
                address: member.address || '',
                relation: member.relation || (index === 0 ? 'Spouse' : `Family Member ${index + 1}`),
                submittedAt
            }))
        ];

        // If editCount > 0, update the most recent submission
        if (editCount > 0) {
            const latestSubmission = await collection.find({ email: primary.email.toLowerCase() })
                .sort({ submittedAt: -1 })
                .limit(1 + family.length) // Include primary + family
                .toArray();
            if (latestSubmission.length > 0) {
                const latestIds = latestSubmission.map(doc => doc._id);
                await collection.updateMany(
                    { _id: { $in: latestIds } },
                    { $set: { ...updatedRecords[0], submittedAt } },
                    { multi: true }
                );
                editCounts[emailKey] = editCount + 1;
            } else {
                await collection.insertMany(updatedRecords, { ordered: false });
                editCounts[emailKey] = 1;
            }
        } else {
            await collection.insertMany(updatedRecords, { ordered: false });
            editCounts[emailKey] = 1;
        }

        // Save edit counts
        fs.writeFileSync(editCountsFilePath, JSON.stringify(editCounts, null, 2), 'utf8');

        // Sync CSV: Rewrite with all current MongoDB records
        const allRecords = await collection.find({}).toArray();
        await csvWriter.writeRecords(allRecords).catch(err => console.error('CSV write error:', err));

        res.json({ message: 'Data saved to database and CSV successfully!' });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ message: 'Error saving data: ' + error.message });
    }
});

// Admin view (show all data by default, flexible month/year filter)
app.get('/admin', async (req, res) => {
    const password = req.query.password;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Unauthorized');
    }
    const month = req.query.month;
    const year = req.query.year;
    let query = {};
    let searchTitle = '';
    // Flexible OR/AND filter for month and/or year
    if (month || year) {
        const conditions = [];
        if (month && !isNaN(month) && month >= 1 && month <= 12) {
            const paddedMonth = String(month).padStart(2, '0');
            conditions.push({ dateOfEvent: { $regex: `-${paddedMonth}-` } });
        }
        if (year && !isNaN(year)) {
            conditions.push({ dateOfEvent: { $regex: `^${year}-` } });
        }
        if (conditions.length > 0) {
            query.$or = conditions;
            searchTitle = ` (Filtered for ${month ? `Month ${month}` : ''}${month && year ? ' and ' : ''}${year ? `Year ${year}` : ''})`;
        }
    }
    try {
        const collection = await connectDB();
        let records = await collection.find(query).toArray();

        // Custom sort: Prioritize month (Jan-Dec), then day, then year asc, then name asc if same date
        records.sort((a, b) => {
            const dateA = a.dateOfEvent ? new Date(a.dateOfEvent) : new Date(0);
            const dateB = b.dateOfEvent ? new Date(b.dateOfEvent) : new Date(0);
            if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
                return isNaN(dateA.getTime()) ? -1 : 1; // Invalid dates to top
            }
            if (dateA.getMonth() !== dateB.getMonth()) return dateA.getMonth() - dateB.getMonth();
            if (dateA.getDate() !== dateB.getDate()) return dateA.getDate() - dateB.getDate();
            if (dateA.getFullYear() !== dateB.getFullYear()) return dateA.getFullYear() - dateB.getFullYear();
            return (a.name || '').localeCompare(b.name || '');
        });

        res.send(`
            <h1>Family Event Admin Data (Sorted by Date)${searchTitle}</h1>
            <form method="get" action="/admin">
                <input type="hidden" name="password" value="${password}">
                <label>Month (1-12):</label> <input name="month" type="number" min="1" max="12" value="${month || ''}">
                <label>Year (e.g., 2025):</label> <input name="year" type="number" value="${year || ''}">
                <button type="submit">Search by Date of Event</button>
            </form>
            <table border="1">
                <thead><tr>${csvHeaders.map(h => `<th>${h.title}</th>`).join('')}</tr></thead>
                <tbody>${records.length ? records.map(r => `<tr>${csvHeaders.map(h => `<td>${r[h.id] || 'N/A'}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="' + csvHeaders.length + '">No data</td></tr>'}</tbody>
            </table>
            <p><a href="/family_form.html">Back to Form</a></p>
        `);
    } catch (error) {
        console.error('Admin error:', error);
        res.status(500).send('Error fetching data: ' + (error.message || 'Unknown error'));
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

// Delete by email (with CSV sync and edit count reset)
app.post('/delete', async (req, res) => {
    try {
        const { password, email } = req.body || {};
        if (!password || password !== ADMIN_PASSWORD) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const collection = await connectDB();
        await collection.deleteMany({ email: email.toLowerCase() });

        // Sync CSV: Rewrite with remaining MongoDB records
        const allRecords = await collection.find({}).toArray();
        await csvWriter.writeRecords(allRecords).catch(err => console.error('CSV write error:', err));

        // Reset edit count
        let editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8')) || {};
        delete editCounts[email.toLowerCase()];
        fs.writeFileSync(editCountsFilePath, JSON.stringify(editCounts, null, 2), 'utf8');

        res.json({ message: 'Data deleted successfully!' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Error deleting data' });
    }
});

// Download CSV (for backup verification)
app.get('/download-csv', (req, res) => {
    const password = req.query.password;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Unauthorized');
    }
    res.download(csvFilePath, 'family_event_data.csv', (err) => {
        if (err) {
            console.error('CSV download error:', err);
            res.status(500).send('Error downloading CSV');
        }
    });
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
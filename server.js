const express = require('express');
const bodyParser = require('body-parser');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs').promises;
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Configuration
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, { serverApi: { version: '1', strict: true, deprecationErrors: true } });
const csvFilePath = path.join(__dirname, 'family_event_data.csv');
const editCountsFilePath = path.join(__dirname, 'edit_counts.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminpswd6885';

// CSV Headers
const csvHeaders = [
    { id: 'name', title: 'Name' },
    { id: 'occasion', title: 'Occasion Name' },
    { id: 'dateOfOccasion', title: 'Date of Occasion' },
    { id: 'gotra', title: 'Gotra' },
    { id: 'nakshatra', title: 'Nakshatra' },
    { id: 'tamilMonth', title: 'Tamil Month' },
    { id: 'rashi', title: 'Rashi' },
    { id: 'address', title: 'Address' },
    { id: 'phone', title: 'Phone Number' },
    { id: 'relation', title: 'Relation to Primary' },
    { id: 'email', title: 'Email ID' },
    { id: 'submittedAt', title: 'Submitted At' }
];

// Initialize CSV Writer
const csvWriter = createObjectCsvWriter({
    path: csvFilePath,
    header: csvHeaders
});

// Utility Functions
async function initializeFiles() {
    try {
        await fs.access(csvFilePath).catch(() => csvWriter.writeRecords([]));
        await fs.access(editCountsFilePath).catch(() => fs.writeFile(editCountsFilePath, '{}', 'utf8'));
    } catch (error) {
        console.error('File initialization error:', error);
    }
}

async function getCollection() {
    try {
        await client.connect();
        return client.db('family_event_db').collection('entries');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

async function loadEditCounts() {
    try {
        const data = await fs.readFile(editCountsFilePath, 'utf8');
        return JSON.parse(data) || {};
    } catch (error) {
        console.error('Error reading edit counts:', error);
        return {};
    }
}

async function saveEditCounts(editCounts) {
    try {
        await fs.writeFile(editCountsFilePath, JSON.stringify(editCounts, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving edit counts:', error);
    }
}

// Routes
app.post('/save', async (req, res) => {
    console.log('Received data:', req.body);
    try {
        const { primary = [], family = [] } = req.body || {};
        if (!primary.length || !primary[0]?.email || !primary[0]?.name || !primary[0]?.phone || !primary[0]?.address) {
            return res.status(400).json({ message: 'Missing required primary data (name, email, phone, or address)' });
        }

        const submittedAt = new Date().toISOString();
        const emailKey = primary[0].email.toLowerCase();
        const editCounts = await loadEditCounts();
        const editCount = editCounts[emailKey] || 0;

        if (editCount >= 3) {
            return res.status(400).json({ message: 'Edit limit of 3 reached' });
        }

        const collection = await getCollection();

        const primaryRecords = primary.map(record => ({
            name: record.name || 'N/A',
            email: record.email || 'N/A',
            phone: record.phone || 'N/A',
            occasion: record.occasion || '',
            dateOfOccasion: record.dateOfOccasion || '',
            gotra: record.gotra || '',
            nakshatra: record.nakshatra || '',
            tamilMonth: record.tamilMonth || '',
            rashi: record.rashi || '',
            address: record.address || 'N/A',
            relation: record.relation || 'Self (Primary)',
            submittedAt
        }));

        const familyRecords = family.map((member, index) => ({
            name: member.name || 'N/A',
            email: primary[0].email || 'N/A',
            phone: member.phone || 'N/A',
            occasion: member.occasion || '',
            dateOfOccasion: member.dateOfOccasion || '',
            gotra: member.gotra || '',
            nakshatra: member.nakshatra || '',
            tamilMonth: member.tamilMonth || '',
            rashi: member.rashi || '',
            address: member.address || primary[0].address || 'N/A',
            relation: member.relation || `Family Member ${index + 1}`,
            submittedAt
        }));

        const newRecords = [...primaryRecords, ...familyRecords];

        if (editCount > 0) {
            await collection.deleteMany({ email: emailKey });
            await collection.insertMany(newRecords, { ordered: false });
            editCounts[emailKey] = editCount + 1;
        } else {
            await collection.insertMany(newRecords, { ordered: false });
            editCounts[emailKey] = 1;
        }

        await saveEditCounts(editCounts);

        const allRecords = await collection.find({}).toArray();
        const csvRecords = allRecords.map(record => ({
            name: record.name,
            occasion: record.occasion || '',
            dateOfOccasion: record.dateOfOccasion || '',
            gotra: record.gotra || '',
            nakshatra: record.nakshatra || '',
            tamilMonth: record.tamilMonth || '',
            rashi: record.rashi || '',
            address: record.address,
            phone: record.phone,
            relation: record.relation,
            email: record.email,
            submittedAt: record.submittedAt
        }));
        await csvWriter.writeRecords(csvRecords);

        res.json({ message: 'Data saved to database and CSV successfully!' });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ message: 'Error saving data: ' + error.message });
    }
});

app.get('/edit-count/:email', async (req, res) => {
    try {
        const editCounts = await loadEditCounts();
        const editCount = editCounts[req.params.email.toLowerCase()] || 0;
        res.json({ editCount });
    } catch (error) {
        console.error('Edit count error:', error);
        res.status(500).json({ message: 'Error fetching edit count' });
    }
});

app.post('/delete', async (req, res) => {
    try {
        const { password, email } = req.body || {};
        if (!password || password !== ADMIN_PASSWORD) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const collection = await getCollection();
        await collection.deleteMany({ email: email.toLowerCase() });

        const allRecords = await collection.find({}).toArray();
        const csvRecords = allRecords.map(record => ({
            name: record.name,
            occasion: record.occasion || '',
            dateOfOccasion: record.dateOfOccasion || '',
            gotra: record.gotra || '',
            nakshatra: record.nakshatra || '',
            tamilMonth: record.tamilMonth || '',
            rashi: record.rashi || '',
            address: record.address,
            phone: record.phone,
            relation: record.relation,
            email: record.email,
            submittedAt: record.submittedAt
        }));
        await csvWriter.writeRecords(csvRecords);

        let editCounts = await loadEditCounts();
        delete editCounts[email.toLowerCase()];
        await saveEditCounts(editCounts);

        res.json({ message: 'Data deleted successfully!' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Error deleting data' });
    }
});

app.get('/admin', async (req, res) => {
    try {
        const password = req.query.password;
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).send('Unauthorized');
        }

        const month = req.query.month;
        const year = req.query.year;
        let query = {};
        let searchTitle = '';
        if (month && !isNaN(month) && month >= 1 && month <= 12) {
            const paddedMonth = String(month).padStart(2, '0');
            if (year && !isNaN(year)) {
                query.dateOfOccasion = { $regex: `^${year}-${paddedMonth}-` };
                searchTitle = ` (Filtered for ${month}/${year})`;
            } else {
                query.dateOfOccasion = { $regex: `-${paddedMonth}-` };
                searchTitle = ` (Filtered for Month ${month})`;
            }
        } else if (year && !isNaN(year)) {
            query.dateOfOccasion = { $regex: `^${year}-` };
            searchTitle = ` (Filtered for Year ${year})`;
        }

        const collection = await getCollection();
        let records = await collection.find(query).toArray();

        records.sort((a, b) => {
            const dateA = a.dateOfOccasion ? new Date(a.dateOfOccasion) : new Date(0);
            const dateB = b.dateOfOccasion ? new Date(b.dateOfOccasion) : new Date(0);
            if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return isNaN(dateA.getTime()) ? -1 : 1;
            if (dateA.getMonth() !== dateB.getMonth()) return dateA.getMonth() - dateB.getMonth();
            if (dateA.getDate() !== dateB.getDate()) return dateA.getDate() - dateB.getDate();
            if (dateA.getFullYear() !== dateB.getFullYear()) return dateA.getFullYear() - dateB.getFullYear();
            return (a.name || '').localeCompare(b.name || '');
        });

        const displayRecords = records.map(record => ({
            name: record.name,
            occasion: record.occasion || '',
            dateOfOccasion: record.dateOfOccasion || '',
            gotra: record.gotra || '',
            nakshatra: record.nakshatra || '',
            tamilMonth: record.tamilMonth || '',
            rashi: record.rashi || '',
            address: record.address,
            phone: record.phone,
            relation: record.relation,
            email: record.email,
            submittedAt: record.submittedAt
        }));

        res.send(`
            <h1>Family Event Admin Data (Sorted by Date)${searchTitle}</h1>
            <form method="get" action="/admin">
                <input type="hidden" name="password" value="${password}">
                <label>Month (1-12):</label> <input name="month" type="number" min="1" max="12" value="${month || ''}">
                <label>Year (e.g., 2026):</label> <input name="year" type="number" value="${year || ''}">
                <button type="submit">Search by Date of Occasion</button>
            </form>
            <table border="1">
                <thead><tr>
                    ${csvHeaders.map(h => `<th>${h.title}</th>`).join('')}
                </tr></thead>
                <tbody>
                    ${displayRecords.length ? displayRecords.map(r => `<tr>
                        ${csvHeaders.map(h => `<td>${r[h.id] || 'N/A'}</td>`).join('')}
                    </tr>`).join('') : '<tr><td colspan="' + csvHeaders.length + '">No data</td></tr>'}
                </tbody>
            </table>
            <p><a href="/family_form.html">Back to Form</a></p>
        `);
    } catch (error) {
        console.error('Admin error:', error);
        res.status(500).send('Error fetching data: ' + (error.message || 'Unknown error'));
    }
});

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

// Server Start
async function startServer() {
    await initializeFiles();
    app.listen(port, async () => {
        console.log(`Server running on http://localhost:${port}`);
        try {
            await client.db("admin").command({ ping: 1 });
            console.log("Pinged your deployment. You successfully connected to MongoDB!");
        } catch (error) {
            console.error("MongoDB connection failed:", error);
        }
    });
}

process.on('SIGTERM', async () => {
    await client.close();
    process.exit(0);
});

startServer().catch(err => console.error('Server start error:', err));
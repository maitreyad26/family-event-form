const express = require('express');
const bodyParser = require('body-parser');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// File paths
const csvFilePath = path.join(__dirname, 'family_event_data.csv');
const editCountsFilePath = path.join(__dirname, 'edit_counts.json');

// CSV headers
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

// Initialize CSV writer
const csvWriter = createObjectCsvWriter({
    path: csvFilePath,
    header: csvHeaders
});

// Initialize files if not exist
if (!fs.existsSync(csvFilePath)) {
    csvWriter.writeRecords([]).then(() => console.log('CSV file initialized with headers'))
        .catch(err => console.error('Error initializing CSV:', err));
}
if (!fs.existsSync(editCountsFilePath)) {
    fs.writeFileSync(editCountsFilePath, JSON.stringify({}), 'utf8');
}

// In-memory storage for admin
let adminData = [];
function loadInitialData() {
    if (fs.existsSync(csvFilePath)) {
        try {
            const csvData = fs.readFileSync(csvFilePath, 'utf8');
            const lines = csvData.split('\n').filter(line => line.trim());
            if (lines.length > 1) {
                for (let i = 1; i < lines.length; i++) {
                    const values = parseCSVLine(lines[i]);
                    if (values.length === csvHeaders.length) {
                        const record = {};
                        csvHeaders.forEach((header, index) => {
                            record[header.title] = values[index] || 'N/A';
                        });
                        adminData.push(record);
                    } else {
                        console.log(`Skipped line ${i}: length ${values.length}, values: ${values}`);
                    }
                }
                adminData.sort((a, b) => new Date(a['Date of Event'] || '1970-01-01') - new Date(b['Date of Event'] || '1970-01-01'));
                console.log('Initial adminData loaded:', adminData);
            }
        } catch (err) {
            console.error('Error loading initial data:', err);
        }
    }
}
loadInitialData();

// Admin password
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminpswd6885';

// Custom CSV line parser
function parseCSVLine(line) {
    const values = [];
    let inQuotes = false;
    let currentValue = '';
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && (i === 0 || line[i - 1] !== '\\')) {
            inQuotes = !inQuotes;
        } else if (line[i] === ',' && !inQuotes) {
            values.push(currentValue.trim());
            currentValue = '';
        } else {
            currentValue += line[i];
        }
    }
    values.push(currentValue.trim());
    return values.map(v => v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v);
}

// Save form data
app.post('/save', async (req, res) => {
    try {
        const { primary, family = [] } = req.body || {};
        if (!primary || !primary.email || !primary.name) {
            throw new Error('Missing required primary data (email or name)');
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

        // Prepare new records
        const newRecords = [
            { ...Object.fromEntries(csvHeaders.map(h => [h.title, primary[h.id] || 'N/A'])), 
              'Relation to Primary': 'Self (Primary)', 
              'Submitted At': submittedAt },
            ...family.slice(0, 10).map(member => ({ ...Object.fromEntries(csvHeaders.map(h => [h.title, member[h.id] || 'N/A'])), 
              'Relation to Primary': member.relation || 'N/A', 
              'Submitted At': submittedAt }))
        ];

        // Update in-memory and CSV
        adminData = [...adminData.filter(r => r.email !== primary.email || r['Submitted At'] !== submittedAt), ...newRecords];
        adminData.sort((a, b) => new Date(a['Date of Event'] || '1970-01-01') - new Date(b['Date of Event'] || '1970-01-01'));
        console.log('New adminData:', adminData);
        await csvWriter.writeRecords(newRecords).then(() => {
            console.log('Data saved to CSV:', newRecords);
            res.json({ message: 'Data saved to CSV and admin successfully!' });
        }).catch(err => {
            throw new Error(`CSV write failed: ${err.message}`);
        });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ message: 'Error saving data: ' + error.message });
    }
});

// Admin view
app.get('/admin', (req, res) => {
    const password = req.query.password;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Unauthorized');
    }
    try {
        console.log('Admin data serving:', adminData);
        res.send(`
            <h1>Family Event Admin Data (Sorted by Date)</h1>
            <table border="1">
                <thead><tr>${csvHeaders.map(h => `<th>${h.title}</th>`).join('')}</tr></thead>
                <tbody>${adminData.length ? adminData.map(r => `<tr>${csvHeaders.map(h => `<td>${r[h.title] || 'N/A'}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="' + csvHeaders.length + '">No data</td></tr>'}</tbody>
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
        adminData = adminData.filter(r => r.email.toLowerCase() !== email?.toLowerCase());
        await csvWriter.writeRecords(adminData).then(() =>
            res.json({ message: 'Data deleted successfully!' })
        ).catch(err => {
            throw new Error(`CSV write failed: ${err.message}`);
        });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Error deleting data' });
    }
});

// Start server
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
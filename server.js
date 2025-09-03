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

// Create CSV with headers if it doesn’t exist
if (!fs.existsSync(csvFilePath)) {
    csvWriter.writeRecords([]).then(() => console.log('CSV file created with headers'))
        .catch(err => console.error('Error creating CSV:', err));
}

// Initialize edit counts
if (!fs.existsSync(editCountsFilePath)) {
    fs.writeFileSync(editCountsFilePath, JSON.stringify({}), 'utf8');
}

// Admin password from environment
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminpswd6885';

// Save form data
app.post('/save', async (req, res) => {
    try {
        const { primary, family, familyMemberCount } = req.body || {};
        if (!primary) throw new Error('No primary data provided');
        const submittedAt = new Date().toISOString();
        const emailKey = primary.email?.toLowerCase();

        // Load edit counts with error handling
        let editCounts = {};
        if (fs.existsSync(editCountsFilePath)) {
            try {
                editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8'));
            } catch (parseErr) {
                console.error('Error parsing edit counts:', parseErr);
                editCounts = {};
            }
        }
        const editCount = editCounts[emailKey] || 0;
        if (editCount >= 3) {
            return res.status(400).json({ message: 'Edit limit of 3 reached' });
        }
        editCounts[emailKey] = editCount + 1;
        fs.writeFileSync(editCountsFilePath, JSON.stringify(editCounts, null, 2), 'utf8');

        // Prepare records
        const records = [
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
            ...(family || []).map(member => ({
                name: member.name || 'N/A',
                email: primary.email || 'N/A',
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

        // Read existing data and filter duplicates
        let allRecords = [];
        if (fs.existsSync(csvFilePath)) {
            try {
                const csvData = fs.readFileSync(csvFilePath, 'utf8');
                const lines = csvData.split('\n').filter(line => line.trim());
                if (lines.length > 1) {
                    for (let i = 1; i < lines.length; i++) {
                        const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                        const cleanedValues = values.map(v => v.replace(/^"|"$/g, '').trim());
                        if (cleanedValues.length === csvHeaders.length) {
                            const record = {};
                            csvHeaders.forEach((header, index) => {
                                record[header.id] = cleanedValues[index] || 'N/A';
                            });
                            allRecords.push(record);
                        }
                    }
                }
            } catch (readErr) {
                console.error('Error reading CSV:', readErr);
            }
        }
        const uniqueRecords = allRecords.filter(existing =>
            !(existing.email === primary.email && existing.submittedAt === submittedAt)
        );
        allRecords = [...uniqueRecords, ...records];

        // Write to CSV
        await csvWriter.writeRecords(allRecords).then(() =>
            res.json({ message: 'Data saved successfully!' })
        ).catch(err => {
            throw new Error(`CSV write failed: ${err.message}`);
        });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ message: 'Error saving data' });
    }
});

// Admin view (sorted by Date of Event)
app.get('/admin', (req, res) => {
    const password = req.query.password;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Unauthorized');
    }
    try {
        const records = [];
        if (fs.existsSync(csvFilePath)) {
            const csvData = fs.readFileSync(csvFilePath, 'utf8');
            const lines = csvData.split('\n').filter(line => line.trim());
            if (lines.length > 1) {
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, '')); // Simpler split
                    if (values.length === csvHeaders.length) {
                        const record = {};
                        csvHeaders.forEach((header, index) => {
                            record[header.title] = values[index] || 'N/A';
                        });
                        records.push(record);
                    }
                }
                records.sort((a, b) => new Date(a['Date of Event']) - new Date(b['Date of Event']));
            }
        }
        res.send(`
            <h1>Family Event Admin Data (Sorted by Date)</h1>
            <table border="1">
                <thead><tr>${csvHeaders.map(h => `<th>${h.title}</th>`).join('')}</tr></thead>
                <tbody>${records.length ? records.map(r => `<tr>${csvHeaders.map(h => `<td>${r[h.title]}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="' + csvHeaders.length + '">No data</td></tr>'}</tbody>
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
        const editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8'));
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
        let records = [];
        if (fs.existsSync(csvFilePath)) {
            try {
                const csvData = fs.readFileSync(csvFilePath, 'utf8');
                const lines = csvData.split('\n').filter(line => line.trim());
                if (lines.length > 1) {
                    for (let i = 1; i < lines.length; i++) {
                        const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                        const cleanedValues = values.map(v => v.replace(/^"|"$/g, '').trim());
                        if (cleanedValues.length === csvHeaders.length) {
                            const record = {};
                            csvHeaders.forEach((header, index) => {
                                record[header.id] = cleanedValues[index];
                            });
                            if (record.email.toLowerCase() !== email?.toLowerCase()) {
                                records.push(record);
                            }
                        }
                    }
                }
            } catch (readErr) {
                console.error('Error reading CSV:', readErr);
            }
        }
        await csvWriter.writeRecords(records).then(() =>
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
const port = process.env.PORT; // Remove misleading comment about 3000
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
const express = require('express');
const bodyParser = require('body-parser');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 1850; // Matches your usage

// Middleware to parse JSON and serve static files
app.use(bodyParser.json());
app.use(express.static('public'));

// Paths for CSV and edit counts
const csvFilePath = path.join(__dirname, 'family_event_data.csv');
const editCountsFilePath = path.join(__dirname, 'edit_counts.json');

// Define headers
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

// Initialize CSV writer (overwrite mode)
const csvWriter = createObjectCsvWriter({
    path: csvFilePath,
    header: csvHeaders
});

// Create or ensure CSV file exists with headers on server start
if (!fs.existsSync(csvFilePath)) {
    csvWriter.writeRecords([]).then(() => {
        console.log('CSV file created with headers');
    }).catch(err => {
        console.error('Error creating CSV file:', err);
    });
}

// Ensure edit counts JSON exists
if (!fs.existsSync(editCountsFilePath)) {
    fs.writeFileSync(editCountsFilePath, JSON.stringify({}), 'utf8');
}

// Admin password (change to a secure value)
const ADMIN_PASSWORD = 'admin123';

// Endpoint to save form data
app.post('/save', async (req, res) => {
    try {
        const { primary, family, familyMemberCount } = req.body;
        const submittedAt = new Date().toISOString();
        const emailKey = primary.email.toLowerCase();

        // Load edit counts
        let editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8'));

        // Check edit limit
        const editCount = editCounts[emailKey] || 0;
        if (editCount >= 3) {
            return res.status(400).json({ message: 'Edit limit of 3 reached for this email' });
        }
        editCounts[emailKey] = editCount + 1;

        // Save edit counts
        fs.writeFileSync(editCountsFilePath, JSON.stringify(editCounts, null, 2), 'utf8');

        // Prepare records for CSV
        const records = [
            {
                name: primary.name,
                email: primary.email,
                dateOfEvent: primary.dateOfEvent,
                eventDescription: primary.eventDescription,
                gotra: primary.gotra,
                nakshatra: primary.nakshatra,
                rashi: primary.rashi,
                phone: primary.phone || 'N/A',
                address: primary.address,
                relation: 'Self (Primary)',
                submittedAt
            },
            ...family.map(member => ({
                name: member.name,
                email: primary.email,
                dateOfEvent: member.dateOfEvent,
                eventDescription: member.eventDescription,
                gotra: member.gotra,
                nakshatra: member.nakshatra,
                rashi: member.rashi,
                phone: member.phone || 'N/A',
                address: member.address,
                relation: member.relation,
                submittedAt
            }))
        ];

        // Read existing data, append new records, and rewrite the file
        let allRecords = [];
        if (fs.existsSync(csvFilePath)) {
            const csvData = fs.readFileSync(csvFilePath, 'utf8');
            const lines = csvData.split('\n').filter(line => line.trim());
            if (lines.length > 1) { // Skip header
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                    const cleanedValues = values.map(v => v.replace(/^"|"$/g, '').trim());
                    if (cleanedValues.length === csvHeaders.length) {
                        const record = {};
                        csvHeaders.forEach((header, index) => {
                            record[header.id] = cleanedValues[index];
                        });
                        allRecords.push(record);
                    }
                }
            }
        }
        allRecords = [...allRecords, ...records];

        // Write all records (including headers) to the file
        await csvWriter.writeRecords(allRecords).then(() => {
            res.json({ message: 'Data saved to CSV successfully!' });
        }).catch(err => {
            throw new Error(`Failed to write to CSV: ${err.message}`);
        });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ message: 'Error saving data' });
    }
});

// Endpoint to retrieve all submissions from CSV (admin only, sorted by Date of Event)
app.get('/admin', (req, res) => {
    const password = req.query.password;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send('Unauthorized: Incorrect password');
    }

    try {
        const records = [];
        let headers = csvHeaders.map(h => h.title);
        if (fs.existsSync(csvFilePath)) {
            const csvData = fs.readFileSync(csvFilePath, 'utf8');
            const lines = csvData.split('\n').filter(line => line.trim());
            if (lines.length > 1) { // Skip header
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                    const cleanedValues = values.map(v => v.replace(/^"|"$/g, '').trim());
                    if (cleanedValues.length === csvHeaders.length) {
                        const record = {};
                        csvHeaders.forEach((header, index) => {
                            record[header.title] = cleanedValues[index];
                        });
                        records.push(record);
                    }
                }
                // Sort records by Date of Event (ascending)
                records.sort((a, b) => new Date(a['Date of Event']) - new Date(b['Date of Event']));
            }
        }

        res.send(`
            <h1>Admin View - Family Event Data (Sorted by Date of Event)</h1>
            <table border="1">
                <thead>
                    <tr>
                        ${headers.map(header => `<th>${header}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${records.length > 0 ? records.map(record => `
                        <tr>
                            ${headers.map(header => `<td>${record[header] || 'N/A'}</td>`).join('')}
                        </tr>
                    `).join('') : '<tr><td colspan="' + headers.length + '">No data available</td></tr>'}
                </tbody>
            </table>
            <p><a href="/family_form.html">Back to Form</a></p>
        `);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

// Endpoint to get edit count for an email
app.get('/edit-count/:email', (req, res) => {
    try {
        const editCounts = JSON.parse(fs.readFileSync(editCountsFilePath, 'utf8'));
        const emailKey = req.params.email.toLowerCase();
        const editCount = editCounts[emailKey] || 0;
        res.json({ editCount });
    } catch (error) {
        console.error('Error fetching edit count:', error);
        res.status(500).json({ message: 'Error fetching edit count' });
    }
});

// Endpoint to delete data by email (admin only)
app.post('/delete', async (req, res) => {
    try {
        const { password, email } = req.body;
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ message: 'Unauthorized: Incorrect password' });
        }

        let records = [];
        if (fs.existsSync(csvFilePath)) {
            const csvData = fs.readFileSync(csvFilePath, 'utf8');
            const lines = csvData.split('\n').filter(line => line.trim());
            if (lines.length > 1) { // Skip header
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                    const cleanedValues = values.map(v => v.replace(/^"|"$/g, '').trim());
                    if (cleanedValues.length === csvHeaders.length) {
                        const record = {};
                        csvHeaders.forEach((header, index) => {
                            record[header.id] = cleanedValues[index];
                        });
                        if (record.email.toLowerCase() !== email.toLowerCase()) {
                            records.push(record);
                        }
                    }
                }
            }
        }

        // Write remaining records (including headers) to the file
        await csvWriter.writeRecords(records).then(() => {
            res.json({ message: 'Data deleted successfully!' });
        }).catch(err => {
            throw new Error(`Failed to write to CSV: ${err.message}`);
        });
    } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ message: 'Error deleting data' });
    }
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
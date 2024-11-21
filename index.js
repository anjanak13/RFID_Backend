const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./firebaseConfig');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const PORT = process.env.PORT || 3000;

// Server start
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


app.get('/', (req, res) => {
    res.send('Welcome to the Race Timing Backend!');
});

// Helper function to fetch all participants for a race
async function getAllParticipants(raceName) {
    const participantsRef = db.collection('Races').doc(raceName).collection('Participants');
    const snapshot = await participantsRef.get();
    return snapshot.docs.reduce((acc, doc) => {
        const data = doc.data();
        acc[data.tagNumber] = {
            firstName: data.firstName,
            lastName: data.lastName,
            age: data.age,
            gender: data.gender,
        };
        return acc;
    }, {});
}

// Helper function to fetch reader data for a specific race
async function getReaderData(raceName, readerIp) {
    const readerRef = db.collection('RFIDReaders').doc(raceName).collection(readerIp);
    const snapshot = await readerRef.get();

    const readerData = {};
    snapshot.docs.forEach(doc => {
        const normalizedId = doc.id.trim().replace(/\s+/g, ''); // Normalize tag ID
        readerData[normalizedId] = doc.data();
    });

    console.log(`Fetched tags for ${readerIp}:`, Object.keys(readerData)); // Debugging log
    return readerData;
}

app.get('/welcome', async (req, res) => {
    try {
        const racesSnapshot = await db.collection('RFIDReaders').get();

        if (racesSnapshot.empty) {
            console.log('No races found in the RFIDReaders collection.');
            return res.render('home', { races: [] });
        }

        // Log document data for debugging
        const races = racesSnapshot.docs.map((doc) => {
            console.log('Found document:', doc.id);
            return doc.id; // Collect document IDs
        });

        console.log('Fetched races:', races);

        res.render('home', { races });
    } catch (error) {
        console.error('Error fetching races:', error);
        res.status(500).send('Failed to fetch races.');
    }
});




// Race results route
app.get('/sorted-race-results', async (req, res) => {
    const raceName = req.query.race; // Get race name from the query parameter

    if (!raceName) {
        return res.status(400).send('Race name is required.');
    }

    try {
        const [reader1Data, reader2Data, participants] = await Promise.all([
            getReaderData(raceName, '192.168.10.1'),
            getReaderData(raceName, '192.168.10.2'),
            getAllParticipants(raceName),
        ]);

        const categories = {
            'Men (16-39)': [],
            'Men (40+)': [],
            'Men (under 16)': [],
            'Women (16-39)': [],
            'Women (40+)': [],
            'Women (under 16)': [],
            Uncategorized: [],
        };

        Object.keys(reader1Data).forEach((tagId) => {
            const normalizedTagId = tagId.trim().replace(/\s+/g, '');
            if (!reader2Data[normalizedTagId]) return;

            const reader1 = reader1Data[tagId];
            const reader2 = reader2Data[normalizedTagId];

            const reader1DateTime = new Date(`${reader1.date}T${reader1.time}`);
            const reader2DateTime = new Date(`${reader2.date}T${reader2.time}`);
            const timeDifferenceMs = Math.abs(reader2DateTime - reader1DateTime);

            const result = {
                name: 'Unknown Participant',
                start: reader1.time || 'N/A',
                finish: reader2.time || 'N/A',
                time: timeDifferenceMs,
                formattedTime: new Date(timeDifferenceMs).toISOString().substr(11, 8), // HH:MM:SS
            };

            const participant = participants[normalizedTagId];
            if (!participant) {
                result.name = `Unknown Participant (Tag: ${normalizedTagId})`;
                categories['Uncategorized'].push(result);
                return;
            }

            result.name = `${participant.firstName} ${participant.lastName}`;
            const age = participant.age;
            const gender = participant.gender;

            if (age >= 16 && age <= 39) {
                categories[gender === 'Male' ? 'Men (16-39)' : 'Women (16-39)'].push(result);
            } else if (age >= 40) {
                categories[gender === 'Male' ? 'Men (40+)' : 'Women (40+)'].push(result);
            } else if (age < 16) {
                categories[gender === 'Male' ? 'Men (under 16)' : 'Women (under 16)'].push(result);
            }
        });

        // Sort results within each category by time
        Object.keys(categories).forEach((category) => {
            categories[category].sort((a, b) => a.time - b.time);
        });

        // Add category metadata
        const categoryStats = Object.keys(categories).map((category) => ({
            name: category,
            results: categories[category],
            totalRegistered: categories[category].length,
            totalFinished: categories[category].length,
            didNotStart: 0,
            didNotFinish: 0,
            disqualified: 0,
        }));

        // Render the results page with the race name
        res.render('cat-results', { categoryStats, raceName });
    } catch (error) {
        console.error('Error processing race results:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Race results route
app.get('/race-results', async (req, res) => {
    const raceName = req.query.race; // Get race name from the query parameter

    if (!raceName) {
        return res.status(400).send('Race name is required.');
    }

    try {
        // Fetch all data in parallel to speed up the loading process (down form 10 seconds to 2/3)
        const [reader1Data, reader2Data, participants] = await Promise.all([
            getReaderData(raceName, '192.168.10.1'),
            getReaderData(raceName, '192.168.10.2'),
            getAllParticipants(raceName),
        ]);

        const raceResults = Object.keys(reader1Data).reduce((results, tagId) => {
            const normalizedTagId = tagId.trim().replace(/\s+/g, ''); // Normalize tag ID
            
            // Skip if the tag is not found in Reader 2 data
            if (!reader2Data[normalizedTagId]) {
                console.log(`Tag ${tagId} not found in Reader 2.`);
                return results;
            }

            const reader1 = reader1Data[tagId];
            const reader2 = reader2Data[normalizedTagId];

            const reader1DateTime = new Date(`${reader1.date}T${reader1.time}`);
            const reader2DateTime = new Date(`${reader2.date}T${reader2.time}`);
            const timeDifferenceMs = Math.abs(reader2DateTime - reader1DateTime);

            const participant = participants[normalizedTagId];
            const participantName = participant
                ? `${participant.firstName} ${participant.lastName}`
                : `Participant with tag ${tagId}`;
            
            results.push({
                participantName,
                start: reader1.time,
                finish: reader2.time,
                timeTaken: timeDifferenceMs,
            });

            return results;
        }, []);

        // Sort results by time taken
        raceResults.sort((a, b) => a.timeTaken - b.timeTaken);

        if (raceResults.length === 0) {
            return res.render('race-results', { raceResults: [], raceName, message: 'No race results available.' });
        }

        // Assign rank and calculate time differences
        const fastestTime = raceResults[0].timeTaken; // Time taken by the leader
        raceResults.forEach((result, index) => {
            result.rank = index + 1;
            result.timeTakenFormatted = new Date(result.timeTaken).toISOString().substr(11, 8); // Format HH:MM:SS
            result.timeDifference = index === 0
                ? 'Leader'
                : `+${Math.floor((result.timeTaken - fastestTime) / 60000)}:${(((result.timeTaken - fastestTime) % 60000) / 1000).toFixed(0).padStart(2, '0')}`;
        });

        // Render results with race name
        res.render('race-results', { raceResults, raceName });
    } catch (error) {
        console.error('Error fetching or processing data:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/select-result-type', (req, res) => {
    const raceName = req.query.race;

    if (!raceName) {
        return res.status(400).send('Race name is required.');
    }

    res.render('select-race-type', { raceName });
});

// Participant form route
app.get('/participant-form', (req, res) => {
    res.render('participant-form');
});

// Submit participant details
app.post('/submit-participant', async (req, res) => {
    const { raceName, firstName, lastName, age, gender, tagNumber } = req.body;

    if (!raceName || !tagNumber) {
        return res.status(400).json({ success: false, message: 'Race name and tag number are required.' });
    }

    try {
        await db
            .collection('Races')
            .doc(raceName)
            .collection('Participants')
            .doc(tagNumber)
            .set({
                firstName,
                lastName,
                age: parseInt(age),
                gender,
                tagNumber,
            });

        res.json({ success: true, message: `Participant ${firstName} ${lastName} added successfully.` });
    } catch (error) {
        console.error('Error saving participant data:', error);
        res.status(500).json({ success: false, message: 'Failed to submit participant information.' });
    }
});


//---------------------TESTING---------------------
app.get('/inject-test-data', async (req, res) => {
    const raceName = req.query.race || 'Test'; // Default name

    const readers = [
        '192.168.10.1', 
        '192.168.10.2', 
    ];

    const tags = [
        { id: '0100', reader1Time: '12:00:00', reader2Time: '12:04:15' },
        { id: '0101', reader1Time: '12:05:30', reader2Time: '12:09:45' },
        { id: '0102', reader1Time: '12:10:45', reader2Time: '12:14:00' },
        { id: '0103', reader1Time: '12:15:15', reader2Time: '12:19:30' },
        { id: '0104', reader1Time: '12:20:00', reader2Time: '12:24:15' },
        { id: '0105', reader1Time: '12:25:45', reader2Time: '12:29:00' },
        { id: '0106', reader1Time: '12:30:30', reader2Time: '12:32:45' },
        { id: '0107', reader1Time: '12:35:00', reader2Time: '12:38:15' },
        { id: '0108', reader1Time: '12:40:15', reader2Time: '12:46:30' },
        { id: '0109', reader1Time: '12:45:00', reader2Time: '12:46:15' },
    ];

    try {
        for (const tag of tags) {
            // Inject data for reader 192.168.10.1
            const reader1Ref = db
                .collection('RFIDReaders')
                .doc(raceName) 
                .collection('192.168.10.1')
                .doc(tag.id); 
            
            await reader1Ref.set({
                date: '2024-11-20',
                time: tag.reader1Time,
            });

            // Inject data for reader 192.168.10.2
            const reader2Ref = db
                .collection('RFIDReaders')
                .doc(raceName) 
                .collection('192.168.10.2') 
                .doc(tag.id); 
            
            await reader2Ref.set({
                date: '2024-11-20',
                time: tag.reader2Time,
            });

            console.log(`Inserted tag ${tag.id} with times for both readers in race ${raceName}.`);
        }

        res.send(`Test data injection complete for race: ${raceName}`);
    } catch (error) {
        console.error('Error injecting test data:', error);
        res.status(500).send('Failed to inject test data.');
    }
});

app.get('/list-races', async (req, res) => {
    try {
        const racesSnapshot = await db.collection('RFIDReaders').get();

        if (racesSnapshot.empty) {
            console.log('No documents found in RFIDReaders collection.');
            return res.json({ races: [] });
        }

        // Log all document IDs
        racesSnapshot.docs.forEach(doc => {
            console.log('Found document:', doc.id);
        });

        const races = racesSnapshot.docs.map(doc => doc.id);
        console.log('Fetched races:', races);

        res.json({ races });
    } catch (error) {
        console.error('Error fetching races:', error);
        res.status(500).send('Failed to fetch races.');
    }
});

app.get('/inject-test-data-1', async (req, res) => {
    const testRaces = ['Test1', 'Test2', 'Test3'];

    try {
        for (const race of testRaces) {
            await db.collection('RFIDReaders').doc(race).set({ dummyField: true });
        }
        console.log('Injected test races:', testRaces);
        res.send(`Injected races: ${testRaces.join(', ')}`);
    } catch (error) {
        console.error('Error injecting test data:', error);
        res.status(500).send('Failed to inject test data.');
    }
});


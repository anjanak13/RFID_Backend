const express = require('express');
const router = express.Router();
const { isAdmin, isAuthenticated, getReaderData, getAllParticipants } = require('../config/helpers'); // Update with correct imports
const db = require('../firebaseConfig');

//---------------------------------------------------------------------------------
// *****************************    GET Routes    *********************************
//---------------------------------------------------------------------------------

// Route to display the registration form with available races
router.get('/register', async (req, res) => {
    try {
        const racesSnapshot = await db.collection('RFIDReaders').get();
        const races = racesSnapshot.docs.map(doc => doc.id); // Assuming the race name is the document ID
        res.render('user/register', { races });
    } catch (error) {
        console.error('Error fetching races:', error);
        res.status(500).send('Failed to fetch available races.');
    }
});

// Login page route
router.get('/login', (req, res) => {
    res.render('user/login');
});

// Route for the welcome screen (publicly accessible)
router.get('/', async (req, res) => {
    try {
        const racesSnapshot = await db.collection('RFIDReaders').get();

        if (racesSnapshot.empty) {
            console.log('No races found in the RFIDReaders collection.');
            return res.render('home', { races: [] }); // Display empty races if none found
        }

        const races = racesSnapshot.docs.map((doc) => doc.id); // Collect document IDs (races)
        console.log('Fetched races:', races);

        res.render('home', { races }); // Render home page with races
    } catch (error) {
        console.error('Error fetching races:', error);
        res.status(500).send('Failed to fetch races.');
    }
});

router.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        const username = req.user.username;
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            req.flash('error_msg', 'User not found.');
            return res.redirect('/login');
        }

        const userData = userDoc.data();
        const firstName = userData.firstName; 

        res.render('admin/adminDashboard', { 
            firstName
        });

    } catch (error) {
        
    }
});

// Dashboard route
router.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');
    }

    try {
        const username = req.user.username;
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            req.flash('error_msg', 'User not found.');
            return res.redirect('/login');
        }

        const userData = userDoc.data();
        const firstName = userData.firstName; 
        const userRaces = userData.races || []; // Races the user is associated with

        // Fetch all races from RFIDReaders collection
        const racesSnapshot = await db.collection('RFIDReaders').get();
        const allRaces = racesSnapshot.docs.map(doc => ({
            raceName: doc.id,
        }));

        // Filter out races the user already has access to
        const availableRaces = allRaces.filter(race => 
            !userRaces.some(userRace => userRace.raceName === race.raceName)
        );

        // Filter for approved races
        const approvedRaces = userRaces.filter(race => race.status === 'approved');

        // Render the dashboard view, passing flash messages
        res.render('user/dashboard', { 
            races: approvedRaces, 
            allRaces: availableRaces,
            firstName
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        req.flash('error_msg', 'Failed to load dashboard.');
        res.redirect('/login');
    }
});


// Participant form route (protected)
router.get('/participant-form', isAuthenticated, async (req, res) => {
    const username = req.user.username;
    const selectedRace = req.query.race; // Retrieve the race from the query parameter

    try {
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists || userDoc.data().status !== 'approved') {
            req.flash('error_msg', 'You must be approved by an admin before adding participants.');
            return res.redirect('/welcome');
        }

        const races = userDoc.data().races || []; // Get the races array

        // Ensure the selected race is part of the user's approved races
        const approvedRaces = races.filter(race => race.status === 'approved');
        const isRaceAuthorized = approvedRaces.some(race => race.raceName === selectedRace);

        if (!selectedRace || !isRaceAuthorized) {
            req.flash('error_msg', 'Invalid or unauthorized race selection.');
            return res.redirect('/dashboard');
        }

        res.render('user/participant-form', { race: selectedRace, username });
    } catch (error) {
        console.error('Error fetching user data:', error);
        req.flash('error_msg', 'Failed to load participant form.');
        res.redirect('/dashboard');
    }
});

router.get('/admin/login', (req, res) => {
    res.render('admin/admin-login', {
        message: req.flash('error') || 'This page is only for admins.', // Default message
    });
});

router.get('/admin/approve', isAdmin, async (req, res) => {
    try {
        // Fetch pending users
        const pendingSnapshot = await db.collection('Users').where('status', '==', 'pending').get();
        const pendingUsers = pendingSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            races: doc.data().races || [] // Default to empty array if undefined
        }));

        // Fetch approved users
        const approvedSnapshot = await db.collection('Users').where('status', '==', 'approved').get();
        const approvedUsers = approvedSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            races: doc.data().races || [] // Default to empty array if undefined
        }));

        // Render the page with both pending and approved users
        res.render('admin/admin-approve', { pendingUsers, approvedUsers });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).send('Failed to fetch users.');
    }
});


// Sorted Race results route
router.get('/sorted-race-results', async (req, res) => {
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

            // Categorize participants based on age and gender
            if (gender === 'Other') {
                // Participants with gender "Other" go into Uncategorized
                categories['Uncategorized'].push(result);
            } else if (age >= 16 && age <= 39) {
                categories[gender === 'Male' ? 'Men (16-39)' : 'Women (16-39)'].push(result);
            } else if (age >= 40) {
                categories[gender === 'Male' ? 'Men (40+)' : 'Women (40+)'].push(result);
            } else if (age < 16) {
                categories[gender === 'Male' ? 'Men (under 16)' : 'Women (under 16)'].push(result);
            }
        });

        // Sort results within each category by time and calculate rank and gap
        Object.keys(categories).forEach((category) => {
            const results = categories[category];

            results.sort((a, b) => a.time - b.time);

            if (results.length > 0) {
                const fastestTime = results[0].time; // Fastest time in the category

                results.forEach((result, index) => {
                    result.rank = index + 1;
                    result.timeDifference = index === 0
                        ? 'Leader'
                        : `+${Math.floor((result.time - fastestTime) / 60000)}:${(((result.time - fastestTime) % 60000) / 1000)
                            .toFixed(0)
                            .padStart(2, '0')}`;
                });
            }
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
        res.render('public/cat-results', { categoryStats, raceName });
    } catch (error) {
        console.error('Error processing race results:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Race results overview
router.get('/race-results', async (req, res) => {
    const raceName = req.query.race; // Get race name from the query parameter

    if (!raceName) {
        return res.status(400).send('Race name is required.');
    }

    try {
        // Fetch all data in parallel to speed up the loading process
        const [reader1Data, reader2Data, participants] = await Promise.all([
            getReaderData(raceName, '192.168.10.1'),
            getReaderData(raceName, '192.168.10.2'),
            getAllParticipants(raceName),
        ]);

        const raceResults = [];
        const pendingResults = [];

        Object.keys(reader1Data).forEach(tagId => {
            const normalizedTagId = tagId.trim().replace(/\s+/g, ''); // Normalize tag ID
            const reader1 = reader1Data[tagId];
            const reader2 = reader2Data[normalizedTagId];

            const participant = participants[normalizedTagId];
            const participantName = participant
                ? `${participant.firstName} ${participant.lastName}`
                : `Participant with tag ${tagId}`;

            if (!reader2) {
                // Add to pending results if timing exists in reader1 but not reader2
                pendingResults.push({
                    participantName,
                    start: reader1.time,
                });
            } else {
                // Calculate race results if timing exists in both readers
                const reader1DateTime = new Date(`${reader1.date}T${reader1.time}`);
                const reader2DateTime = new Date(`${reader2.date}T${reader2.time}`);
                const timeDifferenceMs = Math.abs(reader2DateTime - reader1DateTime);

                raceResults.push({
                    participantName,
                    start: reader1.time,
                    finish: reader2.time,
                    timeTaken: timeDifferenceMs,
                });
            }
        });

        // Sort completed race results by time taken
        raceResults.sort((a, b) => a.timeTaken - b.timeTaken);

        // Assign rank and calculate time differences
        if (raceResults.length > 0) {
            const fastestTime = raceResults[0].timeTaken; // Time taken by the leader
            raceResults.forEach((result, index) => {
                result.rank = index + 1;
                result.timeTakenFormatted = new Date(result.timeTaken).toISOString().substr(11, 8); // Format HH:MM:SS
                result.timeDifference = index === 0
                    ? 'Leader'
                    : `+${Math.floor((result.timeTaken - fastestTime) / 60000)}:${(((result.timeTaken - fastestTime) % 60000) / 1000).toFixed(0).padStart(2, '0')}`;
            });
        }

        // Render results with race name
        res.render('public/race-results', { raceResults, pendingResults, raceName });
    } catch (error) {
        console.error('Error fetching or processing data:', error);
        res.status(500).send('Internal Server Error');
    }
});


router.get('/select-result-type', (req, res) => {
    const raceName = req.query.race;

    if (!raceName) {
        return res.status(400).send('Race name is required.');
    }

    res.render('public/select-race-type', { raceName });
});

router.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/login');
    });
});


// TESTING NEW EDITING

router.get('/update-results', isAuthenticated, async (req, res) => {
    const raceName = req.query.race; // Get race name from the query parameter

    if (!raceName) {
        return res.status(400).send('Race name is required.');
    }

    try {
        // Fetch all data in parallel
        const [reader1Data, reader2Data, participants] = await Promise.all([
            getReaderData(raceName, '192.168.10.1'),
            getReaderData(raceName, '192.168.10.2'),
            getAllParticipants(raceName),
        ]);

        const raceResults = Object.keys(reader1Data).reduce((results, tagId) => {
            const normalizedTagId = tagId.trim().replace(/\s+/g, ''); // Normalize tag ID

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
                tagId: normalizedTagId,
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
            return res.render('update-results', { raceResults: [], raceName, message: 'No race results available for editing.' });
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

        // Render update-results view
        res.render('user/update-results', { raceResults, raceName, message: null });
    } catch (error) {
        console.error('Error fetching or processing data:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/update-participant-details', isAuthenticated, async (req, res) => {
    const raceName = req.query.race; // Race name from query parameter

    if (!raceName) {
        req.flash('error_msg', 'Race name is required.');
        return res.redirect('/dashboard');
    }

    try {
        // Fetch participants for the specified race
        const participantsRef = db.collection('Races').doc(raceName).collection('Participants');
        const snapshot = await participantsRef.get();

        // Map participants to an array
        const participants = snapshot.docs.map(doc => ({
            tagNumber: doc.id, // Tag number is the document ID
            ...doc.data(), // Spread other participant fields
        }));

        // Render the page with participant data
        res.render('user/update-participant-details', {
            raceName,
            participants
        });
    } catch (error) {
        console.error('Error fetching participant data:', error);
        req.flash('error_msg', 'Failed to load participant data.');
        res.redirect('/dashboard');
    }
});


module.exports = router;
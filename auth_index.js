const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./firebaseConfig');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const session = require('express-session');
const flash = require('connect-flash');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup
app.use(session({
    secret: 'KitKats-are-Amazing-Aj13', // Use a strong secret in production
    resave: false,
    saveUninitialized: true,
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
app.use(flash()); 

function isAdmin(req, res, next) {
    // Check if the user is authenticated and has admin privileges
    if (req.isAuthenticated() && req.user.role === 'admin') {
        return next();
    }

    // Render login page with an alert message
    req.flash('error', 'Access restricted to admins only. Please log in as an admin.');
    res.redirect('/admin/login');
}



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

app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    next();
});

// Passport Local Strategy
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const userRef = db.collection('Users').doc(username);
        const doc = await userRef.get();

        if (!doc.exists) {
            return done(null, false, { message: 'Invalid username' });
        }

        const user = doc.data();

        // Check if user status is "approved"
        if (user.status !== "approved") {
            return done(null, false, { message: 'Pending approval, please contact your race administrator' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            return done(null, user);
        } else {
            return done(null, false, { message: 'Invalid password' });
        }
    } catch (err) {
        return done(err);
    }
}));


// Serialize user info into session
passport.serializeUser((user, done) => {
    done(null, user.username);
});

// Deserialize user info from session
passport.deserializeUser(async (username, done) => {
    try {
        const userRef = db.collection('Users').doc(username);
        const doc = await userRef.get();
        const user = doc.data();
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Route to display the registration form with available races
app.get('/register', async (req, res) => {
    try {
        const racesSnapshot = await db.collection('RFIDReaders').get();
        const races = racesSnapshot.docs.map(doc => doc.id); // Assuming the race name is the document ID
        res.render('register', { races });
    } catch (error) {
        console.error('Error fetching races:', error);
        res.status(500).send('Failed to fetch available races.');
    }
});

// Handle registration form submission
app.post('/register', async (req, res) => {
    const { firstName, lastName, phone, username, password, race } = req.body;

    try {
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            return res.status(400).send('User already exists');
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the user document in Firestore
        await userRef.set({
            firstName,
            lastName,
            phone,
            username,
            password: hashedPassword,
            race,
            role: 'user', // Assign default role as user
            status: 'pending', // Default status is pending
        });

        res.redirect('/login');
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).send('Failed to create user');
    }
});

// Login page route
app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/participant-form', // Redirect to welcome page if login is successful
        failureRedirect: '/login',
        failureFlash: true  // Enable flash messages on failure
    })(req, res, next);
});

// Route for the welcome screen (publicly accessible)
app.get('/welcome', async (req, res) => {
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


app.get('/admin/login', (req, res) => {
    res.render('admin-login', {
        message: req.flash('error') || 'This page is only for admins.', // Default message
    });
});


app.post('/admin/login', passport.authenticate('local', {
    successRedirect: '/admin/approve', // Redirect to admin approval page
    failureRedirect: '/admin/login',  // Redirect back to login on failure
    failureFlash: true                // Flash messages for errors
}));


app.get('/admin/approve', isAdmin, async (req, res) => {
    try {
        // Fetch pending users
        const pendingSnapshot = await db.collection('Users').where('status', '==', 'pending').get();
        const pendingUsers = pendingSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Fetch approved users
        const approvedSnapshot = await db.collection('Users').where('status', '==', 'approved').get();
        const approvedUsers = approvedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Render the page with both pending and approved users
        res.render('admin-approve', { pendingUsers, approvedUsers });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).send('Failed to fetch users.');
    }
});


app.post('/admin/approve/:username', isAdmin, async (req, res) => {
    const { username } = req.params;

    try {
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send('User not found');
        }

        // Update user status to 'approved'
        await userRef.update({
            status: 'approved',
        });

        res.redirect('/admin/approve');
    } catch (error) {
        console.error('Error updating user status:', error);
        res.status(500).send('Failed to approve user');
    }
});

app.post('/admin/revoke/:username', isAdmin, async (req, res) => {
    const { username } = req.params;

    try {
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send('User not found');
        }

        // Update user status back to 'pending'
        await userRef.update({
            status: 'pending',
        });

        res.redirect('/admin/approve');
    } catch (error) {
        console.error('Error revoking user access:', error);
        res.status(500).send('Failed to revoke user access.');
    }
});



// Ensure user is authenticated before allowing access to the participant form
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.redirect('/login');
    }
}

// Participant form route (protected)
app.get('/participant-form', isAuthenticated, (req, res) => {
    const username = req.user.username;
    const userRef = db.collection('Users').doc(username);
    userRef.get().then((userDoc) => {
        if (userDoc.exists && userDoc.data().status === 'approved') {
            const race = userDoc.data().race;
            res.render('participant-form', { race,username });
        } else {
            req.flash('error_msg', 'You must be approved by an admin before adding participants.');
            res.redirect('/welcome');
        }
    });
});

// Use the isAuthenticated middleware for the route
app.post('/submit-participant', isAuthenticated, async (req, res) => {
    const { raceName, firstName, lastName, age, gender, tagNumber } = req.body;
    const username = req.user.username; // Assuming the username is stored in req.user (from Passport.js)

    if (!raceName || !tagNumber) {
        return res.status(400).json({ success: false, message: 'Race name and tag number are required.' });
    }

    try {
        // Store participant data under the race name and tag number
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
                username, // Save the username to associate with the logged-in user
            });

        res.json({ success: true, message: `Participant ${firstName} ${lastName} added successfully.` });
    } catch (error) {
        console.error('Error saving participant data:', error);
        res.status(500).json({ success: false, message: 'Failed to submit participant information.' });
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

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/login');
    });
});

// Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

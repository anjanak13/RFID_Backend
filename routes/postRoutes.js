const express = require('express');
const router = express.Router();
const { isAdmin, isAuthenticated } = require('../config/helpers');
const db = require('../firebaseConfig');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

//---------------------------------------------------------------------------------
// ****************************    POST Routes    ********************************
//---------------------------------------------------------------------------------

// Configure transporter with Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});

// User Logins
router.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/dashboard', // Redirect to welcome page if login is successful
        failureRedirect: '/login',
        failureFlash: true  // Enable flash messages on failure
    })(req, res, next);
});

// Admin Logins
router.post('/admin/login', passport.authenticate('local', {
    successRedirect: '/admin/dashboard', // Redirect to admin approval page
    failureRedirect: '/admin/login',  // Redirect back to login on failure
    failureFlash: true                // Flash messages for errors
}));

// Handle registration form submission
// Handle registration form submission
router.post('/register', async (req, res) => {
    const { firstName, lastName, phone, username, password, race } = req.body;

    try {
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            return res.status(400).send('User already exists');
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Convert race to an array of objects with a pending status
        const races = Array.isArray(race)
            ? race.map(r => ({ raceName: r, status: 'pending' }))
            : [{ raceName: race, status: 'pending' }];

        // Create the user document in Firestore
        await userRef.set({
            firstName,
            lastName,
            phone,
            username,
            password: hashedPassword,
            races, // Save races as objects with status
            role: 'user', // Assign default role as user
            status: 'pending', // Default status is pending
        });

        // Send account creation email
        const mailOptions = {
            from: `"Race Approval Team" <${process.env.GMAIL_USER}>`, // Replace with your email
            to: username, // User's email (assuming 'username' is the email)
            subject: 'Account Created Successfully',
            text: `Hello ${firstName},\n\nWelcome to our race management system! Your account has been successfully created. You will be able to access your account as soon as it gets approved by the administrator.\n\nBest regards,\nThe Race Approval Team`,

        };

        await transporter.sendMail(mailOptions);
        console.log(`Account creation email sent to ${username}`);

        res.redirect('/login');
    } catch (error) {
        console.error('Error registering user or sending email:', error);
        res.status(500).send('Failed to create user');
    }
});



// User Approval from Admin
router.post('/admin/approve/:username', isAdmin, async (req, res) => {
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

        // Get the user's email from Firestore
        const userData = userDoc.data();
        const firstName = userData.firstName; 

        // Send an approval email
        const mailOptions = {
            from: '"Race Approval Team" <${process.env.GMAIL_USER}>',
            to: username, // User's email
            subject: 'Race Approval Notification',
            text: `Hello ${firstName},\n\nCongratulations! Your account has been successfully approved. You now have access to edit and manage race information.\n\nBest regards,\nRace Approval Team`,
        };

        await transporter.sendMail(mailOptions);

        req.flash('success_msg', `Access Granted to user "${firstName}". Email sent to ${username}.`);
        res.redirect('/admin/approve');
    } catch (error) {
        console.error('Error approving user or sending email:', error);
        res.status(500).send('Failed to approve user and send email');
    }
});


// To Revoke User Access from Admin
router.post('/admin/revoke/:username', isAdmin, async (req, res) => {
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

        req.flash('warning_msg', `Access revoked from user "${username}".`);
        res.redirect('/admin/approve');
    } catch (error) {
        console.error('Error revoking user access:', error);
        res.status(500).send('Failed to revoke user access.');
    }
});

// Use the isAuthenticated middleware for the route
router.post('/submit-participant', isAuthenticated, async (req, res) => {
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

router.post('/update-timings', isAuthenticated, async (req, res) => {
    const {
        participantId, // Example: "0100"
        startHours, startMinutes, startSeconds,
        endHours, endMinutes, endSeconds,
    } = req.body;

    const raceName = req.query.race; // Example: "Californian Marathon"
    const reader1 = '192.168.10.1'; // Reader 1
    const reader2 = '192.168.10.2'; // Reader 2

    try {
        // Construct start and end times in HH:MM:SS format
        const startTime = `${startHours.padStart(2, '0')}:${startMinutes.padStart(2, '0')}:${startSeconds.padStart(2, '0')}`;
        const endTime = `${endHours.padStart(2, '0')}:${endMinutes.padStart(2, '0')}:${endSeconds.padStart(2, '0')}`;

        // Firestore paths
        const reader1Path = `RFIDReaders/${raceName}/${reader1}/${participantId}`;
        const reader2Path = `RFIDReaders/${raceName}/${reader2}/${participantId}`;

        // Update the start time in Reader 1 and end time in Reader 2
        await Promise.all([
            db.doc(reader1Path).update({ time: startTime }),
            db.doc(reader2Path).update({ time: endTime }),
        ]);

        req.flash('success_msg', 'Timings updated successfully!');
        res.redirect(`/update-results?race=${raceName}`);
    } catch (error) {
        console.error('Error updating timings:', error);
        req.flash('error_msg', 'Failed to update timings.');
        res.redirect(`/update-results?race=${raceName}`);
    }
});

// Approve a specific race for a user
router.post('/admin/approve-race/:username', isAdmin, async (req, res) => {
    const { username } = req.params;
    const { raceName } = req.body;

    try {
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send('User not found');
        }

        const updatedRaces = userDoc.data().races.map(race =>
            race.raceName === raceName ? { ...race, status: 'approved' } : race
        );

        await userRef.update({ races: updatedRaces });

        req.flash('success_msg', `Access to race "${raceName}" granted to user "${username}".`);
        res.redirect('/admin/approve');
    } catch (error) {
        console.error('Error approving race:', error);
        res.status(500).send('Failed to approve race.');
    }
});

// Revoke a specific race for a user
router.post('/admin/revoke-race/:username', isAdmin, async (req, res) => {
    console.log('Revoke race route triggered');
    const { username } = req.params;
    const { raceName } = req.body;

    try {
        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send('User not found');
        }

        const updatedRaces = userDoc.data().races.map(race =>
            race.raceName === raceName ? { ...race, status: 'pending' } : race
        );

        await userRef.update({ races: updatedRaces });
        req.flash('warning_msg', `Access to race "${raceName}" revoked from user "${username}".`);
        res.redirect('/admin/approve');
    } catch (error) {
        console.error('Error revoking race:', error);
        res.status(500).send('Failed to revoke race.');
    }
});

router.post('/request-access', isAuthenticated, async (req, res) => {
    const { raceName } = req.body;
    const username = req.user.username;

    try {
        if (!raceName) {
            req.flash('error_msg', 'Race name is required.');
            return res.redirect('/dashboard');
        }

        const userRef = db.collection('Users').doc(username);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            req.flash('error_msg', 'User not found.');
            return res.redirect('/dashboard');
        }

        const userData = userDoc.data();
        const races = userData.races || [];

        // Check if the race is already requested or approved
        const alreadyRequested = races.some(
            (race) => race.raceName === raceName
        );

        if (alreadyRequested) {
            req.flash('error_msg', 'You have already requested or have access to this race.');
            return res.redirect('/dashboard');
        }

        // Add the requested race to the user's races array with a pending status
        races.push({
            raceName,
            status: 'pending',
        });

        await userRef.update({ races });
        
        req.flash('success_msg', `Request for access to ${raceName} has been submitted.`);
        //console.log(req.flash());
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error handling access request:', error);
        req.flash('error_msg', 'Failed to submit access request. Please try again later.');
        res.redirect('/dashboard');
    }
});

router.post('/update-participant-details', isAuthenticated, async (req, res) => {
    const { raceName, participantId, newTagNumber, firstName, lastName, age, gender } = req.body;

    // Validate required fields
    if (!raceName || !participantId || !newTagNumber || !firstName || !lastName || !age || !gender) {
        req.flash('error_msg', 'All fields are required.');
        return res.redirect(`/update-participant-details?race=${raceName}`);
    }

    try {
        const participantsRef = db.collection('Races').doc(raceName).collection('Participants');
        const oldParticipantRef = participantsRef.doc(participantId); // Old document
        const newParticipantRef = participantsRef.doc(newTagNumber); // New document

        // Fetch the existing participant data
        const participantDoc = await oldParticipantRef.get();
        if (!participantDoc.exists) {
            req.flash('error_msg', 'Participant not found.');
            return res.redirect(`/update-participant-details?race=${raceName}`);
        }

        // Check if the new tag number already exists
        const newTagDoc = await newParticipantRef.get();
        if (newTagDoc.exists && participantId !== newTagNumber) {
            req.flash('error_msg', `Update Unsuccessful, Tag number ${newTagNumber} is already in use.`);
            return res.redirect(`/update-participant-details?race=${raceName}`);
        }

        // Merge existing data with the updated fields
        const updatedParticipantData = {
            ...participantDoc.data(), // Include existing data
            firstName,
            lastName,
            age: parseInt(age, 10),
            gender,
            tagNumber: newTagNumber, // Update tag number explicitly
        };

        // Write the updated data to the new tag number document
        await newParticipantRef.set(updatedParticipantData);

        // Delete the old document if the tag number has changed
        if (participantId !== newTagNumber) {
            await oldParticipantRef.delete();
        }

        if (participantId == newTagNumber){
            req.flash('success_msg', `Participant ${firstName} ${lastName}'s details successfully updated!`);
            return res.redirect(`/update-participant-details?race=${raceName}`);
        }
        
        req.flash('success_msg', `Participant ${firstName} ${lastName} successfully updated with new tag number ${newTagNumber}.`);
        //console.log(req.flash());
        res.redirect(`/update-participant-details?race=${raceName}`);
    } catch (error) {
        console.error('Error updating participant data:', error);
        req.flash('error_msg', 'Failed to update participant data. Please try again.');
        res.redirect(`/update-participant-details?race=${raceName}`);
    }
});

module.exports = router;
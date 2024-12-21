const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const db = require('../firebaseConfig');

// Configure Passport Local Strategy
passport.use(
    new LocalStrategy(async (username, password, done) => {
        try {
            const userRef = db.collection('Users').doc(username);
            const doc = await userRef.get();

            if (!doc.exists) {
                return done(null, false, { message: 'Invalid username' });
            }

            const user = doc.data();

            // Check if user status is "approved"
            if (user.status !== 'approved') {
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
    })
);

// Serialize user into the session
passport.serializeUser((user, done) => {
    done(null, user.username);
});

// Deserialize user from the session
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

module.exports = passport;

require('dotenv').config();
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
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: true,
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
app.use(flash()); 

app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.warning_msg = req.flash('warning_msg');
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

// Import routes
const getRoutes = require('./routes/getRoutes');
const postRoutes = require('./routes/postRoutes');

// Use routes
app.use('/', getRoutes);
app.use('/', postRoutes);

// Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

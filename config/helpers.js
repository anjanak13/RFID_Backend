const db = require('../firebaseConfig');

// Middleware: Check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.redirect('/login');
    }
}

// Middleware: Check if user is an admin
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'admin') {
        return next();
    }
    req.flash('error', 'Access restricted to admins only. Please log in as an admin.');
    res.redirect('/admin/login');
}

// Helper: Fetch all participants for a race
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

// Helper: Fetch reader data for a specific race
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

module.exports = {
    isAuthenticated,
    isAdmin,
    getAllParticipants,
    getReaderData,
};

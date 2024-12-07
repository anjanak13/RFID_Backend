# Express RFID Dashboard ⏱🏁

## Overview
This project is a Node.js application for managing RFID race data. It provides a dashboard for race participants, race results, and admin approvals. Built with Express, EJS, and Firebase, the application supports user authentication, role-based access control, and race-specific data storage in Firebase Firestore. The dashboard includes features for participant registration, race results visualization, and race management.

## Features
- **User Authentication**: Login functionality with Passport.js and bcrypt.
- **Role-based Access Control**: Admin-specific routes for managing user approvals and race access.
- **Participant Management**: Register participants and update details via a web interface.
- **Race Results**: Categorized and ranked race results with timing calculations.
- **Session and Flash Messages**: Display success, error, and warning messages using `express-session` and `connect-flash`.
- **Data Persistence**: Store user, participant, and race data in Firebase Firestore.

## Requirements

### Hardware:
- RFID readers connected to your network.

### Software:
- Node.js 14 or later.
- Firebase Firestore setup with appropriate credentials.

### Dependencies:
- `express`: Web framework for Node.js.
- `ejs`: Template engine for rendering dynamic views.
- `passport`: Middleware for user authentication.
- `passport-local`: Local authentication strategy for Passport.
- `bcryptjs`: For password hashing.
- `firebase-admin`: Firebase SDK for Firestore integration.
- `express-session`: Session management.
- `connect-flash`: Flash messages for user feedback.
- `cors`: Cross-origin resource sharing.

## Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/anjanak13/RFID_Backend.git
   cd <repository-directory>
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Firebase**:
   - Add your Firebase project credentials to a `firebaseConfig.js` file in the root directory.
   - Example `firebaseConfig.js`:
     ```javascript
     const admin = require('firebase-admin');
     const serviceAccount = require('./path/to/serviceAccountKey.json');

     admin.initializeApp({
         credential: admin.credential.cert(serviceAccount),
     });

     const db = admin.firestore();
     module.exports = db;
     ```

4. **Run the Application**:
   ```bash
   npm auth_index.js
   ```
   The application will be accessible at `http://localhost:3000`.

## How to Use

### Routes

#### Public Routes:
- `/welcome`: Home page listing available races.
- `/login`: User login page.
- `/register`: User registration form.

#### User Routes:
- `/dashboard`: User dashboard displaying approved and available races.
- `/participant-form`: Form for adding race participants.
- `/race-results`: Overview of race results.
- `/sorted-race-results`: Categorized and ranked race results.

#### Admin Routes:
- `/admin/login`: Admin login page.
- `/admin/approve`: Approve or revoke user access to races.
- `/admin/approve-race`: Approve specific races for users.
- `/admin/revoke-race`: Revoke user access to specific races.

### Participant and Race Management
- Add participants using the `/participant-form` route.
- View and update participant details via `/update-participant-details`.
- Update timing data for participants with `/update-timings`.

### Race Results
- View race results with `/race-results` and `/sorted-race-results`.
- Results include ranks, timing calculations, and categorization by age and gender.

## Data Storage Structure

### Firestore Collections:
- **Users**:
  ```
  Users/{username}
  ```
  Fields:
  - `username`
  - `password` (hashed)
  - `role` (e.g., user/admin)
  - `status` (e.g., approved/pending)
  - `races` (array of objects with raceName and status)

- **Races**:
  ```
  Races/{raceName}/Participants/{tagNumber}
  ```
  Fields:
  - `firstName`
  - `lastName`
  - `age`
  - `gender`
  - `tagNumber`

- **RFIDReaders**:
  ```
  RFIDReaders/{raceName}/{readerIp}/{epc}
  ```
  Fields:
  - `date`
  - `time`

## Notes
- Ensure Firebase credentials are correctly configured in `firebaseConfig.js`.
- Use strong secrets for sessions in production.
- Network connectivity is required for accessing Firebase and RFID readers.

## Limitations
- Only supports local authentication (no OAuth integration).
- Assumes two RFID readers per race.
- Requires manual setup of Firebase Firestore structure.

## Troubleshooting

### Common Issues:
- **Firebase Errors**:
  - Verify the service account credentials.
  - Check Firestore permissions.

- **Login Issues**:
  - Ensure users are approved by an admin.
  - Check hashed passwords.

- **Race Results Missing**:
  - Verify timing data is properly uploaded to Firestore.
  - Ensure RFID readers are operational.


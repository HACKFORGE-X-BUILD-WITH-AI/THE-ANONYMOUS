require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');

// Initialize Express
const app = express();
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ server, path: '/ws' });

// Twilio Client
const twilioClient = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Database Configuration
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true
  }
};

// Database Connection Pool
let pool;
async function connectDB() {
  try {
    pool = await sql.connect(dbConfig);
    console.log('Database connected successfully');
    
    // Verify tables exist or create them
    await verifyDatabaseSchema();
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
}

// Verify/Create Database Tables
async function verifyDatabaseSchema() {
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
      CREATE TABLE Users (
        UserID INT IDENTITY(1,1) PRIMARY KEY,
        FullName NVARCHAR(100) NOT NULL,
        Email NVARCHAR(100) NOT NULL UNIQUE,
        PhoneNumber NVARCHAR(20) NOT NULL,
        PasswordHash NVARCHAR(255) NOT NULL,
        BloodGroup NVARCHAR(5) NOT NULL CHECK (BloodGroup IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
        Role NVARCHAR(20) NOT NULL CHECK (Role IN ('admin', 'donor')),
        CreatedAt DATETIME DEFAULT GETDATE(),
        LastLogin DATETIME NULL
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Donors' AND xtype='U')
      CREATE TABLE Donors (
        DonorID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
        Availability BIT DEFAULT 1,
        LastDonationDate DATETIME NULL,
        HealthStatus NVARCHAR(50) NULL,
        CONSTRAINT UQ_Donor_User UNIQUE (UserID)
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='BloodInventory' AND xtype='U')
      CREATE TABLE BloodInventory (
        InventoryID INT IDENTITY(1,1) PRIMARY KEY,
        BloodGroup NVARCHAR(5) NOT NULL CHECK (BloodGroup IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
        UnitsAvailable INT NOT NULL DEFAULT 0,
        LastUpdated DATETIME DEFAULT GETDATE(),
        CONSTRAINT UQ_BloodGroup UNIQUE (BloodGroup)
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Requests' AND xtype='U')
      CREATE TABLE Requests (
        RequestID INT IDENTITY(1,1) PRIMARY KEY,
        PatientName NVARCHAR(100) NOT NULL,
        BloodGroup NVARCHAR(5) NOT NULL CHECK (BloodGroup IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
        DonorID INT NOT NULL FOREIGN KEY REFERENCES Donors(DonorID),
        DonorName NVARCHAR(100) NOT NULL,
        HospitalName NVARCHAR(100) NOT NULL,
        Location NVARCHAR(255) NOT NULL,
        ContactNumber NVARCHAR(20) NOT NULL,
        RequestDate DATETIME DEFAULT GETDATE(),
        Status NVARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (Status IN ('Pending', 'Accepted', 'Rejected', 'Completed')),
        UrgencyLevel NVARCHAR(20) NOT NULL DEFAULT 'Medium' CHECK (UrgencyLevel IN ('Low', 'Medium', 'High', 'Critical')),
        OTP NVARCHAR(6) NULL,
        OTPExpiry DATETIME NULL
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Donations' AND xtype='U')
      CREATE TABLE Donations (
        DonationID INT IDENTITY(1,1) PRIMARY KEY,
        RequestID INT NOT NULL FOREIGN KEY REFERENCES Requests(RequestID),
        DonorID INT NOT NULL FOREIGN KEY REFERENCES Donors(DonorID),
        DonorName NVARCHAR(100) NOT NULL,
        DonationDate DATETIME DEFAULT GETDATE(),
        Status NVARCHAR(20) NOT NULL DEFAULT 'Scheduled' CHECK (Status IN ('Scheduled', 'Completed', 'Cancelled')),
        UnitsDonated DECIMAL(5,2) NULL,
        Notes NVARCHAR(MAX) NULL
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Notifications' AND xtype='U')
      CREATE TABLE Notifications (
        NotificationID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
        RequestID INT NULL FOREIGN KEY REFERENCES Requests(RequestID),
        Type NVARCHAR(50) NOT NULL,
        Title NVARCHAR(100) NOT NULL,
        Message NVARCHAR(MAX) NOT NULL,
        IsRead BIT DEFAULT 0,
        CreatedAt DATETIME DEFAULT GETDATE()
      )
    `);

    console.log('Database schema verified/created successfully');
  } catch (err) {
    console.error('Error verifying database schema:', err);
    throw err;
  }
}

// Active WebSocket Connections
const connections = new Map();

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  const token = new URLSearchParams(req.url.split('?')[1]).get('token');
  if (!token) return ws.close();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    connections.set(decoded.userId, ws);

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      ws.close();
    });

    ws.on('close', () => {
      connections.delete(decoded.userId);
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'response') {
          await handleDonorResponse(message.requestId, message.accepted, decoded);
        }
      } catch (err) {
        console.error('Message processing error:', err);
      }
    });

  } catch (err) {
    console.error('WebSocket authentication error:', err);
    ws.close();
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get(['/', '/login'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/donor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'donor.html'));
});

// API Endpoints

// Login Endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    // Validation
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Find user
    const result = await pool.request()
      .input('email', sql.VarChar, email)
      .query('SELECT * FROM Users WHERE Email = @email');

    const user = result.recordset[0];

    // Verify user exists and role matches
    if (!user || user.Role !== role) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.PasswordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.UserID,
        name: user.FullName,
        email: user.Email,
        phone: user.PhoneNumber,
        bloodGroup: user.BloodGroup,
        role: user.Role
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Update last login
    await pool.request()
      .input('userId', sql.Int, user.UserID)
      .query('UPDATE Users SET LastLogin = GETDATE() WHERE UserID = @userId');

    // Successful response
    res.json({
      success: true,
      token,
      user: {
        id: user.UserID,
        name: user.FullName,
        email: user.Email,
        role: user.Role
      },
      redirect: user.Role === 'admin' ? '/admin' : '/donor'
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Registration Endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password, bloodGroup, role } = req.body;

    // Validation
    if (!name || !email || !phone || !password || !bloodGroup || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const userExists = await pool.request()
      .input('email', sql.VarChar, email)
      .query('SELECT UserID FROM Users WHERE Email = @email');

    if (userExists.recordset.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const result = await pool.request()
      .input('name', sql.VarChar, name)
      .input('email', sql.VarChar, email)
      .input('phone', sql.VarChar, phone)
      .input('password', sql.VarChar, hashedPassword)
      .input('bloodGroup', sql.VarChar, bloodGroup)
      .input('role', sql.VarChar, role)
      .query(`
        INSERT INTO Users (FullName, Email, PhoneNumber, PasswordHash, BloodGroup, Role) 
        OUTPUT INSERTED.UserID, INSERTED.FullName, INSERTED.Email, INSERTED.Role
        VALUES (@name, @email, @phone, @password, @bloodGroup, @role)
      `);

    const newUser = result.recordset[0];

    // If donor, add to Donors table
    if (role === 'donor') {
      await pool.request()
        .input('userId', sql.Int, newUser.UserID)
        .query('INSERT INTO Donors (UserID) VALUES (@userId)');
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: newUser.UserID,
        name: newUser.FullName,
        email: newUser.Email,
        phone: phone,
        bloodGroup: bloodGroup,
        role: role
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: newUser.UserID,
        name: newUser.FullName,
        email: newUser.Email,
        role: newUser.Role
      }
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ 
      error: 'Server error during registration',
      details: err.message 
    });
  }
});

// Dashboard Data Endpoint
app.get('/api/dashboard-data', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authorization token required' });

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Execute all queries in parallel
    const [totalDonors, pendingRequests, completedDonations, inventoryResult, activeRequests] = await Promise.all([
      pool.request().query(`
        SELECT COUNT(*) AS count 
        FROM Donors d
        JOIN Users u ON d.UserID = u.UserID
        WHERE d.Availability = 1
      `),
      pool.request().query(`
        SELECT COUNT(*) AS count 
        FROM Requests 
        WHERE Status = 'Pending'
      `),
      pool.request().query(`
        SELECT COUNT(*) AS count 
        FROM Donations 
        WHERE Status = 'Completed'
          AND DonationDate >= DATEADD(month, -1, GETDATE())
      `),
      pool.request().query(`
        SELECT 
          BloodGroup,
          UnitsAvailable,
          LastUpdated
        FROM BloodInventory
      `),
      pool.request().query(`
        SELECT TOP 10
          r.RequestID AS id,
          r.PatientName,
          r.BloodGroup,
          r.DonorName,
          r.Status,
          FORMAT(r.RequestDate, 'yyyy-MM-dd HH:mm') AS requestDate,
          r.HospitalName,
          r.Location,
          r.ContactNumber
        FROM Requests r
        WHERE r.Status IN ('Pending', 'Accepted')
        ORDER BY 
          CASE WHEN r.UrgencyLevel = 'Critical' THEN 0
               WHEN r.UrgencyLevel = 'High' THEN 1
               WHEN r.UrgencyLevel = 'Medium' THEN 2
               ELSE 3 END,
          r.RequestDate DESC
      `)
    ]);

    // Ensure all blood types are represented in inventory
    const allBloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    const inventory = allBloodTypes.map(bloodType => {
      const existing = inventoryResult.recordset.find(item => item.BloodGroup === bloodType);
      return {
        bloodGroup: bloodType,
        unitsAvailable: existing ? existing.UnitsAvailable : 0,
        lastUpdated: existing ? existing.LastUpdated : new Date().toISOString()
      };
    });

    res.json({
      success: true,
      totalDonors: totalDonors.recordset[0].count,
      pendingRequests: pendingRequests.recordset[0].count,
      completedDonations: completedDonations.recordset[0].count,
      inventory: inventory,
      requests: activeRequests.recordset
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data',
      error: error.message
    });
  }
});
// Find Donors by Blood Group
app.post('/api/find-donors-by-group', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authorization token required' });

  const token = authHeader.split(' ')[1];
  const { bloodGroup } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!bloodGroup) {
      return res.status(400).json({ error: 'Blood group is required' });
    }

    const result = await pool.request()
      .input('bloodGroup', sql.VarChar, bloodGroup)
      .query(`
        SELECT 
          d.DonorID AS id,
          u.FullName AS fullName,
          u.BloodGroup,
          u.PhoneNumber AS phoneNumber
        FROM Donors d
        JOIN Users u ON d.UserID = u.UserID
        WHERE u.BloodGroup = @bloodGroup
          AND d.Availability = 1
      `);

    res.json({
      success: true,
      donors: result.recordset
    });

  } catch (error) {
    console.error('Error finding donors:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching donors',
      error: error.message
    });
  }
});

// Emergency Request Endpoint
app.post('/api/emergency-request', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authorization token required' });

  const token = authHeader.split(' ')[1];
  const { patientName, bloodGroup, donorId, hospitalName, location, contactNumber } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get donor details
    const donorResult = await pool.request()
      .input('donorId', sql.Int, donorId)
      .query(`
        SELECT u.UserID, u.FullName, u.Email, u.PhoneNumber, u.BloodGroup
        FROM Users u
        JOIN Donors d ON u.UserID = d.UserID
        WHERE d.DonorID = @donorId
      `);

    const donor = donorResult.recordset[0];
    if (!donor) {
      return res.status(404).json({ error: 'Donor not found' });
    }

    // Create request
    const requestResult = await pool.request()
      .input('patientName', sql.NVarChar, patientName)
      .input('bloodGroup', sql.NVarChar, bloodGroup)
      .input('donorId', sql.Int, donorId)
      .input('donorName', sql.NVarChar, donor.FullName)
      .input('hospitalName', sql.NVarChar, hospitalName)
      .input('location', sql.NVarChar, location)
      .input('contactNumber', sql.NVarChar, contactNumber)
      .query(`
        INSERT INTO Requests (
          PatientName, 
          BloodGroup, 
          DonorID,
          DonorName,
          HospitalName,
          Location,
          ContactNumber,
          UrgencyLevel,
          Status
        ) 
        OUTPUT INSERTED.RequestID
        VALUES (
          @patientName, 
          @bloodGroup, 
          @donorId,
          @donorName,
          @hospitalName,
          @location,
          @contactNumber,
          'Critical',
          'Pending'
        )
      `);

    const requestId = requestResult.recordset[0].RequestID;

    // Generate OTP for verification
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 30 * 60000); // 30 minutes from now

    await pool.request()
      .input('requestId', sql.Int, requestId)
      .input('otp', sql.VarChar, otp)
      .input('otpExpiry', sql.DateTime, otpExpiry)
      .query(`
        UPDATE Requests 
        SET OTP = @otp, OTPExpiry = @otpExpiry 
        WHERE RequestID = @requestId
      `);

    // Create notification
    await createNotification(donor.UserID, {
      type: 'emergency',
      title: 'Emergency Blood Request',
      message: `Patient ${patientName} needs ${bloodGroup} blood at ${hospitalName}`,
      requestId: requestId
    });

    // Notify donor via WebSocket if connected
    const ws = connections.get(donor.UserID.toString());
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'emergency',
        requestId,
        patientName,
        bloodGroup,
        hospitalName,
        location,
        contactNumber,
        timestamp: new Date().toISOString()
      }));
    }

    // Send SMS via Twilio
    try {
      await twilioClient.messages.create({
        body: `URGENT: Patient ${patientName} needs ${bloodGroup} blood at ${hospitalName}. Please check your BloodCare app for details.`,
        from: process.env.TWILIO_PHONE,
        to: donor.PhoneNumber
      });
    } catch (twilioError) {
      console.error('Twilio error:', twilioError);
    }

    res.json({
      success: true,
      requestId,
      message: 'Emergency request created and notification sent',
      donor: {
        id: donor.UserID,
        name: donor.FullName,
        phone: donor.PhoneNumber
      }
    });

  } catch (err) {
    console.error('Emergency request error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Server error during emergency request',
      details: err.message 
    });
  }
});

// Cancel Request Endpoint
app.post('/api/cancel-request', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authorization token required' });

  const token = authHeader.split(' ')[1];
  const { requestId } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await pool.request()
      .input('requestId', sql.Int, requestId)
      .query('UPDATE Requests SET Status = \'Rejected\' WHERE RequestID = @requestId');

    res.json({
      success: true,
      message: 'Request cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel request',
      details: error.message
    });
  }
});

// Verify OTP Endpoint
app.post('/api/verify-otp', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authorization token required' });

  const token = authHeader.split(' ')[1];
  const { requestId, otp } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Check OTP validity
    const result = await pool.request()
      .input('requestId', sql.Int, requestId)
      .query(`
        SELECT OTP, OTPExpiry 
        FROM Requests 
        WHERE RequestID = @requestId
          AND Status = 'Accepted'
      `);

    if (result.recordset.length === 0) {
      return res.json({
        success: false,
        message: 'Invalid request or request not accepted'
      });
    }

    const { OTP, OTPExpiry } = result.recordset[0];

    if (OTP !== otp) {
      return res.json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (new Date(OTPExpiry) < new Date()) {
      return res.json({
        success: false,
        message: 'OTP has expired'
      });
    }

    // Update request status to completed
    await pool.request()
      .input('requestId', sql.Int, requestId)
      .query('UPDATE Requests SET Status = \'Completed\' WHERE RequestID = @requestId');

    // Create donation record
    const requestResult = await pool.request()
      .input('requestId', sql.Int, requestId)
      .query(`
        SELECT DonorID, DonorName, BloodGroup, Location 
        FROM Requests 
        WHERE RequestID = @requestId
      `);

    const request = requestResult.recordset[0];
    
    await pool.request()
      .input('requestId', sql.Int, requestId)
      .input('donorId', sql.Int, request.DonorID)
      .input('donorName', sql.NVarChar, request.DonorName)
      .input('bloodGroup', sql.NVarChar, request.BloodGroup)
      .input('location', sql.NVarChar, request.Location)
      .query(`
        INSERT INTO Donations (
          RequestID,
          DonorID,
          DonorName,
          BloodGroup,
          Location,
          Status,
          DonationDate
        )
        VALUES (
          @requestId,
          @donorId,
          @donorName,
          @bloodGroup,
          @location,
          'Completed',
          GETDATE()
        )
      `);

    // Update blood inventory
    await pool.request()
      .input('bloodGroup', sql.NVarChar, request.BloodGroup)
      .query(`
        UPDATE BloodInventory
        SET UnitsAvailable = UnitsAvailable + 1,
            LastUpdated = GETDATE()
        WHERE BloodGroup = @bloodGroup
      `);

    res.json({
      success: true,
      message: 'OTP verified successfully! Donation confirmed.'
    });

  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify OTP',
      details: error.message
    });
  }
});

// Donation History Endpoint
// Updated Donation History Endpoint
app.get('/api/donation-history', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ 
      success: false,
      error: 'Authorization token required' 
  });

  try {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      if (decoded.role !== 'donor') {
          return res.status(403).json({ 
              success: false,
              error: 'Donor access required' 
          });
      }

      // Get donor ID
      const donorResult = await pool.request()
          .input('userId', sql.Int, decoded.userId)
          .query('SELECT DonorID FROM Donors WHERE UserID = @userId');

      if (donorResult.recordset.length === 0) {
          return res.status(404).json({ 
              success: false,
              error: 'Donor profile not found' 
          });
      }

      const donorId = donorResult.recordset[0].DonorID;

      // Get donation history - USING ONLY COLUMNS THAT EXIST IN YOUR DATABASE
      const result = await pool.request()
          .input('donorId', sql.Int, donorId)
          .query(`
              SELECT 
                  DonationID,
                  DonationDate,
                  Status
                  /* Only include columns that exist in your database */
              FROM Donations
              WHERE DonorID = @donorId
              ORDER BY DonationDate DESC
          `);

      res.json({
          success: true,
          donations: result.recordset.map(donation => ({
              id: donation.DonationID,
              date: donation.DonationDate,
              status: donation.Status || 'Unknown'
              /* Map only the fields you actually have */
          }))
      });

  } catch (error) {
      console.error('Error fetching donation history:', error);
      res.status(500).json({
          success: false,
          error: 'Failed to fetch donation history',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
  }
});

// Notifications Endpoint
app.get('/api/notifications', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ 
      success: false,
      error: 'Authorization token required' 
  });

  try {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);

      const result = await pool.request()
          .input('userId', sql.Int, decoded.userId)
          .query(`
              SELECT 
                  NotificationID AS id,
                  Type,
                  Title,
                  Message,
                  RequestID,
                  IsRead,
                  CONVERT(varchar, CreatedAt, 120) AS timestamp
              FROM Notifications
              WHERE UserID = @userId
              ORDER BY CreatedAt DESC
          `);

      res.json({
          success: true,
          notifications: result.recordset.map(notification => ({
              ...notification,
              Type: notification.Type || 'general',
              Title: notification.Title || 'Notification',
              Message: notification.Message || '',
              timestamp: notification.timestamp || new Date().toISOString()
          }))
      });

  } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({
          success: false,
          error: 'Failed to fetch notifications',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
  }
});

// Helper Functions
async function handleDonorResponse(requestId, accepted, donor) {
  try {
    const status = accepted ? 'Accepted' : 'Rejected';
    
    await pool.request()
      .input('requestId', sql.Int, requestId)
      .query(`UPDATE Requests SET Status = '${status}' WHERE RequestID = @requestId`);

    // Notify admin via WebSocket
    broadcastToAdmins({
      type: 'donor-response',
      requestId,
      donorName: donor.name,
      status: accepted ? 'accepted' : 'rejected'
    });

    // If accepted, create donation record
    if (accepted) {
      const requestResult = await pool.request()
        .input('requestId', sql.Int, requestId)
        .query(`
          SELECT PatientName, BloodGroup, HospitalName, Location 
          FROM Requests 
          WHERE RequestID = @requestId
        `);

      const request = requestResult.recordset[0];
      
      await pool.request()
        .input('requestId', sql.Int, requestId)
        .input('donorId', sql.Int, donor.userId)
        .input('donorName', sql.NVarChar, donor.name)
        .input('bloodGroup', sql.NVarChar, request.BloodGroup)
        .input('hospitalName', sql.NVarChar, request.HospitalName)
        .input('location', sql.NVarChar, request.Location)
        .query(`
          INSERT INTO Donations (
            RequestID,
            DonorID,
            DonorName,
            BloodGroup,
            Location,
            Status
          )
          VALUES (
            @requestId,
            @donorId,
            @donorName,
            @bloodGroup,
            @location,
            'Scheduled'
          )
        `);
    }

  } catch (err) {
    console.error('Error handling donor response:', err);
  }
}

async function createNotification(userId, notification) {
  try {
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('type', sql.VarChar, notification.type)
      .input('title', sql.VarChar, notification.title)
      .input('message', sql.VarChar, notification.message)
      .input('requestId', sql.Int, notification.requestId || null)
      .query(`
        INSERT INTO Notifications (UserID, Type, Title, Message, RequestID)
        VALUES (@userId, @type, @title, @message, @requestId)
      `);
  } catch (err) {
    console.error('Error creating notification:', err);
    throw err;
  }
}

function broadcastToAdmins(message) {
  connections.forEach((ws, userId) => {
    // In a real app, you would check if the user is an admin before sending
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

// Start Server
async function startServer() {
  await connectDB();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
  });
}

// Error Handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Start the application
startServer();

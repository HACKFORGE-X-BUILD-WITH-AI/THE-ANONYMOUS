-- Create the database
CREATE DATABASE BloodDonationSystem;
GO

USE BloodDonationSystem;
GO

-- Users table (for both admins and donors)
CREATE TABLE Users (
    id INT PRIMARY KEY IDENTITY(1,1),
    name NVARCHAR(100) NOT NULL,
    email NVARCHAR(100) UNIQUE NOT NULL,
    phone NVARCHAR(20) NOT NULL,
    password NVARCHAR(255) NOT NULL,
    bloodGroup VARCHAR(3) NOT NULL,
    role VARCHAR(10) CHECK (role IN ('admin', 'donor')) NOT NULL,
    createdAt DATETIME DEFAULT GETDATE(),
    lastDonationDate DATETIME NULL,
    isActive BIT DEFAULT 1
);

-- Blood inventory table
CREATE TABLE BloodInventory (
    id INT PRIMARY KEY IDENTITY(1,1),
    bloodGroup VARCHAR(3) UNIQUE NOT NULL,
    unitsAvailable INT DEFAULT 0 CHECK (unitsAvailable >= 0),
    lastUpdated DATETIME DEFAULT GETDATE()
);

-- Emergency requests table
CREATE TABLE EmergencyRequests (
    id INT PRIMARY KEY IDENTITY(1,1),
    patientName NVARCHAR(100) NOT NULL,
    bloodGroup VARCHAR(3) NOT NULL,
    department NVARCHAR(50),
    attendant NVARCHAR(100),
    urgency VARCHAR(20),
    requestDate DATETIME DEFAULT GETDATE(),
    status VARCHAR(20) DEFAULT 'Pending',
    completedDate DATETIME NULL
);

-- Donation requests table
CREATE TABLE DonationRequests (
    id INT PRIMARY KEY IDENTITY(1,1),
    donorId INT NOT NULL FOREIGN KEY REFERENCES Users(id),
    emergencyRequestId INT NULL FOREIGN KEY REFERENCES EmergencyRequests(id),
    bloodGroup VARCHAR(3) NOT NULL,
    requestDate DATETIME DEFAULT GETDATE(),
    status VARCHAR(20) DEFAULT 'Pending',
    responseDate DATETIME NULL,
    otp VARCHAR(6) NULL,
    otpVerified BIT DEFAULT 0,
    donationDate DATETIME NULL
);

-- Donation history table
CREATE TABLE DonationHistory (
    id INT PRIMARY KEY IDENTITY(1,1),
    donorId INT NOT NULL FOREIGN KEY REFERENCES Users(id),
    requestId INT NOT NULL FOREIGN KEY REFERENCES DonationRequests(id),
    donationDate DATETIME DEFAULT GETDATE(),
    bloodGroup VARCHAR(3) NOT NULL,
    volume INT NOT NULL CHECK (volume BETWEEN 300 AND 500), -- in mL
    notes NVARCHAR(500) NULL
);

-- Hospitals table
CREATE TABLE Hospitals (
    id INT PRIMARY KEY IDENTITY(1,1),
    name NVARCHAR(100) NOT NULL,
    address NVARCHAR(200) NOT NULL,
    city NVARCHAR(50) NOT NULL,
    phone NVARCHAR(20) NOT NULL,
    email NVARCHAR(100) NULL,
    bloodBankCapacity INT NOT NULL
);

-- Insert initial blood groups into inventory
INSERT INTO BloodInventory (bloodGroup, unitsAvailable)
VALUES 
('A+', 10), ('A-', 5), ('B+', 8), ('B-', 3),
('AB+', 2), ('AB-', 1), ('O+', 15), ('O-', 7);

-- Insert sample hospitals
INSERT INTO Hospitals (name, address, city, phone, bloodBankCapacity)
VALUES 
('SUM Ultimate', 'GITA', 'Bhubaneswar', '1234567892', 500),
('AMRI', 'Jaydevbihar', 'Bhubaneswar', '9362514210', 300),
('APOLLO', 'Banibihar', 'Khordha', '6512485120', 400),
('Kalinga', 'RCM', 'Bhubaneswar', '9862514251', 400),
('AIMS', 'RCM', 'Bhubaneswar', '3215421580', 400);


-- Insert admin user (password: admin123)
INSERT INTO Users (name, email, phone, password, bloodGroup, role)
VALUES 
('bloodcare_admin', 'santoshkumargajendra74@gmail.com', '8260706527', 
'$2a$10$X5wDF5xO1l6WjZ5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q', 'O+', 'admin');

-- Insert sample donors (password: donor123 for all)
INSERT INTO Users (name, email, phone, password, bloodGroup, role, lastDonationDate)
VALUES 
('Padmini Nayak', 'nayakp1502@gmail.com', '7847939677', 
'$2a$10$X5wDF5xO1l6WjZ5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q', 'B+', 'donor', '2023-05-15'),
('Jyoti Prakash Maharana', 'jyotiprakashmaharana@gmail.com', '8249092191', 
'$2a$10$X5wDF5xO1l6WjZ5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q', 'O-', 'donor', '2023-06-20'),
('Pritish Sahoo', 'pritishsahoo@gmail.com', '7683912451', 
'$2a$10$X5wDF5xO1l6WjZ5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q', 'A+', 'donor', NULL),
('Sairam Panda', 'sairampanda@gmail.com', '8637202680', 
'$2a$10$X5wDF5xO1l6WjZ5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q5b5Q1z.eWjD5Q', 'AB+', 'donor', '2024-04-10');

select * from users;
-- Create indexes for better performance
CREATE INDEX idx_users_bloodGroup ON Users(bloodGroup);
CREATE INDEX idx_users_role ON Users(role);
CREATE INDEX idx_donationRequests_status ON DonationRequests(status);
CREATE INDEX idx_donationRequests_donorId ON DonationRequests(donorId);
CREATE INDEX idx_donationHistory_donorId ON DonationHistory(donorId);


CREATE TABLE Donors (
    DonorID INT PRIMARY KEY IDENTITY(1,1),
    FullName NVARCHAR(100) NOT NULL,
    BloodGroup VARCHAR(3) NOT NULL 
        CHECK (BloodGroup IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    PhoneNumber VARCHAR(20) NOT NULL,
    Location NVARCHAR(100),
    Availability BIT DEFAULT 1,
    LastDonationDate DATE NULL,
    CreatedAt DATETIME DEFAULT GETDATE()
);

insert into Donors(FullName, BloodGroup, PhoneNumber, Location) Values(
		'Santosh Kumar', 'O+', '8260706527', 'Bhubaneswar');

insert into Donors(FullName, BloodGroup, PhoneNumber, Location) Values(
		'Himansu Panda', 'B+', '9692557031', 'Gohiria');
		select * from Donors;
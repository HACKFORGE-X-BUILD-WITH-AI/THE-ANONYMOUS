create database Smart_Blood_Donation;

use Smart_Blood_Donation;

-- Users table (for authentication with mandatory blood group)
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
);

-- Donors table (extended donor information)
CREATE TABLE Donors (
    DonorID INT IDENTITY(1,1) PRIMARY KEY,
    UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
    Availability BIT DEFAULT 1,
    LastDonationDate DATETIME NULL,
    HealthStatus NVARCHAR(50) NULL,
    CONSTRAINT UQ_Donor_User UNIQUE (UserID)
);

-- Blood inventory
CREATE TABLE BloodInventory (
    InventoryID INT IDENTITY(1,1) PRIMARY KEY,
    BloodGroup NVARCHAR(5) NOT NULL CHECK (BloodGroup IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    UnitsAvailable INT NOT NULL DEFAULT 0,
    LastUpdated DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_BloodGroup UNIQUE (BloodGroup)
);

select * from BloodInventory;
select * from Requests;


-- Requests table (with donor name reference)
CREATE TABLE Requests (
    RequestID INT IDENTITY(1,1) PRIMARY KEY,
    PatientName NVARCHAR(100) NOT NULL,
    BloodGroup NVARCHAR(5) NOT NULL CHECK (BloodGroup IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    DonorID INT NOT NULL FOREIGN KEY REFERENCES Donors(DonorID),
    DonorName NVARCHAR(100) NOT NULL, -- Added to store donor's full name
    HospitalName NVARCHAR(100) NOT NULL,
    Location NVARCHAR(255) NOT NULL,
    ContactNumber NVARCHAR(20) NOT NULL,
    RequestDate DATETIME DEFAULT GETDATE(),
    Status NVARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (Status IN ('Pending', 'Accepted', 'Rejected', 'Completed')),
    UrgencyLevel NVARCHAR(20) NOT NULL DEFAULT 'Medium' CHECK (UrgencyLevel IN ('Low', 'Medium', 'High', 'Critical')),
    OTP NVARCHAR(6) NULL,
    OTPExpiry DATETIME NULL
);

SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Donations'



-- Donations table
CREATE TABLE Donations (
    DonationID INT IDENTITY(1,1) PRIMARY KEY,
    RequestID INT NOT NULL FOREIGN KEY REFERENCES Requests(RequestID),
    DonorID INT NOT NULL FOREIGN KEY REFERENCES Donors(DonorID),
    DonorName NVARCHAR(100) NOT NULL, -- Added to store donor's full name
    DonationDate DATETIME DEFAULT GETDATE(),
    Status NVARCHAR(20) NOT NULL DEFAULT 'Scheduled' CHECK (Status IN ('Scheduled', 'Completed', 'Cancelled')),
    UnitsDonated DECIMAL(5,2) NULL,
    Notes NVARCHAR(MAX) NULL
);

-- Notifications table
CREATE TABLE Notifications (
    NotificationID INT IDENTITY(1,1) PRIMARY KEY,
    UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
    RequestID INT NULL FOREIGN KEY REFERENCES Requests(RequestID),
    Type NVARCHAR(50) NOT NULL,
    Title NVARCHAR(100) NOT NULL,
    Message NVARCHAR(MAX) NOT NULL,
    IsRead BIT DEFAULT 0,
    CreatedAt DATETIME DEFAULT GETDATE()
);

select * from Notifications;
select * from Requests;
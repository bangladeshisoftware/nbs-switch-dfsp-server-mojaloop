-- DFSP Portal specific tables
-- Run these additions to your existing rswitch database

-- DFSP Portal Users (separate from R Switch admin users)

-- ** r switch - admin option create dfsp accounts.

CREATE TABLE IF NOT EXISTS dfsp_users (
  id            VARCHAR(36)  PRIMARY KEY,
  dfsp_id       VARCHAR(50)  NOT NULL,
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password      VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255),
  role          ENUM('ADMIN','OPERATOR','VIEWER') DEFAULT 'VIEWER',
  is_active     TINYINT(1)   DEFAULT 1,
  otp           VARCHAR(10)  NULL,
  otp_expires_at DATETIME    NULL,
  last_login    DATETIME     NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (dfsp_id) REFERENCES dfsps(dfsp_id) ON DELETE CASCADE
);

-- Merchants registered by DFSPs
CREATE TABLE IF NOT EXISTS merchants (
  id              VARCHAR(36)   PRIMARY KEY,
  dfsp_id         VARCHAR(50)   NOT NULL,
  merchant_id     VARCHAR(100)  NOT NULL UNIQUE,
  business_name   VARCHAR(255)  NOT NULL,
  business_type   VARCHAR(100),
  owner_name      VARCHAR(255),
  phone           VARCHAR(20),
  email           VARCHAR(255),
  address         TEXT,
  nid             VARCHAR(50),
  tin             VARCHAR(50),
  account_number  VARCHAR(100),
  status          ENUM('PENDING','ACTIVE','SUSPENDED','REJECTED') DEFAULT 'PENDING',
  category        VARCHAR(100),
  daily_limit     DECIMAL(18,2) DEFAULT 0,
  monthly_limit   DECIMAL(18,2) DEFAULT 0,
  approved_by     VARCHAR(36)   NULL,
  approved_at     DATETIME      NULL,
  notes           TEXT,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (dfsp_id) REFERENCES dfsps(dfsp_id)
);

-- Add email to dfsps if not exists
ALTER TABLE dfsps ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL;
ALTER TABLE dfsps ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255) NULL;
ALTER TABLE dfsps ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL;
ALTER TABLE dfsps ADD COLUMN IF NOT EXISTS address TEXT NULL;

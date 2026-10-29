-- Staff (Airtable tblbHePRmAbfWwXBU)
CREATE TABLE IF NOT EXISTS "staff" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Full Name" TEXT,
  "Staff ID" TEXT,
  "Status" TEXT,
  "Model" TEXT,
  "Platform" TEXT,
  "Pay Type" TEXT,
  "Current Hourly Rate" REAL,
  "Currency" TEXT,
  "Start Date" TEXT,
  "End Date" TEXT,
  "Email" TEXT,
  "Notes" TEXT,
  "Pay Log" TEXT,
  "Conversion Log" TEXT,
  "Conversions This Week" REAL,
  "Conversions Last Week" REAL,
  "Conversions Last 4 Weeks" REAL,
  "Hours Last 30d" REAL,
  "7-Day Average" REAL,
  "30-Day Daily Average" REAL,
  "Conversions per Hour" REAL,
  "Standard Daily Hours" REAL,
  "Staff Expectations" TEXT
);

-- Pay Log (Airtable tblIvDJcsFEOJCRrr)
CREATE TABLE IF NOT EXISTS "paylog" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Work Date" TEXT,
  "Staff" TEXT,
  "Hours Worked" REAL,
  "Hourly Rate Snapshot" REAL,
  "Bonus" REAL,
  "Deductions" REAL,
  "Payment Status" TEXT,
  "Payment Date" TEXT,
  "Notes" TEXT,
  "Submitted By" TEXT,
  "Base Pay" REAL,
  "Total Pay" REAL,
  "Pay Period" TEXT,
  "Hours 30d" REAL
);

-- Expense Log (Airtable tblMuC3WKlGWD1Gw7)
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Expense ID" TEXT,
  "Expense Date" TEXT,
  "Description" TEXT,
  "Currency" TEXT,
  "Category" TEXT,
  "Channel" TEXT,
  "Model" TEXT,
  "Vendor" TEXT,
  "Billing Type" TEXT,
  "Status" TEXT,
  "Paid Date" TEXT,
  "Notes" TEXT,
  "Created By" TEXT,
  "Source Ref" TEXT,
  "Amount" REAL
);

-- Models (Airtable tblG5Yw4dgl59nCEY)
CREATE TABLE IF NOT EXISTS "models" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Model" TEXT,
  "Status" TEXT,
  "Payout Basis" TEXT,
  "Start Date" TEXT,
  "Notes" TEXT,
  "Staff" TEXT,
  "Conversion Log" TEXT,
  "Expense Log" TEXT,
  "Model Accounts" TEXT,
  "Expense Log 2" TEXT,
  "Deal Type" TEXT,
  "Weekly Paid Subscribers" TEXT,
  "Model's Cut %" REAL,
  "Our Cut %" REAL
);

-- Model Accounts (Airtable tblzG0tkektnVTBsL)
CREATE TABLE IF NOT EXISTS "map" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Account Slug" TEXT,
  "Account ID" REAL,
  "OF Username" TEXT,
  "Model" TEXT,
  "Include in P&L" INTEGER,
  "Notes" TEXT
);

-- Conversion Log (Airtable tbln8DawusKZwIzOo)
CREATE TABLE IF NOT EXISTS "conversions" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Week Starting" TEXT,
  "Staff" TEXT,
  "Model" TEXT,
  "Conversions" REAL,
  "Shift" TEXT,
  "Source" TEXT,
  "Notes" TEXT,
  "Submitted By" TEXT,
  "Week Start" TEXT,
  "Conversions This Week" REAL,
  "Conversions Last Week" REAL,
  "Conversions Last 4 Weeks" REAL
);

-- Staff Expectations (Airtable tbli0deZgWsANOdbT)
CREATE TABLE IF NOT EXISTS "expectations" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Name" TEXT,
  "Effective Week" TEXT,
  "Staff" TEXT,
  "Daily Target" REAL,
  "Weekly Minimum" REAL,
  "Monthly Target" REAL
);

-- Weekly Paid Subscribers (Airtable tblLZNzOf3LRZ6fLA)
CREATE TABLE IF NOT EXISTS "paidSubs" (
  "id" TEXT PRIMARY KEY,
  "created_time" TEXT NOT NULL,
  "updated_time" TEXT NOT NULL,
  "Name" TEXT,
  "Week Starting" TEXT,
  "Model" TEXT,
  "Notes" TEXT,
  "Paid Subscribers" REAL
);

-- Every create, update and delete, with the before and after values.
CREATE TABLE IF NOT EXISTS "audit_log" (
  "seq" INTEGER PRIMARY KEY AUTOINCREMENT,
  "at" TEXT NOT NULL,
  "actor" TEXT,
  "table_key" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" TEXT,
  "after" TEXT
);
CREATE INDEX IF NOT EXISTS "audit_log_record" ON "audit_log" ("table_key", "record_id");

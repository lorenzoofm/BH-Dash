-- Redesign: marketing roles, weekly minimums and schedules on Staff; the semi-monthly pay run;
-- Creatorstaq avatars; saved expense views. Backfills keep every existing figure unchanged.

-- Staff ---------------------------------------------------------------------------------------
ALTER TABLE "staff" ADD COLUMN "Weekly Minimum" REAL;
-- JSON array of days off, 0 = Sunday … 6 = Saturday. NULL means the default (Sunday off).
ALTER TABLE "staff" ADD COLUMN "Days Off" TEXT;

-- Platform is now the marketing role: X, Discord, IG or VPS.
UPDATE "staff" SET "Platform" = 'IG' WHERE "Platform" = 'Instagram';
UPDATE "staff" SET "Platform" = 'X' WHERE "Platform" IS NOT NULL AND "Platform" NOT IN ('X', 'Discord', 'IG', 'VPS');

-- Each VA's weekly minimum is their latest Staff Expectations entry that set one.
UPDATE "staff" SET "Weekly Minimum" = (
  SELECT e."Weekly Minimum" FROM "expectations" e, json_each(e."Staff") j
  WHERE j.value = "staff".id AND e."Weekly Minimum" IS NOT NULL
  ORDER BY e."Effective Week" DESC, e.updated_time DESC LIMIT 1);

-- Model Accounts ------------------------------------------------------------------------------
ALTER TABLE "map" ADD COLUMN "Avatar URL" TEXT;

-- Pay run -------------------------------------------------------------------------------------
-- Periods run 1st–15th and 16th–month end; "Period" is the start date. A period with no row is open.
CREATE TABLE IF NOT EXISTS "payPeriods" (
  "id" TEXT PRIMARY KEY, "created_time" TEXT NOT NULL, "updated_time" TEXT NOT NULL,
  "Period" TEXT, "Status" TEXT, "Approved At" TEXT, "Approved By" TEXT
);
-- One row per VA per period: the checked/sent ticks, the held-hours decision, excused days
-- (JSON array of dates) and, once approved, the rate and schedule the period was paid at.
CREATE TABLE IF NOT EXISTS "payStaff" (
  "id" TEXT PRIMARY KEY, "created_time" TEXT NOT NULL, "updated_time" TEXT NOT NULL,
  "Period" TEXT, "Staff" TEXT, "Checked" INTEGER, "Sent" INTEGER, "Held Decision" TEXT, "Excused" TEXT,
  "Rate Snapshot" REAL, "Std Hours Snapshot" REAL, "Days Off Snapshot" TEXT
);
-- Bonus, Deduction (negative Value), Extra hours (Hours × rate) and Correction (for a locked period).
CREATE TABLE IF NOT EXISTS "payAdjustments" (
  "id" TEXT PRIMARY KEY, "created_time" TEXT NOT NULL, "updated_time" TEXT NOT NULL,
  "Period" TEXT, "Staff" TEXT, "Type" TEXT, "Value" REAL, "Hours" REAL, "Note" TEXT, "For Period" TEXT
);
-- Hours stay in the Pay Log: one row per VA per work date.

-- Every past period (ended before today in Manila) becomes approved, or paid when all its Pay Log
-- rows were paid. Its snapshot pays every logged hour at the rate already on the rows, so historic
-- wages match what the Pay Log recorded. The current period stays open.
CREATE TABLE "_pay" AS
SELECT j.value AS staff, p."Work Date" AS day,
  substr(p."Work Date", 1, 8) || CASE WHEN CAST(substr(p."Work Date", 9, 2) AS INTEGER) <= 15 THEN '01' ELSE '16' END AS period,
  p."Hours Worked" AS hours, p."Hourly Rate Snapshot" AS rate, p."Payment Status" AS status,
  p."Bonus" AS bonus, p."Deductions" AS deductions, p."Notes" AS notes
FROM "paylog" p, json_each(p."Staff") j
WHERE p."Work Date" IS NOT NULL;

CREATE TABLE "_past" AS
SELECT period, MIN(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) AS all_paid FROM "_pay"
WHERE (CASE WHEN substr(period, 9, 2) = '01' THEN substr(period, 1, 8) || '15' ELSE date(period, 'start of month', '+1 month', '-1 day') END) < date('now', '+8 hours')
GROUP BY period;

INSERT INTO "payPeriods" (id, created_time, updated_time, "Period", "Status", "Approved At", "Approved By")
SELECT 'rec' || hex(randomblob(7)), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  period, CASE WHEN all_paid = 1 THEN 'paid' ELSE 'approved' END, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'migration'
FROM "_past";

-- ponytail: one rate per VA per period (the highest on their rows); a mid-period rate change in old data is paid at the higher rate.
INSERT INTO "payStaff" (id, created_time, updated_time, "Period", "Staff", "Checked", "Sent", "Held Decision", "Excused", "Rate Snapshot", "Std Hours Snapshot", "Days Off Snapshot")
SELECT 'rec' || hex(randomblob(7)), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  x.period, json_array(x.staff), 1, MIN(CASE WHEN x.status = 'Paid' THEN 1 ELSE 0 END), 'pay', '[]',
  MAX(x.rate), COALESCE(s."Standard Daily Hours", 0), '[]'
FROM "_pay" x JOIN "_past" USING (period) LEFT JOIN "staff" s ON s.id = x.staff
GROUP BY x.period, x.staff;

-- Bonuses and deductions on Pay Log rows become adjustments in their period.
INSERT INTO "payAdjustments" (id, created_time, updated_time, "Period", "Staff", "Type", "Value", "Note")
SELECT 'rec' || hex(randomblob(7)), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  period, json_array(staff), 'Bonus', bonus, 'Pay Log ' || day || COALESCE(' · ' || notes, '')
FROM "_pay" WHERE bonus > 0;
INSERT INTO "payAdjustments" (id, created_time, updated_time, "Period", "Staff", "Type", "Value", "Note")
SELECT 'rec' || hex(randomblob(7)), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  period, json_array(staff), 'Deduction', -deductions, 'Pay Log ' || day || COALESCE(' · ' || notes, '')
FROM "_pay" WHERE deductions > 0;

DROP TABLE "_pay";
DROP TABLE "_past";

-- Expense views -------------------------------------------------------------------------------
-- Saved tabs on the Expenses page, per manager. Filters: {"category":[],"status":[],"model":[],"billing":[]}.
CREATE TABLE IF NOT EXISTS "expenseViews" (
  "id" TEXT PRIMARY KEY, "created_time" TEXT NOT NULL, "updated_time" TEXT NOT NULL,
  "Name" TEXT, "User Email" TEXT, "Filters" TEXT, "Sort" TEXT, "Group By" TEXT, "System" INTEGER, "Position" REAL
);
CREATE INDEX IF NOT EXISTS "paylog_work_date" ON "paylog" ("Work Date");

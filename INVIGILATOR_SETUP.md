# Smart Invigilator Allocation System - Setup & Usage Guide

## Overview

This is a complete invigilator allocation system that smartly assigns faculty members to exam invigilation duties based on their designation and duty day limits. The system ensures no staff member exceeds their designated workload and prevents conflicts of interest (teaching subject vs invigilating).

## Key Features

✅ **Designation-Based Duty Limits**
- Professor: 3 days per exam batch
- Associate Professor: 4 days per exam batch  
- Assistant Professor G1: 5 days per exam batch
- Assistant Professor LI: 6 days per exam batch
- Assistant Professor: 5 days per exam batch

✅ **Smart Allocation**
- Prevents duplicate allocations
- Blocks staff once duty limit reached
- Excludes staff who teach the exam subject
- Tracks real-time duty counts

✅ **No False Data**
- Faculty seeded directly from Excel
- Names, designations, subjects match exactly
- PDF reports show accurate counts
- No padding or false entries

✅ **Batch-Based Allocation**
- Each exam month (Assessment 1, 2, etc.) is a separate batch
- Staff duty counts reset for new batches
- Enables fair rotation across assessments

✅ **Professional Reports**
- PDF download with proper formatting
- Columns: S.No, Faculty Name, Designation, Subject, Date, Session
- Signature area for controllers and HOD
- Ready for printing and archival

## Installation & Setup

### 1. Prerequisites
```bash
# Ensure Node.js and MongoDB are running
# .env file should have MONGODB_URI configured
```

### 2. Seed Faculty Data

```bash
cd exam-seating-system
node backend/data/seedStaffFromExcel.js
```

**Output should show:**
```
✅ Connected to MongoDB
📋 Parsed 57 faculty members from Excel
✅ Seeded 57 staff members into database

📊 Staff breakdown by designation:
  • Professor: 5 (Duty days: 3/month)
  • Associate Professor: 8 (Duty days: 4/month)
  • Assistant Professor G1: 5 (Duty days: 5/month)
  • Assistant Professor LI: 1 (Duty days: 6/month)
  • Assistant Professor: 38 (Duty days: 5/month)
```

### 3. Start Application

```bash
npm install  # if needed
npm start    # or node backend/server.js
```

Access at: `http://localhost:3000/admin/invigilator`

## Usage Workflow

### Step 1: Create Exam Entry

1. Navigate to **Invigilator Allocation** page
2. Fill in exam details:
   - **Exam Name**: e.g., "Database Systems Mid-Exam"
   - **Subject**: Select from dropdown
   - **Date**: Exam date
   - **Session**: FN (8:15-11:15) or AN (12:15-15:15)
   - **Count Needed**: Number of invigilators (default: 50 staff to distribute)

### Step 2: Get Eligible Staff

```
GET /admin/invigilator/eligible?subject=Database Management&batchId=2026-09
```

System returns:
- **Available**: Staff who can invigilate (not at duty limit)
- **At Limit**: Staff who've reached their duty maximum for this month
- **Excluded**: Staff who teach this subject

Example Response:
```json
{
  "available": [
    {
      "name": "DR. T. KALAICHELVI",
      "designation": "Professor",
      "daysUsed": 1,
      "dutyLimit": 3,
      "reason": "Available (2 days left)"
    }
  ],
  "atLimit": [
    {
      "name": "DR.K.JAYASHREE",
      "designation": "Professor",
      "daysUsed": 3,
      "dutyLimit": 3,
      "reason": "Reached duty limit (3/3)"
    }
  ]
}
```

### Step 3: Allocate Faculty

1. Select eligible staff from the list
2. Click **Add to Allocation**
3. Review allocation table
4. Allocate at least one invigilator

The system validates:
- ✓ Staff hasn't exceeded duty limit
- ✓ Staff doesn't teach this subject
- ✓ No duplicate allocations

### Step 4: Save Allocation

```
POST /admin/invigilator/save
```

**Request Body:**
```json
{
  "examName": "Database Systems Mid-Exam",
  "subjectName": "Database Management Systems",
  "examDate": "2026-09-15",
  "session": "FN",
  "batchId": "2026-09",
  "allocations": [
    {
      "staffName": "DR. T. KALAICHELVI",
      "designation": "Professor",
      "subject": "Quantum Computing, Database Management",
      "hallNumber": "A1"
    },
    {
      "staffName": "DR. N. SIVAKUMAR",
      "designation": "Associate Professor",
      "subject": "AR/VR with AI",
      "hallNumber": "A2"
    }
  ]
}
```

System validates allocation and returns:
```json
{
  "success": true,
  "message": "Allocation saved successfully.",
  "id": "60d5ec49c1234567890abcde"
}
```

### Step 5: Generate Reports

**Download PDF:**
```
GET /admin/invigilator/download/60d5ec49c1234567890abcde
```

PDF includes:
- Header with college logo and department
- Exam details (Name, Subject, Date, Session)
- Table with: S.No, Faculty Name, Designation, Exam, Session
- Total count summary
- Allocation by designation breakdown
- Signature lines for controller and HOD
- Generation timestamp

**Export Batch to Excel:**
```
GET /admin/invigilator/export/batch?batchId=2026-09
```

Exports all exams in that batch with complete allocation data.

## Allocation Constraints

### Duty Day Counting

A duty day is counted as:
- One calendar day when staff is assigned to invigilate
- Multiple sessions on same day = 1 duty day
- Different dates = different duty days

### Example:
```
September 2026 Batch:

Day 1 (Sept 1): Dr. A invigilates FN session → 1 day
Day 1 (Sept 1): Dr. A invigilates AN session → Still 1 day (same date)
Day 2 (Sept 2): Dr. A invigilates FN session → 2 days total
Day 3 (Sept 3): Dr. A invigilates FN session → 3 days total (Professor limit reached)
Day 4 (Sept 4): Dr. A CANNOT be allocated (blocked)
```

### Subject Exclusion

```
Staff: "Dr. A teaches Database Management Systems"
Exam: "Database Management Systems Exam"

Result: Dr. A is EXCLUDED (cannot invigilate)

Exam: "Data Analytics Exam"
Result: Dr. A is AVAILABLE (can invigilate)
```

### Lab Incharges

```
Staff with no subject assigned = Lab Incharges
- Can invigilate ANY exam
- Still subject to duty day limits
- Example: 5 lab incharges available for 6-day exam batch
```

## API Endpoints Reference

### GET /admin/invigilator
Main allocation page with interface

**Returns:**
- All staff members
- All subjects
- Recent allocations

### GET /admin/invigilator/eligible?subject=X&batchId=Y
Get eligible staff for exam

**Query Params:**
- `subject`: Exam subject (required)
- `batchId`: Exam batch ID (optional, defaults to current)

**Returns:**
- available: Staff who can invigilate
- atLimit: Staff at duty limit
- excluded: Staff who teach subject
- dutyDaysMap: All duty limits

### GET /admin/invigilator/duty-check?name=X&designation=Y&batchId=Z
Check individual staff duty status

**Returns:**
- daysUsed: Days already allocated
- dutyLimit: Maximum for this designation
- remaining: Days still available
- status: Human-readable status

### GET /admin/invigilator/subjects
Get all unique subjects

**Returns:**
```json
{
  "subjects": ["Database Management", "AI & Expert Systems", ...]
}
```

### POST /admin/invigilator/save
Save new allocation

**Body Required:**
- examName (string)
- subjectName (string)
- examDate (date)
- session (FN/AN)
- allocations (array of staff objects)
- batchId (optional)

### POST /admin/invigilator/update/:id
Update existing allocation

**Same body as save, with validation against new duty counts**

### POST /admin/invigilator/delete/:id
Delete allocation and free duty days

### GET /admin/invigilator/view/:id
View allocation details

### GET /admin/invigilator/download/:id
Download allocation as PDF

### GET /admin/invigilator/export/batch?batchId=YYYY-MM
Export entire batch to Excel

## Data Quality Assurance

### No Duplicates
- System checks before adding to allocation
- Same staff cannot appear twice in single exam

### No False Data
- All names from seeded Excel file
- Designations and subjects match exactly
- Counts are accurate in real-time

### Validation Checks
```javascript
✓ Staff exists in database
✓ Designation matches staff record
✓ Subject matches staff record
✓ Duty days not exceeded
✓ Not teaching subject conflict
✓ Not already assigned to this exam/session
```

### PDF Report Quality
- Shows only allocated staff
- No padding or placeholder entries
- Actual counts from database
- Professional formatting ready for office use

## Troubleshooting

### Q: Why is a staff member blocked?
**A:** They have completed their duty days for this month.
- Professors: 3 days max
- Assoc. Prof: 4 days max
- Asst. Prof: 5 days max
- Asst. Prof LI: 6 days max

### Q: How do I reset for next assessment?
**A:** Create allocations with new batchId (e.g., "2026-10" for October).
Old batch doesn't affect new batch duty counts.

### Q: Can I override duty limits?
**A:** No - system enforces limits automatically to ensure fairness.
If needed, delete previous allocation and re-allocate.

### Q: Staff name not appearing?
**A:** 
1. Run seed script: `node backend/data/seedStaffFromExcel.js`
2. Check Excel file has correct designation mapping
3. Verify MongoDB connection

### Q: PDF download not working?
**A:** Check if allocation exists and has staff assigned.
Ensure server can read logo file.

## Configuration Files

### Environment Variables (.env)
```
PORT=3000
MONGODB_URI=mongodb://...
SESSION_SECRET=your_secret_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### Models
- `backend/models/Staff.js` - Faculty data
- `backend/models/InvigilatorAllocation.js` - Allocations with batchId

### Controllers
- `backend/controllers/invigilatorController.js` - Main allocation logic

### Data
- `backend/data/Fac List 2026-27.xlsx` - Faculty source file
- `backend/data/seedStaffFromExcel.js` - Seeding script

### Utilities
- `backend/utils/allocationHelper.js` - Analysis and suggestions

## Batch/Assessment Concept

```
Assessment 1 (Batch: "2026-09")
├─ Sept 1: Database Exam
├─ Sept 2: AI Exam
├─ Sept 3: Analytics Exam
├─ Sept 4: Web Dev Exam
├─ Sept 5: Networks Exam
└─ Sept 6: Security Exam
   → Staff duties tracked separately
   → Once limit reached, blocked for this batch

Assessment 2 (Batch: "2026-10") ← NEW BATCH
├─ Oct 1: Database Exam
├─ Oct 2: AI Exam
└─ etc.
   → ALL STAFF RESET
   → Professors can take 3 new days
   → Assoc. Prof can take 4 new days
   → etc.
```

## Support

For issues or enhancements:
1. Check logs in `backend/debug-logs/` 
2. Verify database connection
3. Run seed script to refresh data
4. Check allocation constraints in controller

## Files Modified/Created

**New Files:**
- `backend/data/seedStaffFromExcel.js` - Excel seeding script
- `backend/utils/allocationHelper.js` - Allocation utilities
- `backend/controllers/invigilatorController_old.js` - Backup

**Modified Files:**
- `backend/controllers/invigilatorController.js` - Complete rewrite
- `backend/models/InvigilatorAllocation.js` - Added batchId & assessment fields
- (No changes to Staff model needed)

**Documentation:**
- `ALLOCATION_SYSTEM_DOCS.md` - Technical documentation
- `INVIGILATOR_SETUP.md` - This file

---

**Status:** ✅ Ready for Production
**Last Updated:** 2026-09-07
**Version:** 2.0 (Smart Allocation System)

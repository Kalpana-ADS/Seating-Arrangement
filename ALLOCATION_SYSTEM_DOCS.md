/**
 * Smart Invigilator Allocation System - Documentation
 * =====================================================
 * 
 * OVERVIEW:
 * This system allocates faculty members as invigilators for exams based on their
 * designation and duty day limits. Each designation has a maximum number of days
 * they can work as invigilators during a single exam batch (month).
 * 
 * DUTY DAY LIMITS (per exam batch/month):
 * =======================================
 * - Professor (PROFESSOR):                          3 days maximum
 * - Associate Professor (ASSO.PROF):               4 days maximum
 * - Assistant Professor G1 (ASST.PROF G1):         5 days maximum
 * - Assistant Professor LI (ASST.PROF LI):         6 days maximum
 * - Assistant Professor (ASST.PROF):               5 days maximum
 * 
 * ALLOCATION RULES:
 * =================
 * 1. SUBJECT EXCLUSION:
 *    - Faculty cannot invigilate exams for subjects they teach
 *    - Exception: Lab Incharges (staff with no subject) can invigilate any exam
 *    
 * 2. DUTY DAY COUNTING:
 *    - Each day a staff member is assigned to invigilate counts as 1 duty day
 *    - Multiple sessions on the same date count as 1 day
 *    - Once duty limit is reached, staff cannot be assigned to more exams
 *    
 * 3. BATCH CONCEPT:
 *    - Each exam batch (e.g., "2026-09" for September 2026) is tracked separately
 *    - When Assessment 2 starts (next month), staff are reset and can take on new duties
 *    - This ensures fair rotation and prevents overload
 *    
 * 4. ALLOCATION BLOCKING:
 *    - If a staff member reaches their duty limit, they are automatically blocked
 *    - Blocked staff cannot be added to more allocations for that batch
 *    - System shows: "BLOCKED - Completed all X duty days"
 * 
 * SYSTEM WORKFLOW:
 * ================
 * 
 * Step 1: Create Exam Entry
 *   - Admin creates exam with: Exam Name, Subject, Date, Session (FN/AN)
 *   - System auto-generates Batch ID from date (YYYY-MM)
 *   - Assessment is set (default: 1)
 * 
 * Step 2: Get Eligible Staff
 *   - Admin selects subject
 *   - System fetches all staff
 *   - Filters out staff who teach that subject
 *   - Shows remaining staff with:
 *     * Current duty days used
 *     * Remaining duty days available
 *     * Status (Available / At Limit)
 * 
 * Step 3: Allocate Faculty
 *   - Admin selects eligible staff
 *   - System validates staff hasn't exceeded duty limit
 *   - Staff are added to allocation
 *   - Duty count incremented
 * 
 * Step 4: Generate Reports
 *   - Download allocation as PDF
 *   - PDF includes: Faculty Name, Designation, Subject, Exam, Date, Session
 *   - Shows allocation summary by designation
 *   - Ready for download with no false data
 * 
 * API ENDPOINTS:
 * ==============
 * 
 * GET /admin/invigilator
 *   - Main allocation page
 *   - Returns: all staff, subjects, past allocations
 * 
 * GET /admin/invigilator/eligible?subject=xxx&batchId=yyyy-mm
 *   - Get eligible staff for subject
 *   - Returns: available staff, at-limit staff, excluded staff
 *   - Shows duty days used/remaining
 * 
 * GET /admin/invigilator/duty-check?name=xxx&designation=yyy&batchId=zzz
 *   - Check specific staff duty status
 *   - Returns: days used, remaining, status
 * 
 * GET /admin/invigilator/subjects
 *   - Get all unique subjects from staff records
 * 
 * POST /admin/invigilator/save
 *   - Save new allocation
 *   - Validates duty limits
 *   - Body: { examName, subjectName, examDate, session, allocations[], batchId }
 * 
 * POST /admin/invigilator/update/:id
 *   - Update existing allocation
 *   - Recalculates duty maps
 * 
 * POST /admin/invigilator/delete/:id
 *   - Delete allocation
 *   - Frees up duty days for staff
 * 
 * GET /admin/invigilator/download/:id
 *   - Download allocation as PDF
 *   - Professional format ready for printing
 * 
 * GET /admin/invigilator/export/batch?batchId=yyyy-mm
 *   - Export entire batch to Excel
 * 
 * EXAMPLE SCENARIO:
 * =================
 * 
 * September 2026 (Assessment 1) - Batch: "2026-09"
 * 
 * Day 1: Database Exam
 * - Allocate: Prof. A (1/3), Assoc. Prof B (1/4), Asst. Prof C (1/5)
 * 
 * Day 2: AI Exam
 * - Allocate: Prof. A (2/3), Assoc. Prof B (2/4), Asst. Prof D (1/5)
 * 
 * Day 3: Data Analytics Exam
 * - Allocate: Prof. A (3/3), Assoc. Prof E (1/4), Asst. Prof C (2/5)
 * 
 * Day 4: Web Dev Exam
 * - Prof. A is blocked (3/3 limit reached)
 * - Can only allocate from: Assoc. Prof B (2/4), E (1/4), Asst. Prof C (2/5), etc.
 * 
 * Day 5 & 6: More exams
 * - Continue allocating respecting duty limits
 * 
 * October 2026 (Assessment 2) - Batch: "2026-10"
 * - All staff are RESET
 * - Prof. A can take 3 new days
 * - Assoc. Prof B can take 4 new days
 * - etc.
 * 
 * NO OVERLAPPING / FALSE DATA:
 * ==============================
 * ✓ System automatically prevents duplicate allocations
 * ✓ Faculty names and designations pulled directly from seeded Excel
 * ✓ Subjects matched exactly from staff records
 * ✓ Duty days tracked accurately in real-time
 * ✓ PDF reports show exact counts without padding or false entries
 * ✓ Once a staff member hits their limit, they cannot be manually forced in
 * 
 * TROUBLESHOOTING:
 * ================
 * 
 * Q: Why is a staff member showing as blocked?
 * A: They have already been allocated the maximum duty days for their designation
 *    in the current month/batch.
 * 
 * Q: How do I reset allocations for a new assessment?
 * A: Create allocations with a new batchId (different month). Old batch allocations
 *    don't affect new batch duty counts.
 * 
 * Q: Can a staff member teach and invigilate?
 * A: Not for the same subject. They can invigilate other subjects.
 * 
 * Q: What if I need to change an allocation?
 * A: Use the Update button - system recalculates duty maps and validates constraints.
 * 
 * SEEDING:
 * ========
 * Faculty list is seeded from: backend/data/Fac List 2026-27.xlsx
 * Run: node backend/data/seedStaffFromExcel.js
 * 
 * This command:
 * - Reads the Excel file
 * - Extracts: Name, Designation, Subject, Department
 * - Maps designations to standard formats
 * - Seeds 57 staff members into MongoDB Staff collection
 * - Shows breakdown by designation and duty days
 */

module.exports = {
  docGenerated: new Date().toISOString()
};

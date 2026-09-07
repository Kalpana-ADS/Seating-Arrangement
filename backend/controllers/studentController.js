const Student = require('../models/Student');
const Seating = require('../models/Seating');
const XLSX = require('xlsx');
const fs = require('fs');

// ─── Year normalisation ───────────────────────────────────────────────────────
const normalizeYear = rawYear => {
  const year = String(rawYear || '').trim().toUpperCase();
  if (year === '2' || year === '2ND' || year === 'SECOND') return 'II';
  if (year === '3' || year === '3RD' || year === 'THIRD') return 'III';
  if (year === '4' || year === '4TH' || year === 'FOURTH') return 'IV';
  return ['II', 'III', 'IV'].includes(year) ? year : null;
};

// ─── Guess the year from a sheet name (e.g. "III - A" -> III) ────────────────
const yearFromSheetName = name => {
  const n = String(name || '').toUpperCase();
  if (/\bIV\b|\b4(?:TH)?\b|\bFOURTH\b/.test(n)) return 'IV';
  if (/\bIII\b|\b3(?:RD)?\b|\bTHIRD\b/.test(n)) return 'III';
  if (/\bII\b|\b2(?:ND)?\b|\bSECOND\b/.test(n)) return 'II';
  return null;
};

// ─── Guess the section from a sheet name (e.g. "III - A" / "AIDS B" -> B) ────
const sectionFromSheetName = name => {
  const m = String(name || '').trim().match(/\b([A-Z])\s*$/i);
  return m ? m[1].toUpperCase() : '';
};

// ─── Sheets that are summaries / belong to another department ────────────────
const isJunkSheet = (name, totalSheets) => {
  const n = String(name || '').toLowerCase();
  if (n.includes('overall') || n.includes('total')) return true;
  // Only drop auto-named/summary sheets when the file really has many sheets
  // (a single-sheet CSV is named "Sheet1" and must still be accepted).
  if (totalSheets > 1) {
    if (/^sheet\d*$/i.test(n)) return true;
    if (n.includes('special class')) return true;
  }
  return false;
};

// ─── Parse one worksheet into student records ────────────────────────────────
const parseSheet = (ws, sheetName, defaultYear, defaultSection) => {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (!data || data.length < 2) return [];

  // Auto-detect the header row (files may have a title block above the table).
  let hdrRow = -1;
  for (let r = 0; r < Math.min(data.length, 30); r++) {
    if (!Array.isArray(data[r])) continue;
    const joined = data[r].map(c => String(c ?? '').trim().toLowerCase()).join('|');
    if (/register|roll/.test(joined)) { hdrRow = r; break; }
  }
  if (hdrRow < 0) return [];

  const headers = data[hdrRow].map(h => String(h).trim().toLowerCase());
  const nameIdx = headers.findIndex(h => h.includes('name'));
  const regIdx  = headers.findIndex(h => h.includes('register') || h.includes('reg') || h.includes('roll'));
  const yearIdx = headers.findIndex(h => h.includes('year'));
  const secIdx  = headers.findIndex(h => h.includes('section') || h.includes('sec'));
  if (regIdx === -1) return [];

  const sheetYear    = yearFromSheetName(sheetName) || defaultYear;
  const sheetSection = sectionFromSheetName(sheetName);

  const records = [];
  for (let i = hdrRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!Array.isArray(row)) continue;
    const regNum = String(regIdx !== -1 ? row[regIdx] || '' : '').trim().replace(/\.0$/, '');
    if (!regNum || regNum === 'undefined' || regNum.toLowerCase() === 'nan') continue;
    // Skip repeated header rows that may appear mid-sheet (e.g. S.NO / ROLL NO).
    if (/^(s\.?no|slno|roll|rollno|rollnumber|register|reg|registernumber|name|candidate)$/i.test(regNum)) continue;

    const name = nameIdx !== -1 ? String(row[nameIdx] || '').trim() : 'Unknown';
    // Year precedence: explicit column year > admin-selected Default Year from the
    // form > year derived from the sheet name. The Default Year is authoritative
    // because some files (e.g. IV) label their sheets with the previous year.
    let year = yearIdx !== -1 ? normalizeYear(row[yearIdx]) : null;
    if (!year) year = defaultYear || 'II';
    if (!year) year = sheetYear;
    if (!year) year = 'II';

    let section = secIdx !== -1 ? String(row[secIdx] || '').trim() : '';
    if (!section) section = sheetSection;
    if (!section) section = defaultSection || 'A';
    section = section.toUpperCase();

    records.push({ name, registerNumber: regNum, year, section });
  }
  return records;
};

const uploadDataset = async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('/admin/upload');
    }
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    if (!sheetNames || sheetNames.length === 0) {
      fs.unlinkSync(filePath);
      req.flash('error', 'File is empty or has no data rows.');
      return res.redirect('/admin/upload');
    }

    const defaultYear    = normalizeYear(req.body.defaultYear) || 'II';
    const defaultSection = String(req.body.defaultSection || 'A').trim().toUpperCase();

    // Parse EVERY sheet so that each section (one sheet per section) is captured.
    const allRecords = [];
    const sheetsParsed = [];
    for (const sheetName of sheetNames) {
      if (isJunkSheet(sheetName, sheetNames.length)) continue;
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const recs = parseSheet(ws, sheetName, defaultYear, defaultSection);
      if (recs.length) sheetsParsed.push({ sheetName, count: recs.length });
      allRecords.push(...recs);
    }

    if (allRecords.length === 0) {
      fs.unlinkSync(filePath);
      req.flash('error', 'No valid student rows found. Ensure a column header contains "register", "reg", or "roll".');
      return res.redirect('/admin/upload');
    }

    // Replace only the year groups present in the uploaded file.
    const uploadedYears = Array.from(new Set(allRecords.map(r => r.year)));
    if (uploadedYears.length) {
      await Student.deleteMany({ year: { $in: uploadedYears } });
      await Seating.deleteMany({ year: { $in: uploadedYears } });
    }

    let inserted = 0, skipped = 0;
    for (const rec of allRecords) {
      try {
        await Student.findOneAndUpdate(
          { registerNumber: rec.registerNumber },
          { name: rec.name, registerNumber: rec.registerNumber, year: rec.year, section: rec.section, isAllocated: false },
          { upsert: true, new: true }
        );
        inserted++;
      } catch (e) {
        skipped++;
      }
    }

    fs.unlinkSync(filePath);
    const sheetsNote = sheetsParsed.length
      ? ` (${sheetsParsed.length} sheets: ${sheetsParsed.map(s => `${s.sheetName}=${s.count}`).join(', ')})`
      : '';
    req.flash('success', `Dataset uploaded! ${inserted} students processed, ${skipped} skipped.${sheetsNote}`);
    res.redirect('/admin/students');
  } catch (err) {
    console.error('Upload error:', err);
    req.flash('error', 'Error processing file: ' + err.message);
    res.redirect('/admin/upload');
  }
};

const getStudents = async (req, res) => {
  try {
    const { year, section, search } = req.query;
    let filter = {};
    if (year) filter.year = year;
    if (section) filter.section = { $regex: section, $options: 'i' };
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { registerNumber: { $regex: search, $options: 'i' } }
    ];

    const students = await Student.find(filter).sort({ year: 1, section: 1, registerNumber: 1 });
    const totalStudents = await Student.countDocuments();
    const yearCounts = await Student.aggregate([
      { $group: { _id: '$year', count: { $sum: 1 } } }
    ]);

    res.render('admin/students', {
      title: 'Manage Students',
      students,
      totalStudents,
      yearCounts,
      filters: { year, section, search },
      adminName: req.session.adminName,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error fetching students.');
    res.redirect('/admin/dashboard');
  }
};

const deleteStudent = async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    req.flash('success', 'Student deleted successfully.');
    res.redirect('/admin/students');
  } catch (err) {
    req.flash('error', 'Error deleting student.');
    res.redirect('/admin/students');
  }
};

const clearAllStudents = async (req, res) => {
  try {
    const { year } = req.body;
    const filter = year ? { year } : {};
    await Student.deleteMany(filter);
    req.flash('success', year ? `All ${year} year students cleared.` : 'All students cleared.');
    res.redirect('/admin/students');
  } catch (err) {
    req.flash('error', 'Error clearing students.');
    res.redirect('/admin/students');
  }
};

module.exports = { uploadDataset, getStudents, deleteStudent, clearAllStudents };

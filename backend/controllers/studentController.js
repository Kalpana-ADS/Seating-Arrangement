const Student = require('../models/Student');
const Seating = require('../models/Seating');
const XLSX = require('xlsx');
const fs = require('fs');

const uploadDataset = async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error', 'No file uploaded.');
      return res.redirect('/admin/upload');
    }
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (data.length < 2) {
      fs.unlinkSync(filePath);
      req.flash('error', 'File is empty or has no data rows.');
      return res.redirect('/admin/upload');
    }

    // Detect headers
    const headers = data[0].map(h => String(h).trim().toLowerCase());
    const nameIdx = headers.findIndex(h => h.includes('name'));
    const regIdx = headers.findIndex(h => h.includes('register') || h.includes('reg') || h.includes('roll'));
    const yearIdx = headers.findIndex(h => h.includes('year'));
    const secIdx = headers.findIndex(h => h.includes('section') || h.includes('sec'));

    if (regIdx === -1) {
      fs.unlinkSync(filePath);
      req.flash('error', 'Could not find Register Number column. Ensure column header contains "register", "reg", or "roll".');
      return res.redirect('/admin/upload');
    }

    const rows = data.slice(1);
    let inserted = 0, skipped = 0, errors = [];
    const uploadedYears = new Set();

    const normalizeYear = rawYear => {
      let year = String(rawYear || '').trim().toUpperCase();
      if (year === '2' || year === '2ND' || year === 'SECOND') return 'II';
      if (year === '3' || year === '3RD' || year === 'THIRD') return 'III';
      if (year === '4' || year === '4TH' || year === 'FOURTH') return 'IV';
      return ['II', 'III', 'IV'].includes(year) ? year : null;
    };

    // Determine which year groups should be replaced before inserting new data.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const regNum = String(row[regIdx] || '').trim();
      if (!regNum || regNum === 'undefined') continue;

      let year = yearIdx !== -1 ? normalizeYear(row[yearIdx]) : null;
      if (!year) year = normalizeYear(req.body.defaultYear) || 'II';
      uploadedYears.add(year);
    }

    if (uploadedYears.size) {
      await Student.deleteMany({ year: { $in: Array.from(uploadedYears) } });
      await Seating.deleteMany({ year: { $in: Array.from(uploadedYears) } });
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const regNum = String(row[regIdx] || '').trim();
      if (!regNum || regNum === 'undefined') continue;

      const name = nameIdx !== -1 ? String(row[nameIdx] || '').trim() : 'Unknown';
      let year = yearIdx !== -1 ? normalizeYear(row[yearIdx]) : null;
      let section = secIdx !== -1 ? String(row[secIdx] || '').trim() : (req.body.defaultSection || 'A');
      if (!year) year = normalizeYear(req.body.defaultYear) || 'II';
      if (!['II', 'III', 'IV'].includes(year)) year = normalizeYear(req.body.defaultYear) || 'II';
      section = section.toUpperCase();

      try {
        await Student.findOneAndUpdate(
          { registerNumber: regNum },
          { name, registerNumber: regNum, year, section, isAllocated: false },
          { upsert: true, new: true }
        );
        inserted++;
      } catch (e) {
        skipped++;
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    }

    fs.unlinkSync(filePath);
    req.flash('success', `Dataset uploaded! ${inserted} students processed, ${skipped} skipped.`);
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

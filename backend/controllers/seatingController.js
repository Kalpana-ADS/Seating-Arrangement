const Seating = require('../models/Seating');
const Student = require('../models/Student');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs   = require('fs');

// Logo path for PDF embedding
const LOGO_PATH = path.join(__dirname, '../../public/images/logo.png');
const _getLogoBuffer = () => { try { return fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null; } catch(e){ return null; } };

const _parseDate = dateStr => {
  if (!dateStr) return null;
  if (typeof dateStr !== 'string') dateStr = String(dateStr);
  const isoMatch = /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
  if (isoMatch) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
  const slashMatch = /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr.trim());
  if (slashMatch) {
    const [dd, mm, yyyy] = dateStr.split('/').map(Number);
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

const _formatDmy = date => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const _escapeRegExp = str => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const _sectionQuery = section => {
  const escaped = _escapeRegExp(section.trim());
  return { section: { $regex: `(^|\\s*&\\s*)${escaped}($|\\s*&\\s*)`, $options: 'i' } };
};

const _getDateRange = (from, to, fallbackDate) => {
  const fromDate = _parseDate(from);
  const toDate = _parseDate(to);
  if (fromDate && toDate) {
    return `${_formatDmy(fromDate)} - ${_formatDmy(toDate)}`;
  }
  if (fromDate) {
    return _formatDmy(fromDate);
  }
  if (fallbackDate) {
    const fd = new Date(fallbackDate);
    return isNaN(fd.getTime()) ? '' : _formatDmy(fd);
  }
  return '';
};

const _upper = (value) => (value == null ? '' : String(value).trim().toUpperCase());

// ── helpers ────────────────────────────────────────────────────────────────
const getStudentsForSection = async (year, section) =>
  Student.find({ year, section: { $regex: `^${section}$`, $options: 'i' } })
    .sort({ registerNumber: 1 });

// ── Dashboard ──────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments();
    const totalSeating  = await Seating.countDocuments();
    const yearII  = await Student.countDocuments({ year: 'II' });
    const yearIII = await Student.countDocuments({ year: 'III' });
    const yearIV  = await Student.countDocuments({ year: 'IV' });
    const recentSeating = await Seating.find().sort({ createdAt: -1 }).limit(5);
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { totalStudents, totalSeating, yearII, yearIII, yearIV },
      recentSeating,
      adminName: req.session.adminName,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { totalStudents: 0, totalSeating: 0, yearII: 0, yearIII: 0, yearIV: 0 },
      recentSeating: [], adminName: req.session.adminName,
      error: [err.message], success: []
    });
  }
};

// ── Seating management page ────────────────────────────────────────────────
const getSeatingManage = async (req, res) => {
  try {
    const { year } = req.query;
    const filter   = year ? { year } : {};
    const seatings = await Seating.find(filter).sort({ year: 1, section: 1, order: 1 });
    const sections = await Student.aggregate([
      { $group: { _id: { year: '$year', section: '$section' } } },
      { $sort:  { '_id.year': 1, '_id.section': 1 } }
    ]);
    res.render('admin/seating', {
      title: 'Seating Arrangement',
      seatings, sections,
      selectedYear: year || '',
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/dashboard');
  }
};

// ── Auto-generate seating ──────────────────────────────────────────────────
const generateSeating = async (req, res) => {
  try {
    const { year, section, studentsPerRow, examName, hallNumber, examDate } = req.body;
    if (!year || !section) {
      req.flash('error', 'Year and section are required.');
      return res.redirect('/admin/seating');
    }
    const normYear = String(year).trim().toUpperCase();
    const normSection = String(section).trim().toUpperCase();
    const perRow   = parseInt(studentsPerRow) || 15;
    const students = await getStudentsForSection(normYear, normSection);
    if (!students.length) {
      req.flash('error', `No students found for ${year} Year - Section ${section}.`);
      return res.redirect('/admin/seating');
    }
    await Seating.deleteMany({ year: normYear, section: normSection });

    const newSeatings = [];
    let idx = 0, order = 0, seatStart = 1;
    while (idx < students.length) {
      const batch = students.slice(idx, idx + perRow);
      newSeatings.push({
        year: normYear, section: normSection,
        startRegister: batch[0].registerNumber,
        endRegister:   batch[batch.length - 1].registerNumber,
        totalStudents: batch.length,
        examName:   examName   || 'Internal Assessment',
        hallNumber: hallNumber || '',
        examDate:   examDate   ? new Date(examDate) : new Date(),
        seatStart,
        order: order++
      });
      seatStart += batch.length;
      idx       += perRow;
    }
    await Seating.insertMany(newSeatings);
    req.flash('success', `Seating generated for ${normYear} Year – Section ${normSection}. ${newSeatings.length} row(s) created.`);
    res.redirect(`/admin/seating?year=${normYear}`);
  } catch (err) {
    req.flash('error', 'Error generating seating: ' + err.message);
    res.redirect('/admin/seating');
  }
};

// ── Add next row (continue) ────────────────────────────────────────────────
const addSeatingRow = async (req, res) => {
  try {
    const { year, section, totalStudents, hallNumber,
            examName, examDate, examSession } = req.body;

    if (!year || !section || !totalStudents || !hallNumber)
      return res.json({ success: false, message: 'Year, section, hall number and student count are required.' });

    const normalizedYear = String(year).trim().toUpperCase();
    const normalizedSection = String(section).trim().toUpperCase();
    const count = parseInt(totalStudents);
    if (isNaN(count) || count < 1)
      return res.json({ success: false, message: 'Invalid student count.' });

    // ── Find all students for this year in register-number order ─────────────
    // We'll pull from section, then overflow into next sections if needed
    const allStudentsThisYear = await Student.find({ year: normalizedYear })
      .sort({ section: 1, registerNumber: 1 });

    // Build ordered list starting from the requested section
    const sectionOrder = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const secIdx = sectionOrder.indexOf(normalizedSection);
    const orderedStudents = [];

    // First: students in the requested section
    const secStudents = allStudentsThisYear.filter(s =>
      String(s.section || '').toUpperCase() === normalizedSection
    );

    // Find how many already allocated in this section by maximum assigned register
    const sectionRows = await Seating.find({ year: normalizedYear, ..._sectionQuery(normalizedSection) });

    let secStartIdx = 0;
    if (sectionRows.length) {
      const endIndexes = sectionRows
        .map(r => secStudents.findIndex(s => s.registerNumber === r.endRegister))
        .filter(i => i >= 0);
      secStartIdx = endIndexes.length ? Math.max(...endIndexes) + 1 : 0;
    }

    // Remaining students in requested section
    const remainingInSec = secStudents.slice(secStartIdx);
    orderedStudents.push(...remainingInSec);

    // If not enough, overflow into subsequent sections
    let sectionsUsed = [normalizedSection];
    let nextSecIdx = secIdx + 1;
    while (orderedStudents.length < count && nextSecIdx < sectionOrder.length) {
      const nextSec = sectionOrder[nextSecIdx];
      const nextSecStudents = allStudentsThisYear.filter(s =>
        s.section.toUpperCase() === nextSec
      );
      // Only include students not yet allocated in next section
      const nextSectionRows = await Seating.find({ year, ..._sectionQuery(nextSec) });
      let nextStartIdx = 0;
      if (nextSectionRows.length) {
        const endIndexes = nextSectionRows
          .map(r => nextSecStudents.findIndex(s => s.registerNumber === r.endRegister))
          .filter(i => i >= 0);
        nextStartIdx = endIndexes.length ? Math.max(...endIndexes) + 1 : 0;
      }
      const remaining = nextSecStudents.slice(nextStartIdx);
      if (remaining.length > 0) sectionsUsed.push(nextSec);
      orderedStudents.push(...remaining);
      nextSecIdx++;
    }

    // Take exactly count students
    const batch = orderedStudents.slice(0, count);
    if (!batch.length)
      return res.json({ success: false, message: `No unallocated students found for ${normalizedYear} Year starting from Section ${normalizedSection}.` });

    // ── Determine seatStart — continue from last row IN THIS HALL ────────────
    let seatStart = 1;
    const lastInHall = await Seating.findOne({
      hallNumber: { $regex: `^${hallNumber}$`, $options: 'i' }
    }).sort({ createdAt: -1 });
    if (lastInHall) {
      seatStart = lastInHall.seatStart + lastInHall.totalStudents;
    }

    // ── Build section display label (e.g. "B & C" if overflow) ───────────────
    const sectionLabel = sectionsUsed.length > 1
      ? sectionsUsed.join(' & ')
      : sectionsUsed[0];

    // ── Determine order ───────────────────────────────────────────────────────
    const lastAny = await Seating.findOne({}).sort({ order: -1 });
    const newOrder = lastAny ? lastAny.order + 1 : 0;

    // ── Save seating row ──────────────────────────────────────────────────────
    const seating = await Seating.create({
      year: normalizedYear,
      section:       sectionLabel,
      startRegister: batch[0].registerNumber,
      endRegister:   batch[batch.length - 1].registerNumber,
      totalStudents: batch.length,
      hallNumber:    hallNumber || '',
      examName:      examName || 'Internal Assessment',
      examDate:      examDate ? new Date(examDate) : new Date(),
      examSession:   examSession || 'FN',
      seatStart,
      order:         newOrder
    });

    return res.json({
      success: true,
      message: `Row added: ${batch[0].registerNumber} – ${batch[batch.length-1].registerNumber} (Seats ${seatStart}–${seatStart + batch.length - 1})`,
      seating
    });
  } catch (err) {
    console.error('addSeatingRow error:', err);
    return res.json({ success: false, message: err.message });
  }
};;

// ── CASCADE: recalculate seats + reg numbers for all rows after a change ────
const cascadeUpdate = async (changedRow, oldHall = null) => {
  try {
    const hallValues = [oldHall || changedRow.hallNumber, changedRow.hallNumber].map(h => (h || '').trim()).filter(Boolean);
    const uniqueHalls = [...new Set(hallValues.map(h => h.toLowerCase()))].map(h => h);

    for (const hallValue of uniqueHalls) {
      const hallRows = await Seating.find({
        hallNumber: { $regex: `^${_escapeRegExp(hallValue)}$`, $options: 'i' }
      }).sort({ seatStart: 1, order: 1 });
      let seat = 1;
      for (const r of hallRows) {
        if (r.seatStart !== seat) { r.seatStart = seat; }
        r.hallNumber = hallValue;
        await r.save();
        seat += r.totalStudents;
      }
    }

    const sectionParts = changedRow.section.split('&').map(s => s.trim());
    const students = await Student.find({
      year: changedRow.year,
      section: { $in: sectionParts.map(s => new RegExp(`^${s}$`,'i')) }
    }).sort({ registerNumber: 1 });
    const laterRows = await Seating.find({
      year: changedRow.year,
      section: changedRow.section,
      order: { $gt: changedRow.order }
    }).sort({ order: 1 });
    let idx = students.findIndex(s => s.registerNumber === changedRow.endRegister);
    idx = idx >= 0 ? idx + 1 : 0;
    for (const r of laterRows) {
      const batch = students.slice(idx, idx + r.totalStudents);
      if (batch.length > 0) {
        r.startRegister = batch[0].registerNumber;
        r.endRegister   = batch[batch.length-1].registerNumber;
        await r.save();
      }
      idx += r.totalStudents;
    }
  } catch(e) { console.error('Cascade error:', e.message); }
};

// ── Inline update (edit) a seating row ────────────────────────────────────
const updateSeating = async (req, res) => {
  try {
    const { hallNumber, examName, examDate, totalStudents,
            startRegister, endRegister, seatStart, examSession } = req.body;

    const row = await Seating.findById(req.params.id);
    if (!row) return res.json({ success: false, message: 'Record not found.' });

    const oldTotal = row.totalStudents;
    const oldHall = row.hallNumber;

    if (hallNumber    !== undefined) row.hallNumber    = String(hallNumber).trim().toUpperCase();
    if (examName      !== undefined) row.examName      = examName;
    if (examDate      !== undefined) row.examDate      = new Date(examDate);
    if (totalStudents !== undefined) row.totalStudents = parseInt(totalStudents);
    if (startRegister !== undefined) row.startRegister = startRegister;
    if (endRegister   !== undefined) row.endRegister   = endRegister;
    if (seatStart     !== undefined) row.seatStart     = parseInt(seatStart);
    if (examSession   !== undefined) row.examSession   = examSession;
    if (row.year) row.year = String(row.year).trim().toUpperCase();
    if (row.section) row.section = String(row.section).trim().toUpperCase();

    await row.save();

    const hallChanged = hallNumber !== undefined && String(oldHall || '').trim() !== String(hallNumber).trim();
    const countChanged = totalStudents !== undefined && parseInt(totalStudents) !== oldTotal;

    if (hallChanged || countChanged) {
      await cascadeUpdate(row, oldHall);
    }

    return res.json({ success: true, message: 'Updated. Cascade applied.', seating: row });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

const deleteSeating = async (req, res) => {
  try {
    await Seating.findByIdAndDelete(req.params.id);
    req.flash('success', 'Seating row deleted.');
    res.redirect('/admin/seating');
  } catch (err) {
    req.flash('error', 'Error deleting seating.');
    res.redirect('/admin/seating');
  }
};

const clearSeating = async (req, res) => {
  try {
    const { year } = req.body;
    await Seating.deleteMany(year ? { year } : {});
    req.flash('success', year ? `Seating for ${year} Year cleared.` : 'All seating data cleared.');
    res.redirect('/admin/seating');
  } catch (err) {
    req.flash('error', 'Error clearing seating.');
    res.redirect('/admin/seating');
  }
};

// ── Public seating view ────────────────────────────────────────────────────
const getPublicSeating = async (req, res) => {
  try {
    const map = { '2':'II','3':'III','4':'IV','II':'II','III':'III','IV':'IV' };
    const mappedYear = map[req.params.year];
    if (!mappedYear) return res.redirect('/');
    const seatings = await Seating.find({ year: mappedYear }).sort({ section: 1, order: 1 });
    const examDate = seatings.length ? seatings[0].examDate : new Date();
    const examName = seatings.length ? seatings[0].examName : 'Internal Assessment';
    res.render('public/seating', {
      title: `${mappedYear} Year Seating Arrangement`,
      seatings, year: mappedYear, examDate, examName
    });
  } catch (err) {
    res.redirect('/');
  }
};

// ── Hall Sheet page (dept notice board) ────────────────────────────────────
const getHallSheet = async (req, res) => {
  try {
    const hall = String(req.params.hall || '').trim().toUpperCase();
    const { from, to } = req.query;
    // Get all seating rows for this hall across all years
    const seatings = await Seating.find({ hallNumber: { $regex: `^${hall}$`, $options: 'i' } })
                                   .sort({ year: 1, section: 1, order: 1 });
    // Get all unique halls for dropdown
    const allHalls = await Seating.distinct('hallNumber');
    const examDate = seatings.length ? seatings[0].examDate : new Date();
    const examName = seatings.length ? seatings[0].examName : 'Internal Assessment';
    res.render('admin/hallsheet', {
      title: `Hall ${hall} – Seating Sheet`,
      seatings, hall, allHalls, examDate, examName,
      dateFrom: from || '',
      dateTo: to || '',
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/seating');
  }
};

// ── Dept entrance notice (all halls, all years combined) ──────────────────
const getDeptNotice = async (req, res) => {
  try {
    const { year, from, to } = req.query;
    const filter   = year ? { year } : {};
    const seatings = await Seating.find(filter).sort({ hallNumber: 1, year: 1, section: 1, order: 1 });
    const allHalls = await Seating.distinct('hallNumber');
    const examDate = seatings.length ? seatings[0].examDate : new Date();
    const examName = seatings.length ? seatings[0].examName : 'Internal Assessment';
    res.render('admin/deptnotice', {
      title: 'Dept Entrance Notice',
      seatings, allHalls, selectedYear: year || '',
      dateFrom: from || '',
      dateTo: to || '',
      examDate, examName,
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/seating');
  }
};

// ── PDF Export ─────────────────────────────────────────────────────────────
const exportPDF = async (req, res) => {
  try {
    const map = { '2':'II','3':'III','4':'IV','II':'II','III':'III','IV':'IV' };
    const mappedYear = map[req.params.year] || req.params.year;
    const filter   = mappedYear ? { year: mappedYear } : {};
    const seatings = await Seating.find(filter).sort({ year: 1, section: 1, order: 1 });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=seating_${mappedYear}_${Date.now()}.pdf`);
    doc.pipe(res);

    _pdfHeader(doc, mappedYear, seatings);

    if (!seatings.length) {
      doc.text('No seating arrangement found.', { align: 'center' });
    } else {
      // cols: S.No | Year/Sec | Hall | Reg Range | Seats | Total
      const colX = [50, 90, 175, 250, 400, 470];
      const colW = [40, 85, 75,  150, 70,  75];
      const rowH = 22;
      let y = doc.y;

      _tableHeader(doc, y, rowH, colX, colW,
        ['S.No','YEAR/SEC','HALL NO','REG NUMBER RANGE','SEAT NOS','TOTAL']);
      y += rowH;

      seatings.forEach((s, i) => {
        if (y > 750) { doc.addPage(); y = 50; }
        const bg = i % 2 === 0 ? '#f3f4f6' : '#ffffff';
        doc.rect(50, y, 495, rowH).fillColor(bg).fill();
        doc.rect(50, y, 495, rowH).strokeColor('#ccc').lineWidth(0.5).stroke();
        doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
        const seatEnd = s.seatStart + s.totalStudents - 1;
        const vals = [
          String(i + 1),
          `${s.year} ${s.section}`,
          s.hallNumber || '-',
          `${s.startRegister} – ${s.endRegister}`,
          `${s.seatStart} – ${seatEnd}`,
          String(s.totalStudents)
        ];
        vals.forEach((v, ci) => {
          doc.text(v, colX[ci], y + 6, { width: colW[ci], align: 'center' });
        });
        y += rowH;
      });

      doc.moveDown(2);
      const total = seatings.reduce((a, s) => a + s.totalStudents, 0);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
         .text(`Total Students Allocated: ${total}`, { align: 'right' });
    }
    _pdfFooter(doc);
    doc.end();
  } catch (err) {
    res.status(500).send('Error generating PDF: ' + err.message);
  }
};


// ── Find TC/missing students within a batch ─────────────────────────────────
// Only gaps ≤ 10 are considered TC students; larger gaps = section boundaries
const findTCGaps = (students) => {
  if (!students.length) return [];
  const gaps = [];
  // Extract numeric suffix
  const prefix = students[0].registerNumber.replace(/\d+$/, '');
  const padLen  = students[0].registerNumber.length - prefix.length;
  const nums    = students.map(s => parseInt(s.registerNumber.replace(prefix, '')));
  for (let i = 1; i < nums.length; i++) {
    const diff = nums[i] - nums[i-1];
    if (diff > 1 && diff <= 10) {
      for (let g = nums[i-1]+1; g < nums[i]; g++) {
        gaps.push(prefix + String(g).padStart(padLen, '0'));
      }
    }
  }
  return gaps;
};

// ── Hall Sheet PDF — individual student list with seat numbers ────────────
const exportHallPDF = async (req, res) => {
  try {
    const hall = String(req.params.hall || '').trim().toUpperCase();
    const seatings = await Seating.find({ hallNumber: { $regex: `^${hall}$`, $options: 'i' } })
                                   .sort({ seatStart: 1 });
    if (!seatings.length)
      return res.status(404).send('No students assigned to Hall ' + hall);

    const examName = seatings[0].examName || 'Internal Assessment';
    const session  = seatings[0].examSession || '';
    const dateRange = _getDateRange(req.query.from, req.query.to, seatings[0].examDate);
    const sessionLabel = session === 'FN' ? 'FN  —  8:15 AM – 11:15 AM'
                       : session === 'AN' ? 'AN  —  12:15 PM – 3:15 PM'
                       : 'FN  —  8:15 AM – 11:15 AM';
    const grandTotal = seatings.reduce((a,s) => a + s.totalStudents, 0);

    const doc = new PDFDocument({ margin: 45, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="HallSheet_${hall}_${examName.replace(/\s+/g,'_')}.pdf"`);
    doc.pipe(res);

    // ── HEADER ────────────────────────────────────────────────────────────────
    const logoBuf = _getLogoBuffer();
    const sy = doc.y;
    if (logoBuf) { try { doc.image(logoBuf, 45, sy, { width:60, height:60 }); } catch(e){} }
    const tx = logoBuf ? 115 : 45;
    const tw = logoBuf ? 380 : 505;

    doc.fontSize(15).font('Helvetica-Bold').fillColor('#0D1B4B')
       .text('PANIMALAR ENGINEERING COLLEGE', tx, sy + 2, { width: tw, align: 'center' });
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
       .text('(Autonomous Institution)', tx, doc.y + 2, { width: tw, align: 'center' });
    doc.text('Department of Artificial Intelligence and Data Science',
       tx, doc.y + 2, { width: tw, align: 'center' });
    doc.y = Math.max(doc.y + 4, sy + 68);
    doc.moveDown(0.3);
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor('#0D1B4B').lineWidth(2).stroke();
    doc.moveDown(0.4);

    // ── TITLE ─────────────────────────────────────────────────────────────────
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000')
       .text('EXAMINATION HALL SEATING ARRANGEMENT', { align: 'center' });
    doc.moveDown(0.3);

    // ── META BOX ──────────────────────────────────────────────────────────────
    const bx = 45, by = doc.y, bh = 54;
    doc.rect(bx, by, 505, bh).fillColor('#E8EAF6').fill();
    doc.rect(bx, by, 505, bh).strokeColor('#000105').lineWidth(0.5).stroke();
    doc.fillColor('#0D1B4B').fontSize(10).font('Helvetica-Bold');
    doc.text('Hall No: ' + hall,             bx+10, by+6,  { width:120 });
    doc.text('Exam: ' + examName,            bx+140, by+6, { width:220 });
    doc.text('Total Students: ' + grandTotal, bx+370, by+6, { width:130 });
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0D1B4B');
    doc.text('Session: ' + sessionLabel,     bx+10, by+28, { width:210 });
    doc.text('Date: ' + dateRange,           bx+230, by+28, { width:260 });
    doc.y = by + bh + 10;

    // ── SUMMARY TABLE (one row per section — NO individual students) ──────────
    const colX = [45,  95,  215, 345, 415, 470];
    const colW = [50, 120,  130,  70,  55,  80];
    const rowH = 38;
    let y = doc.y;

    // Table header
    doc.rect(45, y, 505, rowH).fillColor('#030920').fill();
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold');
    ['S.No','YEAR / SECTION','REG NO RANGE','SEAT RANGE','TOTAL','EXAM']
      .forEach((h, i) => doc.text(h, colX[i], y + 13, { width: colW[i], align: 'center' }));
    y += rowH;

    // Fetch actual students for TC detection
    const seatingWithTC = await Promise.all(seatings.map(async (s) => {
      const secParts = s.section.split('&').map(x=>x.trim());
      const studs = await Student.find({
        year: s.year,
        section: { $in: secParts.map(sp => new RegExp(`^${sp}$`,'i')) }
      }).sort({ registerNumber:1 });
      // Only include students within this row's reg range
      const batch = studs.filter(st =>
        st.registerNumber >= s.startRegister && st.registerNumber <= s.endRegister
      );
      const tcGaps = findTCGaps(batch);
      return { s, tcGaps };
    }));

    seatingWithTC.forEach(({ s, tcGaps }, i) => {
      const rowHNeeded = rowH + (tcGaps.length ? 18 : 0);
      if (y > 720) { doc.addPage(); y = 45; }
      const seatEnd = s.seatStart + s.totalStudents - 1;
      const bg = i % 2 === 0 ? '#F3F4F6' : '#FFFFFF';
      doc.rect(45, y, 505, rowHNeeded).fillColor(bg).fill();
      doc.rect(45, y, 505, rowHNeeded).strokeColor('#CCCCCC').lineWidth(0.5).stroke();

      doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold');
      doc.text(String(i+1),                           colX[0], y+13, { width:colW[0], align:'center' });
      doc.font('Helvetica-Bold').fillColor('#0D1B4B').fontSize(11);
      doc.text(_upper(s.year) + ' Year  —  Sec ' + _upper(s.section), colX[1], y+12, { width:colW[1], align:'center' });
      doc.font('Helvetica-Bold').fillColor('#000000').fontSize(9);
      doc.text(s.startRegister + '  –  ' + s.endRegister, colX[2], y+13, { width:colW[2], align:'center' });
      doc.fillColor('#111111').fontSize(11).font('Helvetica-Bold');
      doc.text(s.seatStart + '  –  ' + seatEnd,           colX[3], y+13, { width:colW[3], align:'center' });
      doc.fillColor('#0D1B4B').fontSize(13);
      doc.text(String(s.totalStudents),                    colX[4], y+11, { width:colW[4], align:'center' });
      doc.font('Helvetica-Bold').fillColor('#000000').fontSize(9);
      doc.text(s.examName,                                 colX[5], y+13, { width:colW[5], align:'center', ellipsis:true });
      y += rowH;

      // TC Exception note row — orange warning strip
      if (tcGaps.length) {
        doc.rect(45, y, 505, 20).fillColor('#e2d5bb').fill();
        doc.rect(45, y, 505, 20).strokeColor('#fff4ee').lineWidth(1).stroke();
        doc.fillColor('#070606').fontSize(8.5).font('Helvetica-Bold');
        doc.text('EXCEPT: ', 52, y + 6, { continued: true });
doc.font('Helvetica-Bold').fillColor('#000000');
        doc.text(tcGaps.join('  |  '), { width: 430 });
        y += 20;
      }
    });

    // Total row
    if (y > 720) { doc.addPage(); y = 45; }
    doc.rect(45, y, 505, rowH).fillColor('#0D1B4B').fill();
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold');
    doc.text('TOTAL STUDENTS IN HALL  ' + hall + ' :',  45, y+13, { width:360, align:'right' });
    doc.fillColor('#d9bc64').fontSize(14);
    doc.text(String(grandTotal), 415, y+11, { width:120, align:'center' });
    y += rowH + 65;

    // ── SIGNATURE SECTION ─────────────────────────────────────────────────────
    if (y > 750) { doc.addPage(); y = 45; }
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
    const leftX = 45;
    const rightX = 355;
    const lineWidth = 180;
    const lineSpacing = 56;
    for (let i = 0; i < 6; i++) {
      const rowY = y + i * lineSpacing;
      doc.text('Invigilator 1 Name & Signature', leftX, rowY);
      doc.moveTo(leftX, rowY + 32).lineTo(leftX + lineWidth, rowY + 32).strokeColor('#121212').lineWidth(1).stroke();
      doc.text('Invigilator 2 Name & Signature', rightX, rowY);
      doc.moveTo(rightX, rowY + 32).lineTo(rightX + lineWidth, rowY + 32).strokeColor('#101010').lineWidth(1).stroke();
    }

    // Footer removed as requested

    doc.end();
  } catch (err) {
    console.error('Hall PDF error:', err);
    res.status(500).send('Error: ' + err.message);
  }
};;

// ── Dept Entrance Notice PDF ───────────────────────────────────────────────
const exportDeptNoticePDF = async (req, res) => {
  try {
    const { year, from, to } = req.query;
    const filter   = year ? { year } : {};
    const seatings = await Seating.find(filter).sort({ hallNumber: 1, year: 1, section: 1, order: 1 });

    const doc = new PDFDocument({ margin: 45, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=dept_notice_${year || 'all'}_${Date.now()}.pdf`);
    doc.pipe(res);

    const _dlogoBuf = _getLogoBuffer();
    const _dstartY  = doc.y;
    if (_dlogoBuf) { try { doc.image(_dlogoBuf, 45, _dstartY, { width:55, height:55 }); } catch(e){} }
    const _dtx = _dlogoBuf ? 110 : 45; const _dtw = _dlogoBuf ? 390 : 510;
    doc.fontSize(15).font('Helvetica-Bold').fillColor('#1a237e')
       .text('PANIMALAR ENGINEERING COLLEGE', _dtx, _dstartY+2, { width:_dtw, align:'center' });
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
       .text('(Autonomous Institution) – Dept. of Artificial Intelligence and Data Science', _dtx, doc.y+2, { width:_dtw, align:'center' });
    doc.y = Math.max(doc.y+4, _dstartY+63);
    doc.moveDown(0.3);
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor('#1a237e').lineWidth(2).stroke();
    doc.moveDown(0.4);

    const examName = seatings.length ? seatings[0].examName : 'Internal Assessment';
    const fallbackExamDate = seatings.find(s => s.examDate)?.examDate || null;
    let dateRange = _getDateRange(from, to, fallbackExamDate);
    if (from && to && !dateRange.includes(' - ')) {
      dateRange = `${from} - ${to}`;
    }
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
       .text(`DEPARTMENT ENTRANCE NOTICE – SEATING ARRANGEMENT${year ? ' – ' + year + ' YEAR' : ''}`, { align: 'center' });
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
       .text(`Exam: ${examName}`, { align: 'center' });
    doc.text(`Date: ${dateRange}`, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, { align: 'center' });
    doc.moveDown(1);

    if (!seatings.length) {
      doc.text('No seating data found.', { align: 'center' });
    } else {
      // Group by hall
      const halls = [...new Set(seatings.map(s => s.hallNumber).filter(Boolean))].sort();
      if (!halls.length) halls.push('');

      const colX = [45, 110, 190, 265, 405, 475];
      const colW = [65, 80,  75, 140,  70,  80];
      const rowH = 20;
      let y = doc.y;

      _tableHeader(doc, y, rowH, colX, colW,
        ['HALL NO','YEAR/SEC','SECTION','REG RANGE','SEAT NOS','TOTAL'], 9);
      y += rowH;

      // Fetch TC gaps for each seating row
      const deptSeatingWithTC = await Promise.all(seatings.map(async (s) => {
        const secParts = s.section.split('&').map(x=>x.trim());
        const studs = await Student.find({
          year: s.year,
          section: { $in: secParts.map(sp => new RegExp(`^${sp}$`,'i')) }
        }).sort({ registerNumber:1 });
        const batch = studs.filter(st =>
          st.registerNumber >= s.startRegister && st.registerNumber <= s.endRegister
        );
        const tcGaps = findTCGaps(batch);
        return { s, tcGaps };
      }));

      const TC_ROW_H = 16;  // height of TC note row

      deptSeatingWithTC.forEach(({ s, tcGaps }, i) => {
        const totalH = rowH + (tcGaps.length ? TC_ROW_H : 0);
        if (y > 750) { doc.addPage(); y = 50; }
        const bg = i % 2 === 0 ? '#f3f4f6' : '#fff';
        doc.rect(45, y, 510, rowH).fillColor(bg).fill();
        doc.rect(45, y, 510, rowH).strokeColor('#ccc').lineWidth(0.5).stroke();
        doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
        const seatEnd = s.seatStart + s.totalStudents - 1;
        [
          s.hallNumber || '-',
          `${_upper(s.year)} Year`,
          `Sec ${_upper(s.section)}`,
          `${s.startRegister} – ${s.endRegister}`,
          `${s.seatStart} – ${seatEnd}`,
          String(s.totalStudents)
        ].forEach((v, ci) => {
          doc.text(v, colX[ci], y + 5, { width: colW[ci], align: 'center' });
        });
        y += rowH;

        // TC Exception strip below the row
        if (tcGaps.length) {
          doc.rect(45, y, 510, TC_ROW_H).fillColor('#FFF3E0').fill();
          doc.rect(45, y, 510, TC_ROW_H).strokeColor('#160d08').lineWidth(1).stroke();
          doc.fillColor('#0f0604').fontSize(7.5).font('Helvetica-Bold');
          doc.text('EXCEPT: ', 50, y + 4, { continued: true });
          doc.font('Helvetica-Bold').fillColor('#000000');
          doc.text(tcGaps.join('  |  '), { width: 410 });
          y += TC_ROW_H;
        }
      });

      doc.moveDown(2);
      const total = seatings.reduce((a, s) => a + s.totalStudents, 0);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000')
         .text(`Total Students: ${total}`, { align: 'right' });
    }

    _pdfFooter(doc);
    doc.end();
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
};

// ── PDF helper functions ───────────────────────────────────────────────────
function _pdfHeader(doc, mappedYear, seatings) {
  const logoBuf = _getLogoBuffer();
  const startY  = doc.y;
  // Draw logo on left
  if (logoBuf) {
    try {
      doc.image(logoBuf, 50, startY, { width: 60, height: 60 });
    } catch(e) {}
  }
  // College name centered
  const textX = logoBuf ? 120 : 50;
  const textW = logoBuf ? 375 : 495;
  doc.fontSize(15).font('Helvetica-Bold').fillColor('#1a237e')
     .text('PANIMALAR ENGINEERING COLLEGE', textX, startY + 4, { width: textW, align: 'center' });
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
     .text('(Autonomous Institution)', textX, doc.y + 2, { width: textW, align: 'center' });
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
     .text('Department of Artificial Intelligence and Data Science', textX, doc.y + 2, { width: textW, align: 'center' });
  // Move below logo if needed
  const afterText = doc.y + 4;
  const afterLogo = startY + 68;
  doc.y = Math.max(afterText, afterLogo);
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#1a237e').lineWidth(2).stroke();
  doc.moveDown(0.5);
  const examName = seatings.length ? seatings[0].examName : 'Internal Assessment';
  const examDate = seatings.length ? new Date(seatings[0].examDate).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
     .text(`EXAM SEATING ARRANGEMENT${mappedYear ? ' – ' + mappedYear + ' YEAR' : ''}`, { align: 'center' });
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
     .text(`Exam: ${examName}  |  Date: ${examDate}  |  Generated: ${new Date().toLocaleString('en-IN')}`, { align: 'center' });
  doc.moveDown(1);
}

function _tableHeader(doc, y, rowH, colX, colW, labels, fontSize) {
  doc.rect(colX[0], y, colX[colX.length - 1] + colW[colW.length - 1] - colX[0], rowH)
     .fillColor('#1a237e').fill();
  doc.fillColor('#fff').fontSize(fontSize || 8).font('Helvetica-Bold');
  labels.forEach((lbl, i) => {
    doc.text(lbl, colX[i], y + 6, { width: colW[i], align: 'center' });
  });
}

function _pdfFooter(doc) {
  doc.moveDown(3);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
     .text('Examination Controller                                                    Head of Department (HOD)', 50, doc.y);
}


// ── GET /admin/seating/remaining?year=&section= ───────────────────────────────
// Returns how many students remain unallocated for this year/section
const getRemaining = async (req, res) => {
  try {
    const { year, section } = req.query;
    if (!year || !section) return res.json({ success:false, message:'year and section required' });

    const students = await Student.find({
      year, ..._sectionQuery(section)
    }).sort({ registerNumber:1 });

    if (!students.length)
      return res.json({ success:false, message:`No students found for ${year} Year Sec ${section}` });

    // Find last allocated student for this year/section
    const sectionRows = await Seating.find({
      year,
      ..._sectionQuery(section)
    });

    let startIdx = 0;
    if (sectionRows.length) {
      const endIndexes = sectionRows
        .map(r => students.findIndex(s => s.registerNumber === r.endRegister))
        .filter(i => i >= 0);
      startIdx = endIndexes.length ? Math.max(...endIndexes) + 1 : 0;
    }

    const remaining = students.length - startIdx;
    const nextReg   = startIdx < students.length ? students[startIdx].registerNumber : null;
    const allocated = startIdx;

    return res.json({
      success: true,
      total: students.length,
      allocated,
      remaining,
      nextReg
    });
  } catch(err) {
    return res.json({ success:false, message: err.message });
  }
};

module.exports = {
  getDashboard,
  getRemaining,
  getSeatingManage,
  generateSeating,
  addSeatingRow,
  updateSeating,
  deleteSeating,
  clearSeating,
  getPublicSeating,
  getHallSheet,
  getDeptNotice,
  exportPDF,
  exportHallPDF,
  exportDeptNoticePDF
};

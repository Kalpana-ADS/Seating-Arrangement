const Staff                  = require('../models/Staff');
const InvigilatorAllocation  = require('../models/InvigilatorAllocation');
const PDFDocument            = require('pdfkit');
const XLSX                   = require('xlsx');
const path                   = require('path');
const fs                     = require('fs');

// ─── Logo helper ─────────────────────────────────────────────────────────────
const LOGO_PATH = path.join(__dirname, '../../public/images/logo.png');
const getLogoBuf = () => { try { return fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null; } catch(e){ return null; } };

// ─── Load staff from live XLSX ────────────────────────────────────────────────
const loadStaffFromFile = () => {
  const filePath = path.join(__dirname, '../data/WorkLoadStaff.xlsx');
  if (!fs.existsSync(filePath)) return [];
  const wb   = XLSX.readFile(filePath);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const staff = [];
  let headerFound = false;
  for (const row of rows) {
    if (!row || !row.length) continue;
    const cells = row.map(c => (c !== null && c !== undefined ? String(c).trim() : ''));
    if (cells[0] === 'S.No') { headerFound = true; continue; }
    if (!headerFound) continue;
    let   name  = (cells[1] || '').trim();
    const desig = (cells[2] || 'Assistant Professor').trim();
    const subj  = (cells[3] || '').replace(/\n/g,' ').replace(/\s+/g,' ').trim();
    if (!name) continue;
    if (/^NF\s+\d+\s*$/i.test(name)) continue;
    name = name.replace(/^NF\s+\d+\s+/i,'').trim();
    if (name) staff.push({ name, designation: desig, subject: subj, department: 'AI & Data Science' });
  }
  return staff;
};

// ─── GET /admin/invigilator ───────────────────────────────────────────────────
const getPage = async (req, res) => {
  try {
    const liveStaff   = loadStaffFromFile();
    const subjects    = [...new Set(liveStaff.map(s => s.subject).filter(Boolean))].sort();
    const allocations = await InvigilatorAllocation.find().sort({ examDate: -1 }).limit(20);
    res.render('admin/invigilator', {
      title: 'Invigilator Allocation System',
      subjects, liveStaff, allocations,
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/dashboard');
  }
};

// ─── GET /admin/invigilator/eligible?subject=xxx ──────────────────────────────
// Logic:
//   • staff with empty subject  → ALWAYS eligible (lab incharges)
//   • staff whose subject matches the exam subject → EXCLUDED
//   • all others → eligible
// ─── Duty tracking constants ─────────────────────────────────────────────────
const MAX_DUTY_DAYS    = 6;      // max invigilations per exam period
const EXAM_PERIOD_DAYS = 60;     // ignore allocations older than this

// Build duty map: { staffName -> { days: N, dates: [...], lastDate: Date } }
const buildDutyMap = async () => {
  const since = new Date();
  since.setDate(since.getDate() - EXAM_PERIOD_DAYS);
  const allocs = await InvigilatorAllocation.find({ examDate: { $gte: since } });
  const map = {};
  for (const a of allocs) {
    const dateStr = new Date(a.examDate).toLocaleDateString('en-IN');
    for (const row of a.allocations) {
      if (!map[row.staffName]) map[row.staffName] = { days: 0, dates: [] };
      // Count unique exam dates per staff
      if (!map[row.staffName].dates.includes(dateStr)) {
        map[row.staffName].dates.push(dateStr);
        map[row.staffName].days++;
      }
    }
  }
  return map;
};

const getEligible = async (req, res) => {
  try {
    const { subject } = req.query;
    if (!subject) return res.json({ success: false, message: 'Subject required' });
    const all  = loadStaffFromFile();
    const term = subject.trim().toLowerCase();

    // Get real-time duty counts for current exam period
    const dutyMap = await buildDutyMap();

    const excluded = [];
    const eligible = [];

    all.forEach(s => {
      const duty     = dutyMap[s.name] || { days: 0, dates: [] };
      const daysUsed = duty.days;
      const lastDate = duty.dates.length ? duty.dates[duty.dates.length - 1] : null;
      const atLimit  = daysUsed >= MAX_DUTY_DAYS;

      // Empty subject → lab incharge → always eligible (still subject to duty limit)
      if (!s.subject || s.subject.trim() === '') {
        eligible.push({
          ...s,
          daysUsed, lastDate, atLimit,
          availabilityNote: 'Lab Incharge — Always Available'
        });
        return;
      }

      const subLower   = s.subject.toLowerCase();
      const parts      = subLower.split('/').map(x => x.trim());
      const isExcluded = parts.some(p => p.includes(term) || term.includes(p));

      if (isExcluded) {
        excluded.push({ ...s, daysUsed, lastDate });
      } else {
        eligible.push({
          ...s,
          daysUsed, lastDate, atLimit,
          availabilityNote: atLimit ? 'Limit Reached (6/6)' : 'Available'
        });
      }
    });

    return res.json({ success: true, excluded, eligible, maxDutyDays: MAX_DUTY_DAYS });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};


// ─── GET /admin/invigilator/duty-check?name=&examDate= ───────────────────────
// Real-time check: how many days has this staff already been assigned?
const getDutyCheck = async (req, res) => {
  try {
    const { name, examDate } = req.query;
    if (!name) return res.json({ success: false, message: 'Name required' });
    const dutyMap  = await buildDutyMap();
    const duty     = dutyMap[name] || { days: 0, dates: [] };
    const daysUsed = duty.days;
    const atLimit  = daysUsed >= MAX_DUTY_DAYS;
    // Check if already assigned on the requested date
    let assignedToday = false;
    if (examDate) {
      const reqDateStr = new Date(examDate).toLocaleDateString('en-IN');
      assignedToday = duty.dates.includes(reqDateStr);
    }
    return res.json({
      success: true, name, daysUsed,
      maxDays: MAX_DUTY_DAYS,
      remaining: Math.max(0, MAX_DUTY_DAYS - daysUsed),
      atLimit, assignedToday,
      dates: duty.dates
    });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

// ─── GET /admin/invigilator/subjects ─────────────────────────────────────────
const getSubjects = async (req, res) => {
  const all      = loadStaffFromFile();
  const subjects = [...new Set(all.map(s => s.subject).filter(Boolean))].sort();
  return res.json({ success: true, subjects });
};

// ─── POST /admin/invigilator/save ─────────────────────────────────────────────
const saveAllocation = async (req, res) => {
  try {
    const { examName, subjectName, examDate, session, allocations } = req.body;
    if (!examName || !subjectName || !examDate || !session)
      return res.json({ success: false, message: 'All header fields are required.' });
    if (!allocations || !allocations.length)
      return res.json({ success: false, message: 'Add at least one invigilator.' });
    const doc = await InvigilatorAllocation.create({
      examName, subjectName, examDate: new Date(examDate), session, allocations
    });
    return res.json({ success: true, message: 'Allocation saved.', id: doc._id });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

// ─── POST /admin/invigilator/update/:id ──────────────────────────────────────
const updateAllocation = async (req, res) => {
  try {
    const { examName, subjectName, examDate, session, allocations } = req.body;
    const doc = await InvigilatorAllocation.findByIdAndUpdate(
      req.params.id,
      { examName, subjectName, examDate: new Date(examDate), session, allocations: allocations || [] },
      { new: true }
    );
    if (!doc) return res.json({ success: false, message: 'Record not found.' });
    return res.json({ success: true, message: 'Updated successfully.', doc });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

// ─── POST /admin/invigilator/delete/:id ──────────────────────────────────────
const deleteAllocation = async (req, res) => {
  try {
    await InvigilatorAllocation.findByIdAndDelete(req.params.id);
    req.flash('success', 'Allocation deleted.');
    res.redirect('/admin/invigilator');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/invigilator');
  }
};

// ─── GET /admin/invigilator/view/:id ─────────────────────────────────────────
const viewAllocation = async (req, res) => {
  try {
    const doc = await InvigilatorAllocation.findById(req.params.id);
    if (!doc) { req.flash('error', 'Not found.'); return res.redirect('/admin/invigilator'); }
    res.render('admin/invigilator_view', {
      title: `Allocation — ${doc.examName}`,
      doc,
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/invigilator');
  }
};

// ─── GET /admin/invigilator/download/:id  → PDF ───────────────────────────────
const downloadPDF = async (req, res) => {
  try {
    const doc = await InvigilatorAllocation.findById(req.params.id);
    if (!doc) return res.status(404).send('Not found');

    const pdf      = new PDFDocument({ margin: 50, size: 'A4' });
    const dateStr  = new Date(doc.examDate).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
    const filename = `Invigilator_${doc.examName.replace(/\s+/g,'_')}_${doc.session}.pdf`;

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    pdf.pipe(res);

    // ── Header with logo ──────────────────────────────────────────────────────
    const logoBuf = getLogoBuf();
    const startY  = pdf.y;
    if (logoBuf) {
      try { pdf.image(logoBuf, 50, startY, { width:60, height:60 }); } catch(e){}
    }
    const tw = 500;
    const tx = (pdf.page.width - tw) / 2;
    pdf.fontSize(15).font('Helvetica-Bold').fillColor('#0D1B4B')
       .text('PANIMALAR ENGINEERING COLLEGE', tx, startY+4, { width:tw, align:'center' });
    pdf.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
       .text('(Autonomous Institution)', tx, pdf.y+2, { width:tw, align:'center' });
    pdf.text('Department of Artificial Intelligence and Data Science', tx, pdf.y+2, { width:tw, align:'center' });
    pdf.y = Math.max(pdf.y+4, startY+68);
    pdf.moveDown(0.3);
    pdf.moveTo(50,pdf.y).lineTo(545,pdf.y).strokeColor('#0D1B4B').lineWidth(2).stroke();
    pdf.moveDown(0.5);

    pdf.fontSize(13).font('Helvetica-Bold').fillColor('#000000')
       .text('INVIGILATOR ALLOCATION SHEET', { align:'center' });
    pdf.moveDown(0.3);
    pdf.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
       .text(`Exam: ${doc.examName}   |   Subject: ${doc.subjectName}   |   Date: ${dateStr}   |   Session: ${doc.session} (${doc.session==='FN'?'8:15 AM – 11:15 AM':'12:15 PM – 3:15 PM'})`,
         { align:'center' });
    pdf.moveDown(1);

    if (!doc.allocations.length) {
      pdf.text('No invigilators allocated.', { align:'center' });
    } else {
      // ── Table ───────────────────────────────────────────────────────────────
      const colX = [50, 185, 310, 375, 450, 495];
      const colW = [135, 125, 65,  75,  45,  100];
      const rowH = 22;
      let   y    = pdf.y;

      // Header row
      pdf.rect(50, y, 495, rowH).fillColor('#1A2F7A').fill();
      pdf.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
      ['STAFF NAME','DESIGNATION','HALL NO','EXAM NAME','SESSION','SIGNATURE'].forEach((h,i) => {
        pdf.text(h, colX[i], y+7, { width:colW[i], align:'center' });
      });
      y += rowH;

      doc.allocations.forEach((a, i) => {
        if (y > 750) { pdf.addPage(); y = 50; }
        const bg = i % 2 === 0 ? '#F3F4F6' : '#FFFFFF';
        pdf.rect(50, y, 495, rowH).fillColor(bg).fill();
        pdf.rect(50, y, 495, rowH).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
        pdf.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
        const vals = [
          a.staffName, a.designation||'', a.hallNumber||'—',
          doc.examName, a.session||doc.session, ''
        ];
        vals.forEach((v,i2) => {
          pdf.text(v, colX[i2], y+7, { width:colW[i2], align:'center', ellipsis:true });
        });
        y += rowH;
      });

      // Total row
      pdf.rect(50, y, 495, rowH).fillColor('#0D1B4B').fill();
      pdf.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
      pdf.text(`Total Invigilators: ${doc.allocations.length}`, 50, y+7, { width:395, align:'right' });
      y += rowH + 30;

      // Signature line
      pdf.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
      pdf.text('Examination Controller: _________________________', 50, y);
      pdf.text('Head of Department (HOD): _________________________', 320, y);
    }

    // Footer
    pdf.moveDown(3);
    pdf.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
       .text(`Generated: ${new Date().toLocaleString('en-IN')}   |   Panimalar Engineering College — Examination Cell`,
         { align:'center' });

    pdf.end();
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).send('Error generating PDF: ' + err.message);
  }
};

module.exports = {
  getPage, getEligible, getSubjects, getDutyCheck,
  saveAllocation, updateAllocation, deleteAllocation,
  viewAllocation, downloadPDF
};

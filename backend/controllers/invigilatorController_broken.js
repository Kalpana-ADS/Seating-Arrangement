/**
 * Enhanced Invigilator Allocation Controller
 * Smart allocation with designation-based duty days
 * - Professor: 3 days/month
 * - ASSO.PROF: 4 days/month
 * - ASST.PROF G1: 5 days/month
 * - ASST.PROF LI: 6 days/month
 */

const Staff = require('../models/Staff');
const InvigilatorAllocation = require('../models/InvigilatorAllocation');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// ─── Designation-based duty days mapping ──────────────────────────────────────
const DUTY_DAYS_MAP = {
  'Professor': 3,
  'Associate Professor': 4,
  'Assistant Professor G1': 5,
  'Assistant Professor LI': 6,
  'Assistant Professor': 5
};

// ─── Logo helper ──────────────────────────────────────────────────────────────
const LOGO_PATH = path.join(__dirname, '../../public/images/logo.png');
const getLogoBuf = () => {
  try {
    return fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;
  } catch (e) {
    return null;
  }
};

/**
 * Get duty days limit for a staff member based on their designation
 */
const getDutyDaysLimit = (designation) => {
  return DUTY_DAYS_MAP[designation] || 5;
};

/**
 * Build duty map for current exam batch
 * Tracks how many days each staff has been allocated in the current month
 */
const buildDutyMapForBatch = async (batchId = null) => {
  const query = batchId ? { batchId } : {};
  const allocs = await InvigilatorAllocation.find(query);
  const map = {};

  for (const alloc of allocs) {
    const dateStr = new Date(alloc.examDate).toLocaleDateString('en-IN');
    for (const row of alloc.allocations) {
      if (!map[row.staffName]) {
        map[row.staffName] = {
          days: 0,
          dates: [],
          designation: row.designation || 'Assistant Professor',
          dutyLimit: 0
        };
      }
      // Count unique exam dates
      if (!map[row.staffName].dates.includes(dateStr)) {
        map[row.staffName].dates.push(dateStr);
        map[row.staffName].days++;
      }
      // Set duty limit based on designation
      map[row.staffName].dutyLimit = getDutyDaysLimit(row.designation);
    }
  }

  return map;
};

/**
 * GET /admin/invigilator
 * Main page showing allocation interface
 */
const getPage = async (req, res) => {
  try {
    const allStaff = await Staff.find().sort({ designation: 1, name: 1 });
    const subjects = [...new Set(allStaff.map(s => s.subject).filter(Boolean))].sort();
    const allocations = await InvigilatorAllocation.find()
      .sort({ examDate: -1 })
      .limit(20);

    res.render('admin/invigilator', {
      title: 'Invigilator Allocation System',
      subjects,
      staff: allStaff,
      allocations,
      dutyDaysMap: DUTY_DAYS_MAP,
      adminName: req.session.adminName,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/dashboard');
  }
};

/**
 * GET /admin/invigilator/eligible?subject=xxx&batchId=yyy
 * Get eligible staff for an exam, excluding those who teach that subject
 * Respects duty day limits per designation
 */
const getEligible = async (req, res) => {
  try {
    const { subject, batchId } = req.query;
    if (!subject) {
      return res.json({ success: false, message: 'Subject required' });
    }

    const allStaff = await Staff.find().sort({ name: 1 });
    const dutyMap = await buildDutyMapForBatch(batchId);
    const term = subject.trim().toLowerCase();

    const excluded = [];
    const eligible = [];

    allStaff.forEach(staff => {
      const dutyLimit = getDutyDaysLimit(staff.designation);
      const dutyInfo = dutyMap[staff.name] || {
        days: 0,
        dates: [],
        dutyLimit: dutyLimit
      };
      const daysUsed = dutyInfo.days;
      const isAtLimit = daysUsed >= dutyLimit;

      // Check if staff teaches this subject
      const staffSubject = (staff.subject || '').toLowerCase();
      const subjectParts = staffSubject.split(',').map(x => x.trim());
      const teachesSubject = subjectParts.some(
        part => part.includes(term) || term.includes(part)
      );

      // Lab incharges (empty subject) are always eligible
      if (!staff.subject || staff.subject.trim() === '') {
        eligible.push({
          sNo: allStaff.indexOf(staff) + 1,
          name: staff.name,
          designation: staff.designation,
          subject: staff.subject || 'Lab Incharge',
          daysUsed,
          dutyLimit,
          isAtLimit,
          isLabIncharge: true,
          reason: isAtLimit ? `Reached duty limit (${daysUsed}/${dutyLimit})` : 'Available'
        });
        return;
      }

      if (teachesSubject) {
        // Cannot invigilate own subject
        excluded.push({
          sNo: allStaff.indexOf(staff) + 1,
          name: staff.name,
          designation: staff.designation,
          subject: staff.subject,
          daysUsed,
          dutyLimit,
          reason: 'Cannot invigilate own subject'
        });
      } else {
        // Eligible but may be at limit
        eligible.push({
          sNo: allStaff.indexOf(staff) + 1,
          name: staff.name,
          designation: staff.designation,
          subject: staff.subject,
          daysUsed,
          dutyLimit,
          isAtLimit,
          isLabIncharge: false,
          reason: isAtLimit
            ? `Reached duty limit (${daysUsed}/${dutyLimit})`
            : `Available (${dutyLimit - daysUsed} days left)`
        });
      }
    });

    // Separate eligible into available and at-limit
    const available = eligible.filter(e => !e.isAtLimit);
    const atLimit = eligible.filter(e => e.isAtLimit);

    return res.json({
      success: true,
      excluded,
      available,
      atLimit,
      dutyDaysMap: DUTY_DAYS_MAP
    });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

/**
 * GET /admin/invigilator/duty-check?name=&designation=&batchId=
 * Real-time duty check for a specific staff member
 */
const getDutyCheck = async (req, res) => {
  try {
    const { name, designation, batchId } = req.query;
    if (!name) {
      return res.json({ success: false, message: 'Name required' });
    }

    const dutyLimit = getDutyDaysLimit(designation || 'Assistant Professor');
    const dutyMap = await buildDutyMapForBatch(batchId);
    const dutyInfo = dutyMap[name] || { days: 0, dates: [] };

    const daysUsed = dutyInfo.days;
    const isAtLimit = daysUsed >= dutyLimit;
    const remaining = Math.max(0, dutyLimit - daysUsed);

    return res.json({
      success: true,
      name,
      designation,
      dutyLimit,
      daysUsed,
      remaining,
      isAtLimit,
      dates: dutyInfo.dates,
      status: isAtLimit
        ? `BLOCKED - Completed all ${dutyLimit} duty days`
        : `${daysUsed}/${dutyLimit} days used (${remaining} remaining)`
    });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

/**
 * GET /admin/invigilator/subjects
 * Get all subjects
 */
const getSubjects = async (req, res) => {
  try {
    const allStaff = await Staff.find();
    const subjects = [...new Set(
      allStaff
        .map(s => s.subject)
        .filter(Boolean)
        .flatMap(s => s.split(',').map(x => x.trim()))
    )].sort();

    return res.json({ success: true, subjects });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/invigilator/save
 * Save new allocation
 */
const saveAllocation = async (req, res) => {
  try {
    const { examName, subjectName, examDate, session, allocations, batchId } = req.body;

    if (!examName || !subjectName || !examDate || !session) {
      return res.json({
        success: false,
        message: 'Exam Name, Subject, Date, and Session are required.'
      });
    }

    if (!allocations || !allocations.length) {
      return res.json({
        success: false,
        message: 'Add at least one invigilator.'
      });
    }

    // Validate allocations don't exceed duty limits
    const dutyMap = await buildDutyMapForBatch(batchId);
    for (const alloc of allocations) {
      const dutyLimit = getDutyDaysLimit(alloc.designation);
      const dutyInfo = dutyMap[alloc.staffName];
      const daysUsed = dutyInfo ? dutyInfo.days : 0;

      if (daysUsed >= dutyLimit) {
        return res.json({
          success: false,
          message: `${alloc.staffName} (${alloc.designation}) has already completed their ${dutyLimit} duty days.`
        });
      }
    }

    const doc = await InvigilatorAllocation.create({
      examName,
      subjectName,
      examDate: new Date(examDate),
      session,
      allocations,
      batchId: batchId || new Date(examDate).toISOString().slice(0, 7)
    });

    return res.json({
      success: true,
      message: 'Allocation saved successfully.',
      id: doc._id
    });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/invigilator/update/:id
 * Update existing allocation
 */
const updateAllocation = async (req, res) => {
  try {
    const { examName, subjectName, examDate, session, allocations, batchId } = req.body;
    const oldDoc = await InvigilatorAllocation.findById(req.params.id);

    if (!oldDoc) {
      return res.json({ success: false, message: 'Record not found.' });
    }

    // Validate new allocations
    const dutyMap = await buildDutyMapForBatch(batchId);

    // Remove old allocations from duty count
    for (const oldAlloc of oldDoc.allocations) {
      const dateStr = new Date(oldDoc.examDate).toLocaleDateString('en-IN');
      if (dutyMap[oldAlloc.staffName]) {
        const idx = dutyMap[oldAlloc.staffName].dates.indexOf(dateStr);
        if (idx > -1) {
          dutyMap[oldAlloc.staffName].dates.splice(idx, 1);
          dutyMap[oldAlloc.staffName].days--;
        }
      }
    }

    // Validate new allocations against updated duty map
    for (const alloc of allocations || []) {
      const dutyLimit = getDutyDaysLimit(alloc.designation);
      const dutyInfo = dutyMap[alloc.staffName];
      const daysUsed = dutyInfo ? dutyInfo.days : 0;

      if (daysUsed >= dutyLimit) {
        return res.json({
          success: false,
          message: `${alloc.staffName} (${alloc.designation}) cannot be assigned (duty limit: ${dutyLimit}/${dutyLimit}).`
        });
      }
    }

    const doc = await InvigilatorAllocation.findByIdAndUpdate(
      req.params.id,
      {
        examName,
        subjectName,
        examDate: new Date(examDate),
        session,
        allocations: allocations || [],
        batchId: batchId || new Date(examDate).toISOString().slice(0, 7)
      },
      { new: true }
    );

    return res.json({
      success: true,
      message: 'Allocation updated successfully.',
      doc
    });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/invigilator/delete/:id
 * Delete allocation
 */
const deleteAllocation = async (req, res) => {
  try {
    await InvigilatorAllocation.findByIdAndDelete(req.params.id);
    req.flash('success', 'Allocation deleted successfully.');
    res.redirect('/admin/invigilator');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/invigilator');
  }
};

/**
 * GET /admin/invigilator/view/:id
 * View allocation details
 */
const viewAllocation = async (req, res) => {
  try {
    const doc = await InvigilatorAllocation.findById(req.params.id);
    if (!doc) {
      req.flash('error', 'Allocation not found.');
      return res.redirect('/admin/invigilator');
    }

    res.render('admin/invigilator_view', {
      title: `${doc.examName} — ${doc.subjectName}`,
      doc,
      dutyDaysMap: DUTY_DAYS_MAP,
      adminName: req.session.adminName,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/invigilator');
  }
};

/**
 * GET /admin/invigilator/download/:id
 * Download allocation as PDF
 * Columns: S.No, Faculty Name, Role, Subject, Date, Session, Exam Name
 */
const downloadPDF = async (req, res) => {
  try {
    const doc = await InvigilatorAllocation.findById(req.params.id);
    if (!doc) return res.status(404).send('Allocation not found');

    const pdf = new PDFDocument({ margin: 40, size: 'A4' });
    const dateStr = new Date(doc.examDate).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    const filename = `Invigilator_List_${doc.examName.replace(/\s+/g, '_')}_${doc.session}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdf.pipe(res);

    // ─── HEADER ─────────────────────────────────────────────────────────────
    const logoBuf = getLogoBuf();
    const headerY = pdf.y;

    if (logoBuf) {
      try {
        pdf.image(logoBuf, 40, headerY, { width: 50, height: 50 });
      } catch (e) {}
    }

    const headerWidth = 500;
    const headerX = (pdf.page.width - headerWidth) / 2;
    const textY = headerY + 5;

    pdf.fontSize(14).font('Helvetica-Bold').fillColor('#0D1B4B')
      .text('PANIMALAR ENGINEERING COLLEGE', headerX, textY, { width: headerWidth, align: 'center' });
    pdf.fontSize(9).font('Helvetica').fillColor('#000000')
      .text('(Autonomous Institution)', headerX, pdf.y + 1, { width: headerWidth, align: 'center' });
    pdf.text('Department of Artificial Intelligence and Data Science', headerX, pdf.y, { width: headerWidth, align: 'center' });
    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#1A2F7A')
      .text('EXAMINATION CELL', headerX, pdf.y + 3, { width: headerWidth, align: 'center' });

    pdf.y = Math.max(pdf.y + 5, headerY + 55);
    pdf.moveTo(40, pdf.y).lineTo(560, pdf.y).strokeColor('#0D1B4B').lineWidth(1.5).stroke();
    pdf.moveDown(0.4);

    // ─── TITLE ──────────────────────────────────────────────────────────────
    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
      .text('INVIGILATOR ALLOCATION REPORT', { align: 'center' });
    pdf.moveDown(0.3);

    pdf.fontSize(9).font('Helvetica-Bold').fillColor('#1A2F7A');
    pdf.text(`EXAM: ${doc.examName}  |  SUBJECT: ${doc.subjectName}  |  DATE: ${dateStr}  |  SESSION: ${doc.session} (${doc.session === 'FN' ? '8:15 AM – 11:15 AM' : '12:15 PM – 3:15 PM'})`,
      { align: 'center' });
    pdf.moveDown(0.8);

    if (!doc.allocations || !doc.allocations.length) {
      pdf.fontSize(10).font('Helvetica').fillColor('#000000')
        .text('No invigilators allocated.', { align: 'center' });
    } else {
      // ─── TABLE HEADER ───────────────────────────────────────────────────
      const colX = [40, 75, 170, 270, 360, 450, 530];
      const colW = [35, 95, 100, 90, 90, 80, 40];
      const rowH = 20;
      const headerBg = '#1A2F7A';
      const headerFg = '#FFFFFF';

      let y = pdf.y;

      // Header row
      pdf.rect(40, y, 520, rowH).fillColor(headerBg).fill();
      pdf.fillColor(headerFg).fontSize(8).font('Helvetica-Bold');

      const headers = ['S.No', 'FACULTY NAME', 'DESIGNATION', 'SUBJECT', 'EXAM DATE', 'SESSION', 'EXAM'];
      headers.forEach((h, i) => {
        pdf.text(h, colX[i], y + 6, { width: colW[i], align: 'center', fontSize: 7 });
      });

      y += rowH;

      // Data rows
      doc.allocations.forEach((a, idx) => {
        if (y > 720) {
          pdf.addPage();
          y = 50;
          // Repeat header on new page
          pdf.rect(40, y, 520, rowH).fillColor(headerBg).fill();
          pdf.fillColor(headerFg).fontSize(8).font('Helvetica-Bold');
          headers.forEach((h, i) => {
            pdf.text(h, colX[i], y + 6, { width: colW[i], align: 'center', fontSize: 7 });
          });
          y += rowH;
        }

        const rowBg = idx % 2 === 0 ? '#F9FAFB' : '#FFFFFF';
        pdf.rect(40, y, 520, rowH).fillColor(rowBg).fill();
        pdf.rect(40, y, 520, rowH).strokeColor('#D1D5DB').lineWidth(0.5).stroke();

        pdf.fillColor('#000000').fontSize(8).font('Helvetica');
        const rowData = [
          String(idx + 1),
          a.staffName || '—',
          a.designation || '—',
          a.subject || '—',
          dateStr,
          a.session || doc.session || '—',
          doc.examName
        ];

        rowData.forEach((data, i) => {
          const alignment = i === 0 ? 'center' : (i <= 2 ? 'left' : 'center');
          const x = colX[i];
          const w = colW[i];
          pdf.fontSize(7).text(data, x, y + 7, {
            width: w,
            align: alignment,
            ellipsis: true
          });
        });

        y += rowH;
      });

      // ─── TOTAL ROW ──────────────────────────────────────────────────────
      pdf.rect(40, y, 520, rowH).fillColor('#E5E7EB').fill();
      pdf.rect(40, y, 520, rowH).strokeColor('#000000').lineWidth(1).stroke();
      pdf.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      pdf.text(`TOTAL INVIGILATORS: ${doc.allocations.length}`, 50, y + 6, { width: 500 });

      y += rowH + 30;

      // ─── SUMMARY BY DESIGNATION ────────────────────────────────────────
      pdf.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
        .text('ALLOCATION SUMMARY BY DESIGNATION:', 40, y);
      y += 18;

      const byDesig = {};
      doc.allocations.forEach(a => {
        const d = a.designation || 'Unknown';
        byDesig[d] = (byDesig[d] || 0) + 1;
      });

      pdf.fontSize(8).font('Helvetica').fillColor('#000000');
      const sortedDesigs = Object.entries(byDesig).sort((a, b) => {
        const order = ['Professor', 'Associate Professor', 'Assistant Professor G1', 'Assistant Professor LI', 'Assistant Professor'];
        return order.indexOf(a[0]) - order.indexOf(b[0]);
      });

      sortedDesigs.forEach(([desig, count]) => {
        const dutyLimit = getDutyDaysLimit(desig);
        pdf.text(`  • ${desig}: ${count} staff (Max duty: ${dutyLimit} days/month)`, 50, y);
        y += 14;
      });

      y += 10;

      // ─── SIGNATURE AREA ─────────────────────────────────────────────────
      pdf.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
      pdf.text('Examination Controller: ________________________  Date: ____________', 40, y);
      pdf.text('Head of Department: ________________________  Date: ____________', 40, y + 25);
    }

    // ─── FOOTER ──────────────────────────────────────────────────────────
    pdf.fontSize(7).font('Helvetica').fillColor('#666666')
      .text(
        `Generated: ${new Date().toLocaleString('en-IN')} | Panimalar Engineering College, AI & Data Science Dept. | Assessment 1`,
        { align: 'center', pageBreak: false }
      );

    pdf.end();
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).send('Error generating PDF: ' + err.message);
  }
};

/**
 * GET /admin/invigilator/export/batch?batchId=yyyy-mm
 * Export complete batch allocation as Excel
 */
const exportBatchExcel = async (req, res) => {
  try {
    const { batchId } = req.query;
    if (!batchId) {
      return res.json({ success: false, message: 'Batch ID required' });
    }

    const allocations = await InvigilatorAllocation.find({ batchId }).sort({ examDate: 1 });

    if (!allocations.length) {
      return res.json({ success: false, message: 'No allocations found for this batch' });
    }

    const rows = [];
    rows.push(['EXAM BATCH ALLOCATION REPORT', '', '', '', '']);
    rows.push(['Batch ID', batchId, '', '', '']);
    rows.push(['Generated', new Date().toLocaleString('en-IN'), '', '', '']);
    rows.push(['', '', '', '', '']);
    rows.push(['S.No', 'Faculty Name', 'Designation', 'Exam Name', 'Subject']);

    let sNo = 1;
    const allocatedStaff = new Set();

    allocations.forEach(alloc => {
      alloc.allocations.forEach(a => {
        rows.push([
          sNo++,
          a.staffName,
          a.designation,
          alloc.examName,
          alloc.subjectName
        ]);
        allocatedStaff.add(a.staffName);
      });
    });

    const XLSX = require('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Allocations');

    const filename = `Batch_Allocation_${batchId}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    XLSX.write(wb, { type: 'stream', stream: res });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

module.exports = {
  getPage,
  getEligible,
  getSubjects,
  getDutyCheck,
  saveAllocation,
  updateAllocation,
  deleteAllocation,
  viewAllocation,
  downloadPDF,
  exportBatchExcel,
  DUTY_DAYS_MAP,
  getDutyDaysLimit
};

/**
 * SIMPLIFIED Invigilator Allocation Controller
 * Focus: Duty days tracking & smart blocking
 * NO subject exclusion - just allocate 50 random staff
 * 
 * Duty Day Limits:
 * - Professor: 3 days/month
 * - Associate Professor: 4 days/month
 * - Assistant Professor G1: 5 days/month
 * - Assistant Professor LI: 6 days/month
 * - Assistant Professor: 5 days/month
 */

const Staff = require('../models/Staff');
const InvigilatorAllocation = require('../models/InvigilatorAllocation');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// Duty days mapping
const DUTY_DAYS_MAP = {
  'Professor': 3,
  'Associate Professor': 4,
  'Assistant Professor G1': 5,
  'Assistant Professor LI': 6,
  'Assistant Professor': 5
};

const LOGO_PATH = path.join(__dirname, '../../public/images/logo.png');
const getLogoBuf = () => {
  try {
    return fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;
  } catch (e) {
    return null;
  }
};

const getDutyDaysLimit = (designation) => {
  return DUTY_DAYS_MAP[designation] || 5;
};

/**
 * Build duty map - tracks duty days used per staff per batch
 */
const buildDutyMapForBatch = async (batchId = null) => {
  try {
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
            dutyLimit: getDutyDaysLimit(row.designation || 'Assistant Professor')
          };
        }
        if (!map[row.staffName].dates.includes(dateStr)) {
          map[row.staffName].dates.push(dateStr);
          map[row.staffName].days++;
        }
      }
    }

    return map;
  } catch (err) {
    console.error('Error building duty map:', err);
    return {};
  }
};

/**
 * GET /admin/invigilator - Main page
 */
const getPage = async (req, res) => {
  try {
    const allStaff = await Staff.find().sort({ designation: 1, name: 1 });
    const allocations = await InvigilatorAllocation.find()
      .sort({ examDate: -1 })
      .limit(20);

    res.render('admin/invigilator', {
      title: 'Invigilator Allocation System',
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
 * GET /admin/invigilator/eligible?batchId=yyyy-mm
 * Get 50 random available staff based ONLY on duty days
 * No subject exclusion - just duty day limits
 */
const getEligible = async (req, res) => {
  try {
    const { batchId } = req.query;

    const allStaff = await Staff.find().sort({ name: 1 });
    const dutyMap = await buildDutyMapForBatch(batchId);

    const available = [];
    const atLimit = [];

    for (const staff of allStaff) {
      const dutyLimit = getDutyDaysLimit(staff.designation);
      const dutyInfo = dutyMap[staff.name] || {
        days: 0,
        dates: [],
        dutyLimit: dutyLimit
      };

      const daysUsed = dutyInfo.days || 0;
      const daysRemaining = dutyLimit - daysUsed;
      const isAtLimit = daysUsed >= dutyLimit;

      const staffObj = {
        name: staff.name,
        designation: staff.designation,
        subject: staff.subject || 'General',
        daysUsed: daysUsed,
        dutyLimit: dutyLimit,
        daysRemaining: daysRemaining,
        isAtLimit: isAtLimit
      };

      if (isAtLimit) {
        atLimit.push(staffObj);
      } else {
        available.push(staffObj);
      }
    }

    // Shuffle and take top 50 from available
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    const recommended = shuffle([...available]).slice(0, 50);

    return res.json({
      success: true,
      available: available.length,
      atLimit: atLimit.length,
      recommended: recommended,
      dutyDaysMap: DUTY_DAYS_MAP
    });
  } catch (err) {
    console.error('getEligible error:', err);
    return res.json({
      success: false,
      message: err.message,
      recommended: []
    });
  }
};

/**
 * GET /admin/invigilator/duty-check?name=xxx&batchId=yyy
 */
const getDutyCheck = async (req, res) => {
  try {
    const { name, batchId } = req.query;

    if (!name) {
      return res.json({ success: false, message: 'Name required' });
    }

    const staff = await Staff.findOne({ name: { $regex: name, $options: 'i' } });
    if (!staff) {
      return res.json({ success: false, message: 'Staff not found' });
    }

    const dutyLimit = getDutyDaysLimit(staff.designation);
    const dutyMap = await buildDutyMapForBatch(batchId);
    const dutyInfo = dutyMap[staff.name] || { days: 0, dates: [] };

    const daysUsed = dutyInfo.days || 0;
    const isAtLimit = daysUsed >= dutyLimit;

    return res.json({
      success: true,
      name: staff.name,
      designation: staff.designation,
      subject: staff.subject || 'General',
      dutyLimit: dutyLimit,
      daysUsed: daysUsed,
      daysRemaining: Math.max(0, dutyLimit - daysUsed),
      isAtLimit: isAtLimit,
      dates: dutyInfo.dates,
      status: isAtLimit
        ? `BLOCKED - Completed all ${dutyLimit} duty days`
        : `${daysUsed}/${dutyLimit} days (${dutyLimit - daysUsed} remaining)`
    });
  } catch (err) {
    console.error('getDutyCheck error:', err);
    return res.json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/invigilator/save
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

    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res.json({
        success: false,
        message: 'Add at least one invigilator.'
      });
    }

    // Validate duty limits
    const dutyMap = await buildDutyMapForBatch(batchId);
    for (const alloc of allocations) {
      const dutyLimit = getDutyDaysLimit(alloc.designation);
      const dutyInfo = dutyMap[alloc.staffName];
      const daysUsed = dutyInfo ? (dutyInfo.days || 0) : 0;

      if (daysUsed >= dutyLimit) {
        return res.json({
          success: false,
          message: `${alloc.staffName} (${alloc.designation}) has reached their ${dutyLimit} duty days limit.`
        });
      }
    }

    const doc = await InvigilatorAllocation.create({
      examName,
      subjectName,
      examDate: new Date(examDate),
      session,
      allocations,
      batchId: batchId || new Date(examDate).toISOString().slice(0, 7),
      assessment: 1
    });

    return res.json({
      success: true,
      message: 'Allocation saved successfully.',
      id: doc._id
    });
  } catch (err) {
    console.error('saveAllocation error:', err);
    return res.json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/invigilator/update/:id
 */
const updateAllocation = async (req, res) => {
  try {
    const { examName, subjectName, examDate, session, allocations, batchId } = req.body;
    const oldDoc = await InvigilatorAllocation.findById(req.params.id);

    if (!oldDoc) {
      return res.json({ success: false, message: 'Allocation not found.' });
    }

    // Recalculate duty map (remove old, add new)
    const dutyMap = await buildDutyMapForBatch(batchId);

    // Remove old allocations from count
    const oldDateStr = new Date(oldDoc.examDate).toLocaleDateString('en-IN');
    for (const oldAlloc of oldDoc.allocations) {
      if (dutyMap[oldAlloc.staffName]) {
        const idx = dutyMap[oldAlloc.staffName].dates.indexOf(oldDateStr);
        if (idx > -1) {
          dutyMap[oldAlloc.staffName].dates.splice(idx, 1);
          dutyMap[oldAlloc.staffName].days = Math.max(0, dutyMap[oldAlloc.staffName].days - 1);
        }
      }
    }

    // Validate new allocations
    for (const alloc of allocations || []) {
      const dutyLimit = getDutyDaysLimit(alloc.designation);
      const dutyInfo = dutyMap[alloc.staffName];
      const daysUsed = dutyInfo ? (dutyInfo.days || 0) : 0;

      if (daysUsed >= dutyLimit) {
        return res.json({
          success: false,
          message: `${alloc.staffName} cannot be assigned (duty limit: ${dutyLimit}/${dutyLimit}).`
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
    console.error('updateAllocation error:', err);
    return res.json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/invigilator/delete/:id
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
    const filename = `Invigilator_${doc.examName.replace(/\s+/g, '_')}_${doc.session}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdf.pipe(res);

    // Header
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

    pdf.y = Math.max(pdf.y + 5, headerY + 55);
    pdf.moveTo(40, pdf.y).lineTo(560, pdf.y).strokeColor('#0D1B4B').lineWidth(1.5).stroke();
    pdf.moveDown(0.4);

    // Title
    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
      .text('INVIGILATOR ALLOCATION REPORT', { align: 'center' });
    pdf.moveDown(0.3);

    pdf.fontSize(9).font('Helvetica-Bold').fillColor('#1A2F7A');
    pdf.text(`EXAM: ${doc.examName}  |  SUBJECT: ${doc.subjectName}  |  DATE: ${dateStr}  |  SESSION: ${doc.session}`,
      { align: 'center' });
    pdf.moveDown(0.8);

    if (!doc.allocations || !Array.isArray(doc.allocations) || doc.allocations.length === 0) {
      pdf.fontSize(10).font('Helvetica').fillColor('#000000')
        .text('No invigilators allocated.', { align: 'center' });
    } else {
      // Table
      const colX = [40, 90, 220, 350, 470];
      const colW = [40, 130, 120, 110, 90];
      const rowH = 20;

      let y = pdf.y;

      // Header row
      pdf.rect(40, y, 520, rowH).fillColor('#1A2F7A').fill();
      pdf.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');

      const headers = ['S.No', 'FACULTY NAME', 'DESIGNATION', 'Hall.No', 'EXAM'];
      headers.forEach((h, i) => {
        pdf.text(h, colX[i], y + 6, { width: colW[i], align: 'center', fontSize: 7 });
      });

      y += rowH;

      // Data rows
      doc.allocations.forEach((a, idx) => {
        if (y > 720) {
          pdf.addPage();
          y = 50;
        }

        const rowBg = idx % 2 === 0 ? '#F9FAFB' : '#FFFFFF';
        pdf.rect(40, y, 520, rowH).fillColor(rowBg).fill();
        pdf.rect(40, y, 520, rowH).strokeColor('#D1D5DB').lineWidth(0.5).stroke();

        pdf.fillColor('#000000').fontSize(7).font('Helvetica');
        const rowData = [
          String(idx + 1),
          a.staffName || '—',
          a.designation || '—',
          a.hallNumber || '—',
          doc.examName
        ];

        rowData.forEach((data, i) => {
          pdf.text(data, colX[i], y + 7, {
            width: colW[i],
            align: 'center',
            ellipsis: true
          });
        });

        y += rowH;
      });

      // Total row
      pdf.rect(40, y, 520, rowH).fillColor('#E5E7EB').fill();
      pdf.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      pdf.text(`TOTAL INVIGILATORS: ${doc.allocations.length}`, 50, y + 6);
    }

    pdf.end();
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).send('Error generating PDF: ' + err.message);
  }
};

/**
 * POST /admin/invigilator/clear-all
 * Clear all allocations for a batch (with confirmation)
 */
const clearAllAllocations = async (req, res) => {
  try {
    const { batchId } = req.body;

    if (!batchId) {
      return res.json({ success: false, message: 'Batch ID required' });
    }

    const result = await InvigilatorAllocation.deleteMany({ batchId });

    return res.json({
      success: true,
      message: `Cleared ${result.deletedCount} allocations for batch ${batchId}.`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('clearAllAllocations error:', err);
    return res.json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/invigilator/clear-all-data
 * DANGEROUS: Clear ALL allocations from database
 */
const clearAllData = async (req, res) => {
  try {
    const result = await InvigilatorAllocation.deleteMany({});

    req.flash('success', `Cleared all ${result.deletedCount} allocations. Fresh start!`);
    res.redirect('/admin/invigilator');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/invigilator');
  }
};

module.exports = {
  getPage,
  getEligible,
  getDutyCheck,
  saveAllocation,
  updateAllocation,
  deleteAllocation,
  viewAllocation,
  downloadPDF,
  clearAllAllocations,
  clearAllData,
  DUTY_DAYS_MAP,
  getDutyDaysLimit
};

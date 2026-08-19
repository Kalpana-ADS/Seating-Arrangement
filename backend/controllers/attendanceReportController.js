const AttSession = require('../models/AttSession');
const PDFDocument = require('pdfkit');
const path        = require('path');
const fs          = require('fs');

// ─── Logo helper (shared with attendance controller) ────────────────────────
const LOGO_PATH = path.join(__dirname, '../../public/images/logo.png');
const getLogoBuf = () => {
  try { return fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null; }
  catch (e) { return null; }
};

const YEARS = ['II', 'III', 'IV'];
const YEAR_NAMES = { II: 'Second', III: 'Third', IV: 'Fourth' };

// ─── Build report data for a year (or all years) ────────────────────────────
const buildReport = async (year) => {
  const filter = {};
  if (year && YEARS.includes(year)) filter.year = year;

  const sessions = await AttSession.find(filter)
    .sort({ examDate: 1, session: 1 })
    .select('examName subject examDate session year section hallNumber records isFinalized');

  // Per-session summary
  const sessionSummary = sessions.map(s => {
    const present = s.records.filter(r => r.status === 'Present').length;
    const absent  = s.records.filter(r => r.status === 'Absent').length;
    const od      = s.records.filter(r => r.status === 'OD').length;
    const pending = s.records.filter(r => r.status === 'Pending').length;
    const total   = s.records.length;
    const pct     = total ? ((present + od) / total * 100) : 0;
    return {
      _id: s._id,
      examName: s.examName, subject: s.subject, examDate: s.examDate,
      session: s.session, year: s.year, section: s.section,
      hallNumber: s.hallNumber, isFinalized: s.isFinalized,
      present, absent, od, pending, total, pct: Number(pct.toFixed(1))
    };
  });

  // Aggregate absentee + OD list across all sessions
  const absenteeList = [];
  const odList = [];
  sessions.forEach(s => {
    s.records.forEach(r => {
      if (r.status === 'Absent') {
        absenteeList.push({
          name: r.name, rollNo: r.rollNo, registerNumber: r.registerNumber,
          year: s.year, section: s.section, examName: s.examName, subject: s.subject,
          examDate: s.examDate, session: s.session, absenceSymbol: r.absenceSymbol || 'A'
        });
      } else if (r.status === 'OD') {
        odList.push({
          name: r.name, rollNo: r.rollNo, registerNumber: r.registerNumber,
          year: s.year, section: s.section, examName: s.examName, subject: s.subject,
          examDate: s.examDate, session: s.session
        });
      }
    });
  });

  // Sort lists by year, section, then name
  const sortKey = (a, b) =>
    String(a.year).localeCompare(String(b.year)) ||
    String(a.section).localeCompare(String(b.section)) ||
    String(a.name || '').localeCompare(String(b.name || ''));
  absenteeList.sort(sortKey);
  odList.sort(sortKey);

  // Overall summary
  const totals = sessionSummary.reduce((acc, s) => {
    acc.total   += s.total;
    acc.present += s.present;
    acc.absent  += s.absent;
    acc.od      += s.od;
    acc.pending += s.pending;
    return acc;
  }, { total: 0, present: 0, absent: 0, od: 0, pending: 0 });

  const overallPct = totals.total ? ((totals.present + totals.od) / totals.total * 100) : 0;

  return {
    year: year || 'ALL',
    sessions: sessionSummary,
    absenteeList,
    odList,
    totals: { ...totals, pct: Number(overallPct.toFixed(1)) },
    sessionCount: sessions.length
  };
};

// ─── GET /admin/attendance-report ───────────────────────────────────────────
exports.getPage = async (req, res) => {
  try {
    const year = req.query.year || '';
    const data = await buildReport(year);

    res.render('admin/attendance_report', {
      title: 'Overall Attendance Report',
      report: data,
      selectedYear: year,
      years: YEARS,
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/attendance');
  }
};

// ─── GET /admin/attendance-report/pdf?year=II ───────────────────────────────
exports.downloadPDF = async (req, res) => {
  try {
    const year = req.query.year || '';
    const data = await buildReport(year);
    const selectedYear = year && YEARS.includes(year) ? year : 'ALL';
    const yearLabel = selectedYear === 'ALL'
      ? 'ALL YEARS (II, III & IV)'
      : `${YEAR_NAMES[selectedYear]} YEAR (${selectedYear})`;

    const pdf = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    const fname = `Overall_Attendance_Report_${selectedYear}_${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    pdf.pipe(res);

    // ─── PAGE FRAME & FOOTER (page numbers) ──────────────────────────────────
    const totalPages = () => pdf.bufferedPageRange().count;

    const drawPageFrame = () => {
      // Thin sidebar border for official look
      pdf.save();
      pdf.rect(32, 30, pdf.page.width - 64, pdf.page.height - 60)
         .lineWidth(1)
         .strokeColor('#C9CDDF')
         .stroke();
      pdf.restore();

      pdf.fontSize(7.5).font('Helvetica').fillColor('#888888');
      pdf.text(
        `Panimalar Engineering College — Examination Cell   |   Overall Attendance Report   |   Page ${pdf.page.pageNumber} of ${totalPages()}`,
        50, pdf.page.height - 35,
        { width: pdf.page.width - 100, align: 'center' }
      );
    };

    // ─── SECTION 1: LETTERHEAD ───────────────────────────────────────────────
    const logoBuf = getLogoBuf();

    // Header block with logo + institution names
    const headTop = 62;
    if (logoBuf) { try { pdf.image(logoBuf, 48, headTop + 2, { width: 62, height: 62 }); } catch (e) {} }

    pdf.fontSize(16).font('Helvetica-Bold').fillColor('#0D1B4B')
       .text('PANIMALAR ENGINEERING COLLEGE', 120, headTop, { width: 425, align: 'center', lineGap: 2 });
    pdf.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
       .text('(An Autonomous Institution, Affiliated to Anna University, Chennai)', 120, pdf.y + 2, { width: 425, align: 'center' });
    pdf.fontSize(10).font('Helvetica-Bold').fillColor('#1A2F7A')
       .text('Department of Artificial Intelligence and Data Science', 120, pdf.y + 2, { width: 425, align: 'center' });
    pdf.moveDown(0.4);

    // Official header rule (thick + thin)
    pdf.moveTo(50, pdf.y).lineTo(545, pdf.y).lineWidth(2).strokeColor('#0D1B4B').stroke();
    pdf.moveTo(50, pdf.y + 2).lineTo(545, pdf.y + 2).lineWidth(0.5).strokeColor('#C8A84B').stroke();
    pdf.moveDown(1.2);

    // Document title strip
    pdf.rect(50, pdf.y, 495, 24).fillColor('#1A2F7A').fill();
    pdf.fillColor('#FFFFFF').fontSize(12).font('Helvetica-Bold')
       .text(`${yearLabel} — OVERALL ATTENDANCE REPORT`, 50, pdf.y + 6, { width: 495, align: 'center' });
    pdf.y += 34;

    // Compact meta line
    const generatedAt = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    pdf.fontSize(8.5).font('Helvetica').fillColor('#555555');
    pdf.text(`${data.sessionCount} session(s)   |   Generated on ${generatedAt}`, 50, pdf.y, { width: 495, align: 'center' });
    pdf.moveDown(0.8);

    // ─── SECTION 2: EXECUTIVE SUMMARY BOX ───────────────────────────────────
    const boxY = pdf.y;
    pdf.rect(50, boxY, 495, 44).fillColor('#0D1B4B').fill();
    pdf.rect(50, boxY + 44, 495, 0.5).fillColor('#C8A84B').fill();

    pdf.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    pdf.text('EXECUTIVE SUMMARY', 50, boxY + 6, { width: 495, align: 'center' });

    const colDefs = [
      { label: 'TOTAL',          value: data.totals.total,   x: 50 },
      { label: 'PRESENT',        value: data.totals.present, x: 140 },
      { label: 'ABSENT',         value: data.totals.absent,  x: 225 },
      { label: 'ON DUTY (OD)',   value: data.totals.od,      x: 305 },
      { label: 'PENDING',        value: data.totals.pending, x: 400 }
    ];
    colDefs.forEach(c => {
      pdf.fillColor('#C8A84B').fontSize(15).font('Helvetica-Bold');
      pdf.text(String(c.value), c.x, boxY + 14, { width: 75, align: 'center' });
      pdf.fillColor('#FFFFFF').fontSize(6.5).font('Helvetica-Bold');
      pdf.text(c.label, c.x, boxY + 32, { width: 75, align: 'center' });
    });

    // Attendance % gold box
    pdf.rect(460, boxY + 5, 78, 34).fillColor('#C8A84B').fill();
    pdf.fillColor('#0D1B4B').fontSize(15).font('Helvetica-Bold');
    pdf.text(`${data.totals.pct}%`, 460, boxY + 7, { width: 78, align: 'center' });
    pdf.fillColor('#0D1B4B').fontSize(6.5).font('Helvetica-Bold');
    pdf.text('ATTENDANCE %', 460, boxY + 24, { width: 78, align: 'center' });
    pdf.y = boxY + 56;

    // Formula note
    pdf.fontSize(7.5).font('Helvetica-Oblique').fillColor('#666666');
    pdf.text('Note: Attendance percentage is computed as (Present + OD) ÷ Total × 100, as students on duty were physically present in the college.', 52, pdf.y, { width: 490, align: 'justify' });
    pdf.moveDown(1);

    // ─── SECTION 4: SESSION-WISE SUMMARY TABLE ──────────────────────────────
    if (data.sessions.length) {
      pdf.fontSize(11).font('Helvetica-Bold').fillColor('#0D1B4B')
         .text('1.  SESSION-WISE ATTENDANCE SUMMARY', 50, pdf.y);
      pdf.moveDown(0.5);

      const sCol = [50, 95, 185, 265, 320, 370, 420, 465, 510];
      const sRowH = 19;
      const headH = 21;
      let sy = pdf.y;

      const drawSessionHeader = () => {
        pdf.rect(50, sy, 495, headH).fillColor('#0D1B4B').fill();
        pdf.fillColor('#FFFFFF').fontSize(7).font('Helvetica-Bold');
        const hdrs = ['S.No', 'Date', 'Exam / Subject', 'Year / Sec', 'Session', 'Present', 'Absent', 'OD', '%'];
        hdrs.forEach((h, i) => {
          pdf.text(h, sCol[i], sy + 7, { width: (sCol[i + 1] || 545) - sCol[i] - 4, align: 'center' });
        });
        sy += headH;
      };

      drawSessionHeader();

      data.sessions.forEach((s, i) => {
        if (sy > 730) { pdf.addPage(); sy = 50; drawSessionHeader(); }
        const isOdd = i % 2 === 0;
        pdf.rect(50, sy, 495, sRowH).fillColor(isOdd ? '#F3F6FF' : '#FFFFFF').fill();
        pdf.rect(50, sy, 495, sRowH).strokeColor('#D5DAE8').lineWidth(0.3).stroke();
        pdf.fillColor('#222222').fontSize(7).font('Helvetica');
        pdf.text(String(i + 1), sCol[0], sy + 6, { width: sCol[1] - sCol[0] - 4, align: 'center' });
        pdf.text(new Date(s.examDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), sCol[1], sy + 6, { width: sCol[2] - sCol[1] - 4, align: 'center' });
        pdf.text(`${s.examName}${s.subject ? ' — ' + s.subject : ''}`, sCol[2] - 6, sy + 6, { width: sCol[3] - sCol[2] + 4, align: 'left', ellipsis: true });
        pdf.text(`${s.year} / ${s.section}`, sCol[3] - 4, sy + 6, { width: sCol[4] - sCol[3] + 8, align: 'center' });
        // Session chip
        pdf.rect(sCol[4] + 4, sy + 4, 34, 12).fillColor(s.session === 'FN' ? '#1565C0' : '#6A1B9A').fill();
        pdf.fillColor('#FFFFFF').font('Helvetica-Bold');
        pdf.text(s.session, sCol[4], sy + 6, { width: sCol[5] - sCol[4] - 2, align: 'center' });
        pdf.fillColor('#222222').font('Helvetica');
        pdf.text(String(s.present), sCol[5], sy + 6, { width: sCol[6] - sCol[5] - 4, align: 'center' });
        pdf.fillColor('#CC0000').font('Helvetica-Bold');
        pdf.text(String(s.absent), sCol[6], sy + 6, { width: sCol[7] - sCol[6] - 4, align: 'center' });
        pdf.fillColor('#E65100').font('Helvetica-Bold');
        pdf.text(String(s.od), sCol[7], sy + 6, { width: sCol[8] - sCol[7] - 4, align: 'center' });
        pdf.fillColor('#0D1B4B').font('Helvetica-Bold');
        pdf.text(`${s.pct.toFixed(1)}%`, sCol[8], sy + 6, { width: 545 - sCol[8] - 4, align: 'center' });
        pdf.fillColor('#222222').font('Helvetica');
        sy += sRowH;
      });

      // Totals row — values stay inside their column widths so nothing overlaps
      if (sy > 720) { pdf.addPage(); sy = 50; }
      pdf.rect(50, sy, 495, sRowH + 4).fillColor('#E8EDFF').fill();
      pdf.rect(50, sy, 495, sRowH + 4).strokeColor('#0D1B4B').lineWidth(0.8).stroke();
      pdf.fillColor('#0D1B4B').fontSize(8).font('Helvetica-Bold');
      // "TOTAL" centered across the S.No→Year/Sec span (cols 0-3)
      pdf.text('TOTAL', sCol[0], sy + 7, { width: sCol[4] - sCol[0] - 4, align: 'center' });
      // Plain numbers right under their column headers
      pdf.text(String(data.totals.present), sCol[5], sy + 7, { width: sCol[6] - sCol[5] - 4, align: 'center' });
      pdf.text(String(data.totals.absent), sCol[6], sy + 7, { width: sCol[7] - sCol[6] - 4, align: 'center' });
      pdf.text(String(data.totals.od), sCol[7], sy + 7, { width: sCol[8] - sCol[7] - 4, align: 'center' });
      pdf.text(`${data.totals.pct}%`, sCol[8], sy + 7, { width: 545 - sCol[8] - 6, align: 'center' });
      sy += sRowH + 4 + 14;
    }

    // ─── SECTION 5: ABSENTEE DETAILS ────────────────────────────────────────
    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#0D1B4B')
       .text('2.  ABSENTEE DETAILS', 50, pdf.y);
    pdf.fontSize(8.5).font('Helvetica').fillColor('#555555')
       .text(`Total number of absentees recorded across all sessions: ${data.absenteeList.length}`, 50, pdf.y + 3);
    pdf.moveDown(0.3);

    if (!data.absenteeList.length) {
      pdf.fontSize(9).font('Helvetica-Bold').fillColor('#2E7D32');
      pdf.text('No absentees recorded for the selected category.', 52, pdf.y + 6);
      pdf.moveDown(0.5);
    } else {
      const aCol = [50, 115, 215, 295, 405, 480];
      const aRowH = 18;
      const aHeadH = 20;
      let ay = pdf.y;

      const drawAbsHeader = () => {
        pdf.rect(50, ay, 495, aHeadH).fillColor('#8B1A1A').fill();
        pdf.fillColor('#FFFFFF').fontSize(7).font('Helvetica-Bold');
        ['S.No', 'Name of the Student', 'Register Number', 'Year / Section', 'Exam', 'Symbol'].forEach((h, i) => {
          pdf.text(h, aCol[i], ay + 7, { width: (aCol[i + 1] || 545) - aCol[i] - 4, align: 'center' });
        });
        ay += aHeadH;
      };

      drawAbsHeader();

      data.absenteeList.forEach((r, i) => {
        if (ay > 730) { pdf.addPage(); ay = 50; drawAbsHeader(); }
        const isOdd = i % 2 === 0;
        pdf.rect(50, ay, 495, aRowH).fillColor(isOdd ? '#FFF7F7' : '#FFFFFF').fill();
        pdf.rect(50, ay, 495, aRowH).strokeColor('#E8D5D5').lineWidth(0.3).stroke();
        pdf.fillColor('#222222').fontSize(7).font('Helvetica');
        pdf.text(String(i + 1), aCol[0], ay + 6, { width: aCol[1] - aCol[0] - 4, align: 'center' });
        pdf.text(r.name, aCol[1] - 4, ay + 6, { width: aCol[2] - aCol[1] + 6, align: 'left', ellipsis: true });
        pdf.text(r.registerNumber || r.rollNo || '—', aCol[2] - 4, ay + 6, { width: aCol[3] - aCol[2] + 6, align: 'center' });
        pdf.text(`${r.year} / ${r.section}`, aCol[3] - 4, ay + 6, { width: aCol[4] - aCol[3] + 6, align: 'center' });
        pdf.text(`${r.examName} (${new Date(r.examDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})`, aCol[4] - 4, ay + 6, { width: aCol[5] - aCol[4] + 6, align: 'center', ellipsis: true });
        pdf.fillColor('#CC0000').font('Helvetica-Bold');
        pdf.text(r.absenceSymbol, aCol[5] - 4, ay + 6, { width: 545 - aCol[5] + 4, align: 'center' });
        pdf.fillColor('#222222').font('Helvetica');
        ay += aRowH;
      });
    }

    // ─── SECTION 6: OD DETAILS ──────────────────────────────────────────────
    pdf.moveDown(0.8);
    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#0D1B4B')
       .text('3.  ON DUTY (OD) STUDENT DETAILS', 50, pdf.y);
    pdf.fontSize(8.5).font('Helvetica').fillColor('#555555')
       .text(`Total number of students on duty (OD) across all sessions: ${data.odList.length}`, 50, pdf.y + 3);
    pdf.moveDown(0.3);

    if (!data.odList.length) {
      pdf.fontSize(9).font('Helvetica-Bold').fillColor('#2E7D32');
      pdf.text('No OD students recorded for the selected category.', 52, pdf.y + 6);
      pdf.moveDown(0.5);
    } else {
      const oCol = [50, 165, 270, 350, 455];
      const oRowH = 18;
      const oHeadH = 20;
      let oy = pdf.y;

      const drawOdHeader = () => {
        pdf.rect(50, oy, 495, oHeadH).fillColor('#E65100').fill();
        pdf.fillColor('#FFFFFF').fontSize(7).font('Helvetica-Bold');
        ['S.No', 'Name of the Student', 'Register Number', 'Year / Section', 'Exam (Date)'].forEach((h, i) => {
          pdf.text(h, oCol[i], oy + 7, { width: (oCol[i + 1] || 545) - oCol[i] - 4, align: 'center' });
        });
        oy += oHeadH;
      };

      drawOdHeader();

      data.odList.forEach((r, i) => {
        if (oy > 730) { pdf.addPage(); oy = 50; drawOdHeader(); }
        const isOdd = i % 2 === 0;
        pdf.rect(50, oy, 495, oRowH).fillColor(isOdd ? '#FFF9EC' : '#FFFFFF').fill();
        pdf.rect(50, oy, 495, oRowH).strokeColor('#EADCC3').lineWidth(0.3).stroke();
        pdf.fillColor('#222222').fontSize(7).font('Helvetica');
        pdf.text(String(i + 1), oCol[0], oy + 6, { width: oCol[1] - oCol[0] - 4, align: 'center' });
        pdf.text(r.name, oCol[1] - 4, oy + 6, { width: oCol[2] - oCol[1] + 6, align: 'left', ellipsis: true });
        pdf.text(r.registerNumber || r.rollNo || '—', oCol[2] - 4, oy + 6, { width: oCol[3] - oCol[2] + 6, align: 'center' });
        pdf.text(`${r.year} Year — Sec ${r.section}`, oCol[3] - 4, oy + 6, { width: oCol[4] - oCol[3] + 6, align: 'center' });
        pdf.text(`${r.examName} (${new Date(r.examDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})`, oCol[4] - 4, oy + 6, { width: 545 - oCol[4], align: 'center', ellipsis: true });
        oy += oRowH;
      });
    }

    // ─── FINALIZE: draw frame + page numbers on all pages ───────────────────
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      drawPageFrame();
    }

    pdf.end();
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).send('Error generating PDF: ' + err.message);
  }
};

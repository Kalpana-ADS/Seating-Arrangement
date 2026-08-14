const AttStudent = require('../models/AttStudent');
const AttSession = require('../models/AttSession');
const PDFDocument = require('pdfkit');
const XLSX        = require('xlsx');
const path        = require('path');
const fs          = require('fs');
const multer      = require('multer');

// ─── Logo helper ──────────────────────────────────────────────────────────────
const LOGO_PATH = path.join(__dirname, '../../public/images/logo.png');
const getLogoBuf = () => { try { return fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null; } catch(e){ return null; } };

// ─── Multer for dataset re-upload ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname,'../data')),
  filename:    (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xls)$/)) cb(null, true);
    else cb(new Error('Only .xlsx/.xls allowed'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});
exports.uploadMiddleware = upload.single('dataset');

// ─── Parse one ATT xlsx ───────────────────────────────────────────────────────
const parseAttFile = (filePath, yearLabel, sheetPrefix, validSections) => {
  if (!fs.existsSync(filePath)) return [];
  const wb = XLSX.readFile(filePath);
  const students = [];
  for (const sname of wb.SheetNames) {
    const secRaw = sname.replace(new RegExp(`^${sheetPrefix}`,'i'),'').trim();
    if (!validSections.includes(secRaw)) continue;
    const ws   = wb.Sheets[sname];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    let hdr=false, sno_c=-1, roll_c=-1, reg_c=-1, name_c=-1;
    for (const row of rows) {
      const cells = row.map(c => String(c??'').trim());
      if (!hdr) {
        cells.forEach((c,i) => {
          const cu = c.toUpperCase().replace(/\s/g,'');
          if (cu==='S.NO') sno_c=i;
          if (cu.includes('ROLLNO')||cu==='ROLLNUMBER') roll_c=i;
          if (cu.includes('REGISTERNUMBER')||cu.includes('REGISTERNO')) reg_c=i;
          if (cu.includes('CANDIDATE')||cu==='NAME') name_c=i;
        });
        if (sno_c>=0 && name_c>=0) hdr=true;
        continue;
      }
      const sno  = cells[sno_c]?.replace('.0','');
      if (!sno || !/^\d+$/.test(sno)) continue;
      const roll = roll_c>=0 ? cells[roll_c] : '';
      const reg  = reg_c>=0  ? cells[reg_c].replace('.0','') : '';
      const name = name_c>=0 ? cells[name_c] : '';
      if (name && name!=='None')
        students.push({ year:yearLabel, section:secRaw, rollNo:roll, registerNumber:reg, name, department:'AI & Data Science' });
    }
  }
  return students;
};

const dataDir = path.join(__dirname,'../data');
const ATT_FILES = [
  { file:'II_YR_-_ATT__2025-2029.xlsx',  year:'II',  prefix:'AIDS ', sections:['A','B','C','D','E','F','G','H','I','J','K','L'] },
  { file:'III_YR_-_ATT__2024-2028.xlsx', year:'III', prefix:'II - ', sections:['A','B','C','D','E','F','G','H'] },
  { file:'IV_YR_-_ATT__2023-2027.xlsx',  year:'IV',  prefix:'III - ',sections:['A','B','C','D','E','F','G','H'] },
];

// ─── GET /admin/attendance ────────────────────────────────────────────────────
exports.getPage = async (req, res) => {
  try {
    const sessions = await AttSession.find().sort({ examDate:-1, createdAt:-1 }).limit(30)
      .select('sessionKey examName subject examDate session year section hallNumber isFinalized records');
    const totalAtt = await AttStudent.countDocuments();
    const byYear   = await AttStudent.aggregate([{ $group:{ _id:'$year', count:{$sum:1} } }]);
    const sections = await AttStudent.aggregate([
      { $group:{ _id:{ year:'$year', section:'$section' } } },
      { $sort:{ '_id.year':1, '_id.section':1 } }
    ]);
    const fileStatus = ATT_FILES.map(f => ({
      year: f.year, file: f.file,
      exists: fs.existsSync(path.join(dataDir,f.file)),
      size: (() => { try { return (fs.statSync(path.join(dataDir,f.file)).size/1024).toFixed(1)+' KB'; } catch(e){ return '—'; }})()
    }));
    res.render('admin/attendance', {
      title:'Exam Attendance System',
      sessions, totalAtt, byYear, sections, fileStatus,
      adminName: req.session.adminName,
      error:   req.flash('error'),
      success: req.flash('success')
    });
  } catch(err) { req.flash('error',err.message); res.redirect('/admin/dashboard'); }
};

// ─── GET /admin/attendance/search ─────────────────────────────────────────────
exports.search = async (req, res) => {
  try {
    const { q, year, section } = req.query;
    if (!q||q.trim().length<1) return res.json([]);
    const filter = {};
    if (year)    filter.year    = year;
    if (section) filter.section = section;
    filter.$or = [
      { name:           { $regex:q.trim(), $options:'i' } },
      { rollNo:         { $regex:q.trim(), $options:'i' } },
      { registerNumber: { $regex:q.trim(), $options:'i' } }
    ];
    const results = await AttStudent.find(filter).limit(12)
      .select('name rollNo registerNumber year section department');
    res.json(results);
  } catch(err) { res.json([]); }
};

// ─── POST /admin/attendance/session/create ────────────────────────────────────
exports.createSession = async (req, res) => {
  try {
    const { examName, subject, examDate, session, year, section, hallNumber } = req.body;
    if (!examName||!examDate||!session||!year||!section)
      return res.json({ success:false, message:'All fields are required.' });
    const dateStr = new Date(examDate).toISOString().split('T')[0];
    const key     = `${dateStr}_${session}_${year}_${section}`;
    let rec = await AttSession.findOne({ sessionKey:key });
    if (rec) return res.json({ success:true, id:rec._id, existing:true, message:'Session already exists — opening it.' });
    const students = await AttStudent.find({ year, section }).sort({ rollNo:1 });
    if (!students.length)
      return res.json({ success:false, message:`No students found for ${year} Year Sec ${section}.` });
    rec = await AttSession.create({
      sessionKey:key, examName, subject:subject||'', examDate:new Date(examDate),
      session, year, section, hallNumber:hallNumber||'',
      records: students.map(s => ({
        studentId:s._id, name:s.name, rollNo:s.rollNo,
        registerNumber:s.registerNumber, status:'Pending'
      }))
    });
    res.json({ success:true, id:rec._id, message:`Session created with ${students.length} students.` });
  } catch(err) { res.json({ success:false, message:err.message }); }
};

// ─── GET /admin/attendance/session/:id (page) ─────────────────────────────────
exports.getSessionPage = async (req, res) => {
  try {
    const rec = await AttSession.findById(req.params.id);
    if (!rec) { req.flash('error','Session not found.'); return res.redirect('/admin/attendance'); }
    res.render('admin/attendance_session', {
      title:`Attendance — ${rec.examName} | ${rec.year} Sec ${rec.section}`,
      rec, adminName:req.session.adminName,
      error:req.flash('error'), success:req.flash('success')
    });
  } catch(err) { req.flash('error',err.message); res.redirect('/admin/attendance'); }
};

// ─── POST /admin/attendance/mark-absent ───────────────────────────────────────
exports.markAbsent = async (req, res) => {
  try {
    const { sessionId, studentId, absenceSymbol } = req.body;
    const rec = await AttSession.findById(sessionId);
    if (!rec) return res.json({ success:false, message:'Session not found.' });
    const entry = rec.records.find(r => String(r.studentId)===String(studentId));
    if (!entry) return res.json({ success:false, message:'Student not in this session.' });
    entry.status = 'Absent';
    entry.absenceSymbol = absenceSymbol||'A';
    entry.markedAt = new Date();
    await rec.save();
    res.json({ success:true, message:`${entry.name} marked absent.`, absentCount:rec.records.filter(r=>r.status==='Absent').length });
  } catch(err) { res.json({ success:false, message:err.message }); }
};

// ─── POST /admin/attendance/undo-absent ───────────────────────────────────────
exports.undoAbsent = async (req, res) => {
  try {
    const { sessionId, studentId } = req.body;
    const rec = await AttSession.findById(sessionId);
    if (!rec) return res.json({ success:false, message:'Session not found.' });
    const entry = rec.records.find(r => String(r.studentId)===String(studentId));
    if (!entry) return res.json({ success:false, message:'Student not found.' });
    entry.status='Pending'; entry.absenceSymbol=''; entry.markedAt=null;
    await rec.save();
    res.json({ success:true, message:`${entry.name} restored to Pending.` });
  } catch(err) { res.json({ success:false, message:err.message }); }
};

// ─── POST /admin/attendance/edit-record ───────────────────────────────────────
exports.editRecord = async (req, res) => {
  try {
    const { sessionId, studentId, status, absenceSymbol } = req.body;
    const rec = await AttSession.findById(sessionId);
    if (!rec) return res.json({ success:false, message:'Session not found.' });
    const entry = rec.records.find(r => String(r.studentId)===String(studentId));
    if (!entry) return res.json({ success:false, message:'Student not found.' });
    if (status) entry.status=status;
    if (absenceSymbol!==undefined) entry.absenceSymbol=absenceSymbol;
    entry.markedAt=new Date();
    await rec.save();
    res.json({ success:true, message:'Record updated.' });
  } catch(err) { res.json({ success:false, message:err.message }); }
};


// ─── POST /admin/attendance/mark-od ──────────────────────────────────────────
exports.markOD = async (req, res) => {
  try {
    const { sessionId, studentId } = req.body;
    const rec = await AttSession.findById(sessionId);
    if (!rec) return res.json({ success:false, message:'Session not found.' });
    const entry = rec.records.find(r => String(r.studentId)===String(studentId));
    if (!entry) return res.json({ success:false, message:'Student not in this session.' });
    entry.status = 'OD';
    entry.absenceSymbol = 'OD';
    entry.markedAt = new Date();
    await rec.save();
    const odCount = rec.records.filter(r=>r.status==='OD').length;
    res.json({ success:true, message:`${entry.name} marked On Duty (OD).`, odCount });
  } catch(err) { res.json({ success:false, message:err.message }); }
};

// ─── POST /admin/attendance/mark-all-present ──────────────────────────────────
exports.markAllPresent = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const rec = await AttSession.findById(sessionId);
    if (!rec) return res.json({ success:false, message:'Session not found.' });
    let count=0;
    rec.records.forEach(r => { if(r.status==='Pending'){ r.status='Present'; r.markedAt=new Date(); count++; } }); // OD stays as OD
    rec.isFinalized=true; rec.finalizedAt=new Date();
    await rec.save();
    res.json({ success:true, message:`${count} students marked Present. Session finalized.`, count });
  } catch(err) { res.json({ success:false, message:err.message }); }
};

// ─── POST /admin/attendance/delete-session/:id ────────────────────────────────
exports.deleteSession = async (req, res) => {
  try {
    await AttSession.findByIdAndDelete(req.params.id);
    req.flash('success','Session deleted.');
    res.redirect('/admin/attendance');
  } catch(err) { req.flash('error',err.message); res.redirect('/admin/attendance'); }
};

// ─── GET /admin/attendance/download/:id → PDF ─────────────────────────────────
exports.downloadPDF = async (req, res) => {
  try {
    const rec = await AttSession.findById(req.params.id);
    if (!rec) return res.status(404).send('Not found');

    const pdf     = new PDFDocument({ margin:50, size:'A4' });
    const dateStr = new Date(rec.examDate).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
    const fname   = `Attendance_${rec.year}_Sec${rec.section}_${rec.session}_${new Date(rec.examDate).toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${fname}"`);
    pdf.pipe(res);

    // ── Header ────────────────────────────────────────────────────────────────
    const logoBuf = getLogoBuf();
    const startY  = pdf.y;
    if (logoBuf) { try { pdf.image(logoBuf, 50, startY, { width:60, height:60 }); } catch(e){} }
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
       .text('EXAM ATTENDANCE REGISTER', { align:'center' });
    pdf.moveDown(0.3);
    pdf.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
       .text(`${rec.year} Year — Section ${rec.section}   |   ${rec.examName}   |   ${dateStr}   |   ${rec.session} Session`,
         { align:'center' });
    if (rec.hallNumber) {
      pdf.text(`Hall: ${rec.hallNumber}`, { align:'center' });
    }
    pdf.moveDown(0.8);

    // ── Summary Box ───────────────────────────────────────────────────────────
    const present = rec.records.filter(r=>r.status==='Present').length;
    const absent  = rec.records.filter(r=>r.status==='Absent').length;
    const odCount = rec.records.filter(r=>r.status==='OD').length;
    const pending = rec.records.filter(r=>r.status==='Pending').length;
    const total   = rec.records.length;
    // OD = On Duty = student was physically present in college (just went for duty)
    // So attendance % = (Present + OD) / Total × 100
    const pct     = total ? ((present + odCount) / total * 100).toFixed(1) : '0.0';

    const bx = 50, by = pdf.y, bw = 495, bh = 34;
    // Summary bar background
    pdf.rect(bx, by, bw, bh).fillColor('#1A2F7A').fill();
    pdf.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
    pdf.text(`Total: ${total}`,       bx+8,   by+8,  { width:70, align:'center' });
    pdf.text(`Present: ${present}`,   bx+80,  by+8,  { width:80, align:'center' });
    pdf.text(`OD: ${odCount}`,        bx+162, by+8,  { width:60, align:'center' });
    pdf.text(`Absent: ${absent}`,     bx+224, by+8,  { width:75, align:'center' });
    pdf.text(`Pending: ${pending}`,   bx+301, by+8,  { width:80, align:'center' });
    // Attendance % box — highlighted in gold
    pdf.rect(bx+383, by+2, 110, bh-4).fillColor('#C8A84B').fill();
    pdf.fillColor('#0D1B4B').fontSize(13).font('Helvetica-Bold');
    pdf.text(`${pct}%`,               bx+383, by+5,  { width:110, align:'center' });
    pdf.fillColor('#FFFFFF').fontSize(7).font('Helvetica');
    pdf.text(`(Present+OD)/Total`,    bx+383, by+20, { width:110, align:'center' });
    pdf.y = by + bh + 12;

    // ── Table ─────────────────────────────────────────────────────────────────
    const colX = [50,  80, 215, 310, 380, 445, 480];
    const colW = [30, 135,  95,  70,  65,  35,  65];
    const rowH = 18;
    let   y    = pdf.y;
    const absenteeRows = rec.records
      .filter(r => r.status === 'Absent' || r.status === 'OD')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    // Table header
    pdf.rect(50, y, 495, rowH).fillColor('#1A2F7A').fill();
    pdf.fillColor('#FFFFFF').fontSize(7.5).font('Helvetica-Bold');
    ['S.No','STUDENT NAME','ROLL NO','REG NO','EXAM','SES','STATUS'].forEach((h,i) => {
      pdf.text(h, colX[i], y+5, { width:colW[i], align:'center' });
    });
    y += rowH;

    if (!absenteeRows.length) {
      pdf.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      pdf.text('No Absent / OD students for this session.', 50, y + 8, { width: 495, align: 'center' });
      y += 24;
    } else {
      absenteeRows.forEach((r, i) => {
        if (y > 760) {
          pdf.addPage();
          y = 50;
          // Repeat header on new page
          pdf.rect(50,y,495,rowH).fillColor('#1A2F7A').fill();
          pdf.fillColor('#FFFFFF').fontSize(7.5).font('Helvetica-Bold');
          ['S.No','STUDENT NAME','ROLL NO','REG NO','EXAM','SES','STATUS'].forEach((h,ii) => {
            pdf.text(h, colX[ii], y+5, { width:colW[ii], align:'center' });
          });
          y += rowH;
        }

        const isAbsent  = r.status==='Absent';
        const isOD      = r.status==='OD';
        const rowBg     = isAbsent ? '#FFF0F0' : '#FFF8E1';
        pdf.rect(50, y, 495, rowH).fillColor(rowBg).fill();
        pdf.rect(50, y, 495, rowH).strokeColor('#CCCCCC').lineWidth(0.4).stroke();

        const statusTxt = isAbsent ? (r.absenceSymbol||'A') : 'OD';
        const statusClr = isAbsent ? '#CC0000' : '#E65100';

        pdf.fillColor('#000000').fontSize(7.5).font('Helvetica-Bold');
        pdf.text(String(i+1),    colX[0], y+5, { width:colW[0], align:'center' });
        pdf.text(r.name,         colX[1], y+5, { width:colW[1], align:'left',   ellipsis:true });
        pdf.text(r.rollNo||'—',  colX[2], y+5, { width:colW[2], align:'center' });
        pdf.text(r.registerNumber||'—', colX[3], y+5, { width:colW[3], align:'center' });
        pdf.text(rec.examName,   colX[4], y+5, { width:colW[4], align:'center', ellipsis:true });
        pdf.text(rec.session,    colX[5], y+5, { width:colW[5], align:'center' });
        pdf.fillColor(statusClr).font('Helvetica-Bold');
        pdf.text(statusTxt,      colX[6], y+5, { width:colW[6], align:'center' });
        y += rowH;
      });
    }

    // Totals row
    if (y > 750) { pdf.addPage(); y = 50; }
    pdf.rect(50,y,495,rowH+2).fillColor('#0D1B4B').fill();
    pdf.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    pdf.text(`Total: ${total}   Present: ${present}   OD: ${odCount}   Absent: ${absent}   Pending: ${pending}   Attendance: ${pct}% (Present+OD/Total)`,
      52, y+6, { width:491, align:'center' });
    y += rowH + 2 + 25;

    // Signature row
    pdf.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
    pdf.text('Examination Controller: _______________________', 50, y);
    pdf.text('Head of Department (HOD): _______________________', 310, y);

    // Footer
    pdf.moveDown(2);
    pdf.fontSize(7.5).font('Helvetica-Bold').fillColor('#000000')
       .text(`Generated: ${new Date().toLocaleString('en-IN')}   |   Panimalar Engineering College — Examination Cell`,
         { align:'center' });

    if (rec.isFinalized) {
      pdf.moveDown(0.5);
      pdf.fontSize(8).fillColor('#1B5E20')
         .text(`Session finalized on ${new Date(rec.finalizedAt||rec.updatedAt).toLocaleString('en-IN')}`,
           { align:'center' });
    }

    pdf.end();
  } catch(err) {
    console.error('PDF error:', err);
    res.status(500).send('Error generating PDF: '+err.message);
  }
};

// ─── POST /admin/attendance/dataset/upload ────────────────────────────────────
exports.uploadDataset = async (req, res) => {
  try {
    if (!req.file) { req.flash('error','No file uploaded.'); return res.redirect('/admin/attendance'); }
    const fname = req.file.filename;
    let year='', prefix='', sections=[];
    if (fname.includes('II_YR')||fname.includes('2025-2029'))      { year='II';  prefix='AIDS '; sections=['A','B','C','D','E','F','G','H','I','J','K','L']; }
    else if (fname.includes('III_YR')||fname.includes('2024-2028')) { year='III'; prefix='II - '; sections=['A','B','C','D','E','F','G','H','I']; }
    else if (fname.includes('IV_YR')||fname.includes('2023-2027'))  { year='IV';  prefix='III - ';sections=['A','B','C','D','E','F','G','H','I']; }
    else { req.flash('error','Unknown file. Name must contain II_YR, III_YR, or IV_YR.'); return res.redirect('/admin/attendance'); }
    const students = parseAttFile(path.join(dataDir,fname), year, prefix, sections);
    await AttStudent.deleteMany({ year });
    for (let i=0;i<students.length;i+=200)
      await AttStudent.insertMany(students.slice(i,i+200), { ordered:false }).catch(()=>{});
    req.flash('success',`${year} Year dataset updated: ${await AttStudent.countDocuments({year})} students.`);
    res.redirect('/admin/attendance');
  } catch(err) { req.flash('error',err.message); res.redirect('/admin/attendance'); }
};

// ─── POST /admin/attendance/dataset/reseed ────────────────────────────────────
exports.reseedAll = async (req, res) => {
  try {
    const { year } = req.body;
    const files = year ? ATT_FILES.filter(f=>f.year===year) : ATT_FILES;
    let total=0;
    for (const f of files) {
      const fp = path.join(dataDir,f.file);
      if (!fs.existsSync(fp)) continue;
      const students = parseAttFile(fp, f.year, f.prefix, f.sections);
      await AttStudent.deleteMany({ year:f.year });
      for (let i=0;i<students.length;i+=200)
        await AttStudent.insertMany(students.slice(i,i+200), { ordered:false }).catch(()=>{});
      total += students.length;
    }
    res.json({ success:true, message:`Reseeded ${total} students from Excel files.` });
  } catch(err) { res.json({ success:false, message:err.message }); }
};

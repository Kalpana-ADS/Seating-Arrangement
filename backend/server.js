require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const session  = require('express-session');
const flash    = require('connect-flash');
const path     = require('path');

const app = express();

// ── View engine ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'pec_exam_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }   // 8 hours
}));
app.use(flash());

// ── Global template locals ────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.collegeInfo = {
    name:       'PANIMALAR ENGINEERING COLLEGE',
    subtitle:   '(Autonomous Institution)',
    department: 'Department of Artificial Intelligence and Data Science'
  };
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/admin',             require('./routes/auth'));
app.use('/admin/students',    require('./routes/students'));
app.use('/admin',             require('./routes/seating'));
app.use('/seating',           require('./routes/seating'));
app.use('/admin',             require('./routes/adminUsers'));
app.use('/admin/invigilator', require('./routes/invigilator'));
app.use('/admin/attendance',  require('./routes/attendance'));
app.use('/admin/settings',    require('./routes/settings'));

// ── Standalone upload page ────────────────────────────────────────────────────
app.get('/admin/upload', (req, res) => {
  if (!req.session.adminId) return res.redirect('/admin/login');
  res.render('admin/upload', {
    title:     'Upload Dataset',
    adminName: req.session.adminName,
    error:     req.flash('error'),
    success:   req.flash('success')
  });
});

// ── Homepage ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.render('public/index', { title: 'Exam Seating Arrangement System' })
);

// ── MongoDB + Seed ────────────────────────────────────────────────────────────
const connectDB = async () => {
  const candidates = [
    process.env.MONGODB_URI,
    'mongodb://127.0.0.1:27017/exam_seating',
    'mongodb://localhost:27017/exam_seating'
  ].filter(Boolean);

  let connectedUri = null;
  let lastError = null;

  for (const uri of candidates) {
    try {
      await mongoose.connect(uri);
      connectedUri = uri;
      console.log(`✅  MongoDB connected: ${uri}`);
      break;
    } catch (err) {
      lastError = err;
      console.warn(`⚠️  MongoDB failed for ${uri}: ${err.message}`);
    }
  }

  if (!connectedUri) {
    console.error('❌  MongoDB connection failed. Please start MongoDB or update MONGODB_URI in .env');
    console.error(lastError ? lastError.message : 'No MongoDB URI available');
    process.exit(1);
  }

  // ── 1. Admin accounts ─────────────────────────────────────────────────────
  const Admin = require('./models/Admin');
  const ADMINS = [
    { username:'admin',    password:'admin123',   fullName:'System Administrator', role:'superadmin' },
    { username:'hod',      password:'hod@pec123', fullName:'Head of Department',   role:'admin'      },
    { username:'examcell', password:'exam@2024',  fullName:'Exam Cell Staff',       role:'admin'      },
    { username:'faculty1', password:'fac@2024',   fullName:'Faculty Member',        role:'staff'      }
  ];
  for (const a of ADMINS) {
    if (!await Admin.findOne({ username: a.username })) {
      await Admin.create(a);
      console.log(`  ✅  Admin created: ${a.username} / ${a.password}`);
    }
  }

  // ── Load seed data ────────────────────────────────────────────────────────
  const Student    = require('./models/Student');
  const Staff      = require('./models/Staff');
  const AttStudent = require('./models/AttStudent');
  const seedData   = require('./data/seedStudents');
  const seedAtt    = require('./data/seedAttStudents');
  const seedStaff  = require('./data/seedStaff');

  // ── Validate the full seed set, not just the first entry or total count ─
  // This catches legacy records that may still be in MongoDB even when counts match.
  const getRegisterSet = async (Model, seedRows) => {
    const dbIds = await Model.find({}, { registerNumber: 1, _id: 0 }).lean();
    const dbSet = new Set(
      dbIds
        .map(r => String(r.registerNumber || '').trim())
        .filter(Boolean)
    );
    const seedSet = new Set(
      seedRows
        .map(r => String(r.registerNumber || r.rollNo || '').trim())
        .filter(Boolean)
    );

    const missingFromDb = [...seedSet].filter(id => !dbSet.has(id));
    const extraInDb = [...dbSet].filter(id => !seedSet.has(id));
    return {
      dbCount: dbSet.size,
      seedCount: seedSet.size,
      missingFromDb,
      extraInDb,
      isValid: dbSet.size === seedSet.size && missingFromDb.length === 0 && extraInDb.length === 0
    };
  };

  const studentSetStatus = await getRegisterSet(Student, seedData);
  const dbNeedsUpdate = !studentSetStatus.isValid;

  // ── 2. Seating / Student data ─────────────────────────────────────────────
  if (dbNeedsUpdate) {
    console.log('  ⏳  Updating student data (stale or mismatched dataset detected)…');
    if (studentSetStatus.extraInDb.length || studentSetStatus.missingFromDb.length) {
      console.log(`     stale IDs in DB: ${studentSetStatus.extraInDb.slice(0, 10).join(', ') || 'none'}`);
      console.log(`     missing IDs: ${studentSetStatus.missingFromDb.slice(0, 10).join(', ') || 'none'}`);
    }
    await Student.deleteMany({});
    for (let i = 0; i < seedData.length; i += 200)
      await Student.insertMany(seedData.slice(i, i+200), { ordered:false }).catch(()=>{});
    console.log(`  ✅  Students loaded: ${await Student.countDocuments()}`);
  } else {
    console.log(`  ✅  Students up to date: ${await Student.countDocuments()}`);
  }

  // ── 3. Staff ──────────────────────────────────────────────────────────────
  if (await Staff.countDocuments() === 0) {
    console.log('  ⏳  Seeding staff…');
    await Staff.insertMany(seedStaff, { ordered:false }).catch(()=>{});
    console.log(`  ✅  Staff: ${await Staff.countDocuments()}`);
  } else {
    console.log(`  ✅  Staff already loaded: ${await Staff.countDocuments()}`);
  }

  // ── 4. Attendance students ────────────────────────────────────────────────
  const attendanceSetStatus = await getRegisterSet(AttStudent, seedAtt);
  const attNeedsUpdate = !attendanceSetStatus.isValid;

  if (attNeedsUpdate) {
    console.log('  ⏳  Updating attendance students (stale or mismatched dataset detected)…');
    if (attendanceSetStatus.extraInDb.length || attendanceSetStatus.missingFromDb.length) {
      console.log(`     stale IDs in DB: ${attendanceSetStatus.extraInDb.slice(0, 10).join(', ') || 'none'}`);
      console.log(`     missing IDs: ${attendanceSetStatus.missingFromDb.slice(0, 10).join(', ') || 'none'}`);
    }
    await AttStudent.deleteMany({});
    for (let i = 0; i < seedAtt.length; i += 200)
      await AttStudent.insertMany(seedAtt.slice(i, i+200), { ordered:false }).catch(()=>{});
    console.log(`  ✅  Attendance students loaded: ${await AttStudent.countDocuments()}`);
  } else {
    console.log(`  ✅  Attendance students up to date: ${await AttStudent.countDocuments()}`);
  }
};

connectDB();

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀  Running → http://localhost:${PORT}`);
  console.log(`📋  Admin  → http://localhost:${PORT}/admin/login`);
  console.log(`    admin/admin123  |  hod/hod@pec123  |  examcell/exam@2024  |  faculty1/fac@2024\n`);
});

module.exports = app;

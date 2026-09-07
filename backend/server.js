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
app.use('/admin/attendance-report', require('./routes/attendanceReport'));
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

  // Maintain uploaded year-wise datasets across app restarts.
  // Only seed the default developer dataset when the collection is empty.
  // This prevents refresh/restart from wiping the current uploaded dataset.
  const bootstrapIfEmpty = async (Model, rows, label) => {
    const count = await Model.countDocuments();
    if (count > 0) {
      console.log(`  ✅  ${label} already available: ${count}`);
      return;
    }

    console.log(`  ⏳  ${label} empty; loading default startup dataset…`);
    for (let i = 0; i < rows.length; i += 200) {
      await Model.insertMany(rows.slice(i, i + 200), { ordered: false }).catch(() => {});
    }
    console.log(`  ✅  ${label} loaded: ${await Model.countDocuments()}`);
  };

  // ── 2. Seating / Student data ─────────────────────────────────────────────
  await bootstrapIfEmpty(Student, seedData, 'Students');

  // ── 3. Staff ──────────────────────────────────────────────────────────────
  if (await Staff.countDocuments() === 0) {
    console.log('  ⏳  Seeding staff…');
    await Staff.insertMany(seedStaff, { ordered:false }).catch(()=>{});
    console.log(`  ✅  Staff: ${await Staff.countDocuments()}`);
  } else {
    console.log(`  ✅  Staff already loaded: ${await Staff.countDocuments()}`);
  }

  // ── 4. Attendance students ────────────────────────────────────────────────
  await bootstrapIfEmpty(AttStudent, seedAtt, 'Attendance students');
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

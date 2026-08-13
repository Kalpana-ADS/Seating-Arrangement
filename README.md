# Panimalar Engineering College
## Exam Seating Arrangement, Invigilator Allocation & Attendance System
### Department of Artificial Intelligence and Data Science

---

## Features

| Module | Description |
|--------|-------------|
| **Exam Seating** | Auto-generate continuous register number ranges per section |
| **Hall Sheets** | Printable hall-wise seating with seat numbers |
| **Dept Notice** | Department entrance notice board (all halls) |
| **Invigilator Allocation** | Subject-based staff exclusion, random 5 suggestions, XLSX export |
| **Exam Attendance** | Smart autocomplete, absent marking, session history, XLSX export |
| **Dataset Management** | Upload/replace Excel datasets from admin panel |
| **PDF Export** | Seating PDFs with embedded college logo |
| **Admin Users** | 4 accounts, change username/password, add members |
| **Settings** | Logo upload with live preview |
| **Responsive UI** | Works on desktop, tablet, mobile |

---

## Quick Start

### 1. Install Node.js (v16+)
Download from https://nodejs.org

### 2. Install MongoDB
Download from https://www.mongodb.com/try/download/community
Or use MongoDB Atlas (cloud) — update MONGODB_URI in .env

### 3. Install dependencies
```bash
npm install
```

### 4. Configure environment
Edit `.env` file — set your MONGODB_URI

### 5. Start MongoDB (local only)
```bash
mongod
```

### 6. Run the application
```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 7. Open browser
- **Student Portal:** http://localhost:3000
- **Admin Panel:**   http://localhost:3000/admin/login

---

## Login Credentials

| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Super Admin |
| hod | hod@pec123 | Admin |
| examcell | exam@2024 | Admin |
| faculty1 | fac@2024 | Staff |

---

## MongoDB Atlas Setup (Cloud)

1. Create free account at https://cloud.mongodb.com
2. Create a cluster → Connect → Drivers → Copy connection string
3. Replace in `.env`:
```
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/exam_seating
```

---

## Folder Structure

```
exam-seating-system/
├── backend/
│   ├── controllers/        # Business logic
│   ├── data/               # Excel datasets + seed files
│   ├── middleware/         # Auth, upload handlers
│   ├── models/             # MongoDB schemas
│   ├── routes/             # Express routes
│   └── server.js           # Entry point
├── public/
│   ├── css/main.css        # All styles
│   ├── js/main.js          # Frontend JS
│   └── images/logo.png     # College logo
├── views/
│   ├── admin/              # Admin panel pages
│   ├── public/             # Student portal pages
│   └── partials/           # Shared header/sidebar/footer
├── .env                    # Configuration
├── package.json
└── README.md
```

---

## Datasets Used

| File | Purpose | Year |
|------|---------|------|
| II_-_2024-2028.xlsx | Seating students | II Year |
| III_YEAR_2023-2027__2_.xlsx | Seating students | III Year |
| IV_YEAR_-_2022_-_2026.xlsx | Seating students | IV Year |
| WorkLoadStaff.xlsx | Staff for invigilator | All |
| II_YR_-_ATT__2025-2029.xlsx | Attendance students | II Year |
| III_YR_-_ATT__2024-2028.xlsx | Attendance students | III Year |
| IV_YR_-_ATT__2023-2027.xlsx | Attendance students | IV Year |

---

*Panimalar Engineering College — Jaisakthi Educational Trust*

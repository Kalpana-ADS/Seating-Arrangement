/**
 * Seed Staff from Excel file: Fac List 2026-27.xlsx
 * Reads faculty list and populates MongoDB Staff collection
 * Ensures no duplicates and accurate designation/subject mapping
 */

const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Staff = require('../models/Staff');

// Designation mapping from Excel to internal format (case-insensitive)
const designationMap = {
  'professor': 'Professor',
  'asso.prof': 'Associate Professor',
  'asst.prof g1': 'Assistant Professor G1',
  'asst.prof li': 'Assistant Professor LI',
  'asst.prof': 'Assistant Professor',
  'assistant professor': 'Assistant Professor'
};

// Duty days by designation
const dutyDaysByDesignation = {
  'Professor': 3,
  'Associate Professor': 4,
  'Assistant Professor G1': 5,
  'Assistant Professor LI': 6,
  'Assistant Professor': 5
};

/**
 * Normalize and map designation
 */
const normalizeDesignation = (desig) => {
  if (!desig) return 'Assistant Professor';
  
  const cleaned = desig.trim().toUpperCase();
  
  // Direct mappings
  if (cleaned === 'PROFESSOR') return 'Professor';
  if (cleaned === 'ASSO.PROF') return 'Associate Professor';
  if (cleaned.includes('ASST.PROF') && cleaned.includes('G1')) return 'Assistant Professor G1';
  if (cleaned.includes('ASST.PROF') && cleaned.includes('LI')) return 'Assistant Professor LI';
  if (cleaned.includes('ASST.PROF')) return 'Assistant Professor';
  if (cleaned.includes('ASSOCIATE')) return 'Associate Professor';
  if (cleaned.includes('ASSISTANT')) return 'Assistant Professor';
  
  return 'Assistant Professor'; // Default
};

const seedStaffFromExcel = async () => {
  try {
    const dbUri = process.env.MONGODB_URI;
    if (!dbUri) {
      console.error('❌ MONGODB_URI not found in .env');
      process.exit(1);
    }

    // Connect to MongoDB
    await mongoose.connect(dbUri);
    console.log('✅ Connected to MongoDB');

    // Read Excel file
    const excelPath = path.join(__dirname, 'Fac List 2026 -27.xlsx');
    if (!fs.existsSync(excelPath)) {
      console.error(`❌ Excel file not found: ${excelPath}`);
      process.exit(1);
    }

    const wb = XLSX.readFile(excelPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // Parse data - headers at row 2 (index 1)
    const staffList = [];
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue; // Skip empty rows

      const sNo = row[0];
      const name = (row[1] || '').trim().toUpperCase();
      const designation = (row[3] || 'Assistant Professor').trim();
      let subject = (row[5] || '').trim();

      // Skip if no name
      if (!name) continue;

      // Normalize designation
      const mappedDesignation = normalizeDesignation(designation);

      // Clean up subject (remove line breaks, extra spaces)
      subject = subject
        .replace(/\r\n/g, ', ')
        .replace(/\n/g, ', ')
        .replace(/,\s+/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();

      staffList.push({
        name,
        designation: mappedDesignation,
        subject,
        department: 'AI & Data Science'
      });
    }

    console.log(`\n📋 Parsed ${staffList.length} faculty members from Excel`);

    // Clear existing staff (for fresh seeding)
    await Staff.deleteMany({});
    console.log('🗑️  Cleared existing staff records');

    // Insert all staff
    const result = await Staff.insertMany(staffList, { ordered: false });
    console.log(`✅ Seeded ${result.length} staff members into database`);

    // Display summary by designation
    const byDesignation = {};
    staffList.forEach(s => {
      byDesignation[s.designation] = (byDesignation[s.designation] || 0) + 1;
    });

    console.log('\n📊 Staff breakdown by designation:');
    const order = ['Professor', 'Associate Professor', 'Assistant Professor G1', 'Assistant Professor LI', 'Assistant Professor'];
    order.forEach(d => {
      if (byDesignation[d]) {
        const count = byDesignation[d];
        const dutyDays = dutyDaysByDesignation[d] || '?';
        console.log(`  • ${d}: ${count} (Duty days: ${dutyDays}/month)`);
      }
    });

    // Any unmapped
    Object.entries(byDesignation).forEach(([d, count]) => {
      if (!order.includes(d)) {
        console.log(`  • ${d}: ${count}`);
      }
    });

    console.log('\n✅ Faculty list seeding completed successfully!');
    console.log('✨ All staff are now ready for invigilator allocation.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  }
};

seedStaffFromExcel();

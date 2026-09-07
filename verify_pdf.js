const fs = require('fs');
const mongoose = require('mongoose');

const base = 'http://localhost:3000';

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/exam_seating';
  await mongoose.connect(uri);

  const Inv = require('./backend/models/InvigilatorAllocation');
  const doc = await Inv.findOne().lean();

  if (!doc) {
    console.log('NO_DOC');
    process.exit(0);
  }

  const loginRes = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin123',
    redirect: 'manual'
  });

  const cookie = loginRes.headers.get('set-cookie') || '';
  const pdfRes = await fetch(`${base}/admin/invigilator/download/${doc._id}`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });

  const bytes = Buffer.from(await pdfRes.arrayBuffer());
  fs.writeFileSync('verify_pdf_output.pdf', bytes);

  const text = bytes.toString('latin1');
  console.log('STATUS=' + pdfRes.status);
  console.log('HAS_HALL_NO=' + text.includes('Hall.No'));
  console.log('HAS_EXAM_DATE=' + text.includes('EXAM DATE'));
  console.log('HAS_SESSION=' + text.includes('SESSION'));
  console.log('SIZE=' + bytes.length);

  await mongoose.disconnect();
})();

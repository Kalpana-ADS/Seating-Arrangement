require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('NO_URI');
    return;
  }

  await mongoose.connect(uri);

  const Student = require('./backend/models/Student');
  const AttStudent = require('./backend/models/AttStudent');

  const [studentCounts, attCounts] = await Promise.all([
    Student.aggregate([{ $group: { _id: '$year', count: { $sum: 1 } } }]),
    AttStudent.aggregate([{ $group: { _id: '$year', count: { $sum: 1 } } }])
  ]);

  console.log(JSON.stringify({
    studentCounts,
    attCounts,
    totalStudents: await Student.countDocuments(),
    totalAttendanceStudents: await AttStudent.countDocuments()
  }, null, 2));

  await mongoose.disconnect();
})();

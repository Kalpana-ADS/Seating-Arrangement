const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema({
  studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'AttStudent', required: true },
  name:           { type: String },
  rollNo:         { type: String },
  registerNumber: { type: String },
  status:         { type: String, enum: ['Present','Absent','OD','Pending'], default: 'Pending' },
  absenceSymbol:  { type: String, default: '' },
  markedAt:       { type: Date }
}, { _id: false });

const attSessionSchema = new mongoose.Schema({
  sessionKey:  { type: String, required: true, unique: true }, // "2024-01-15_FN_II_A"
  examName:    { type: String, required: true },
  subject:     { type: String, default: '' },
  examDate:    { type: Date,   required: true },
  session:     { type: String, enum: ['FN','AN'], required: true },
  year:        { type: String, required: true, enum: ['II','III','IV'] },
  section:     { type: String, required: true },
  hallNumber:  { type: String, default: '' },
  records:     [recordSchema],
  isFinalized: { type: Boolean, default: false },
  finalizedAt: { type: Date }
}, { timestamps: true });

attSessionSchema.index({ examDate: -1 });
attSessionSchema.index({ year: 1, section: 1, examDate: -1 });

module.exports = mongoose.model('AttSession', attSessionSchema);

const mongoose = require('mongoose');

const attRecordSchema = new mongoose.Schema({
  sessionId:   { type: String, required: true },   // "2024-01-15_FN_II_A"
  examName:    { type: String, required: true },
  examDate:    { type: Date,   required: true },
  session:     { type: String, enum: ['FN','AN'], required: true },
  year:        { type: String, required: true },
  section:     { type: String, required: true },
  hallNumber:  { type: String, default: '' },
  records: [{
    studentId:      { type: mongoose.Schema.Types.ObjectId, ref: 'AttStudent' },
    name:           { type: String },
    rollNo:         { type: String },
    registerNumber: { type: String },
    status:         { type: String, enum: ['Present','Absent','—'], default: '—' },
    absenceSymbol:  { type: String, default: '' },
    markedAt:       { type: Date }
  }],
  isFinalized: { type: Boolean, default: false }
}, { timestamps: true });

attRecordSchema.index({ sessionId: 1 }, { unique: true });
attRecordSchema.index({ examDate: -1 });
module.exports = mongoose.model('AttRecord', attRecordSchema);

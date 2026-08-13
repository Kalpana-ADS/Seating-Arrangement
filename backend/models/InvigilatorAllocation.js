const mongoose = require('mongoose');

const rowSchema = new mongoose.Schema({
  staffName:   { type: String, required: true },
  designation: { type: String, default: '' },
  subject:     { type: String, default: '' },
  hallNumber:  { type: String, default: '' },
  session:     { type: String, enum: ['FN','AN'], default: 'FN' },
  timing:      { type: String, default: '' }
}, { _id: false });

const allocationSchema = new mongoose.Schema({
  examName:    { type: String, required: true },
  subjectName: { type: String, required: true },
  examDate:    { type: Date,   required: true },
  session:     { type: String, enum: ['FN','AN'], required: true },
  allocations: [rowSchema]
}, { timestamps: true });

module.exports = mongoose.model('InvigilatorAllocation', allocationSchema);

const mongoose = require('mongoose');

const rowSchema = new mongoose.Schema({
  staffName:   { type: String, required: true },
  designation: { type: String, default: 'Assistant Professor' },
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
  allocations: [rowSchema],
  // Batch ID for grouping allocations (e.g., "2026-09" for September 2026)
  batchId:     { type: String, default: '' },
  // Assessment number (1, 2, 3, etc.)
  assessment:  { type: Number, default: 1 }
}, { timestamps: true });

// Indexes for efficient querying
allocationSchema.index({ examDate: -1 });
allocationSchema.index({ batchId: 1 });
allocationSchema.index({ assessment: 1 });
allocationSchema.index({ examName: 1 });

module.exports = mongoose.model('InvigilatorAllocation', allocationSchema);

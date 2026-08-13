const mongoose = require('mongoose');

const attStudentSchema = new mongoose.Schema({
  year:           { type: String, required: true, enum: ['II','III','IV'] },
  section:        { type: String, required: true, trim: true },
  rollNo:         { type: String, trim: true, default: '' },
  registerNumber: { type: String, trim: true, default: '' },
  name:           { type: String, required: true, trim: true },
  department:     { type: String, default: 'AI & Data Science' }
}, { timestamps: true });

// Text index for fast autocomplete search
attStudentSchema.index({ name: 'text', rollNo: 'text', registerNumber: 'text' });
attStudentSchema.index({ year: 1, section: 1 });
attStudentSchema.index({ rollNo: 1 });

module.exports = mongoose.model('AttStudent', attStudentSchema);

const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  registerNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  year: {
    type: String,
    required: true,
    enum: ['II', 'III', 'IV'],
    set: v => (v == null ? v : String(v).trim().toUpperCase())
  },
  section: {
    type: String,
    required: true,
    trim: true,
    set: v => (v == null ? v : String(v).trim().toUpperCase())
  },
  department: {
    type: String,
    default: 'Artificial Intelligence and Data Science'
  },
  isAllocated: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

studentSchema.index({ year: 1, section: 1, registerNumber: 1 });

module.exports = mongoose.model('Student', studentSchema);

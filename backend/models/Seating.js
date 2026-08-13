const mongoose = require('mongoose');

const seatingSchema = new mongoose.Schema({
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
  startRegister: {
    type: String,
    required: true
  },
  endRegister: {
    type: String,
    required: true
  },
  totalStudents: {
    type: Number,
    required: true
  },
  examDate: {
    type: Date,
    default: Date.now
  },
  examName: {
    type: String,
    default: 'Internal Assessment'
  },
  hallNumber: {
    type: String,
    default: '',
    set: v => (v == null ? '' : String(v).trim().toUpperCase())
  },
  seatStart: {
    type: Number,
    default: 1
  },
  order: {
    type: Number,
    default: 0
  },
  examSession: {
    type: String,
    enum: ['FN','AN',''],
    default: 'FN'
  },
  sections: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Seating', seatingSchema);

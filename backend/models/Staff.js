const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  designation: { type: String, trim: true, default: 'Assistant Professor' },
  subject:     { type: String, trim: true, default: '' },
  department:  { type: String, default: 'AI & Data Science' }
}, { timestamps: true });

staffSchema.index({ name: 1 });
staffSchema.index({ subject: 1 });

module.exports = mongoose.model('Staff', staffSchema);

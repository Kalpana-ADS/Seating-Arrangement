/**
 * Smart Allocation Utility
 * Suggests optimal invigilator allocations based on staff availability and duty limits
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Staff = require('../models/Staff');
const InvigilatorAllocation = require('../models/InvigilatorAllocation');

const DUTY_DAYS_MAP = {
  'Professor': 3,
  'Associate Professor': 4,
  'Assistant Professor G1': 5,
  'Assistant Professor LI': 6,
  'Assistant Professor': 5
};

/**
 * Get suggestions for allocating staff to an exam
 * @param {String} subject - Exam subject
 * @param {Number} countNeeded - Number of invigilators needed (default 50 for 6 days)
 * @param {String} batchId - Exam batch ID (YYYY-MM)
 */
const getSuggestions = async (subject, countNeeded = 8, batchId = null) => {
  try {
    // Get all staff
    const allStaff = await Staff.find().sort({ designation: 1, name: 1 });
    
    // Get current batch allocations
    const query = batchId ? { batchId } : {};
    const allocations = await InvigilatorAllocation.find(query);
    
    // Build duty map
    const dutyMap = {};
    allocations.forEach(alloc => {
      const dateStr = new Date(alloc.examDate).toLocaleDateString('en-IN');
      alloc.allocations.forEach(row => {
        if (!dutyMap[row.staffName]) {
          dutyMap[row.staffName] = {
            days: 0,
            dates: [],
            designation: row.designation
          };
        }
        if (!dutyMap[row.staffName].dates.includes(dateStr)) {
          dutyMap[row.staffName].dates.push(dateStr);
          dutyMap[row.staffName].days++;
        }
      });
    });
    
    // Categorize staff
    const term = subject.trim().toLowerCase();
    const suggestions = {
      highPriority: [],      // Can take more duties (0-50% used)
      medium: [],            // Moderately available (50-80% used)
      lowPriority: [],       // Limited availability (80-99% used)
      blocked: [],           // At limit
      excluded: []           // Teach this subject
    };
    
    allStaff.forEach(staff => {
      const dutyLimit = DUTY_DAYS_MAP[staff.designation] || 5;
      const dutyInfo = dutyMap[staff.name];
      const daysUsed = dutyInfo ? dutyInfo.days : 0;
      const isAtLimit = daysUsed >= dutyLimit;
      const percentUsed = (daysUsed / dutyLimit) * 100;
      
      // Check if teaches subject
      const staffSubject = (staff.subject || '').toLowerCase();
      const subjectParts = staffSubject.split(',').map(x => x.trim());
      const teachesSubject = subjectParts.some(
        part => part.includes(term) || term.includes(part)
      );
      
      if (teachesSubject) {
        suggestions.excluded.push({
          name: staff.name,
          designation: staff.designation,
          daysUsed,
          dutyLimit,
          reason: 'Teaches this subject'
        });
      } else if (isAtLimit) {
        suggestions.blocked.push({
          name: staff.name,
          designation: staff.designation,
          daysUsed,
          dutyLimit,
          reason: `Completed all ${dutyLimit} duty days`
        });
      } else if (percentUsed >= 80) {
        suggestions.lowPriority.push({
          name: staff.name,
          designation: staff.designation,
          daysUsed,
          dutyLimit,
          remaining: dutyLimit - daysUsed
        });
      } else if (percentUsed >= 50) {
        suggestions.medium.push({
          name: staff.name,
          designation: staff.designation,
          daysUsed,
          dutyLimit,
          remaining: dutyLimit - daysUsed
        });
      } else {
        suggestions.highPriority.push({
          name: staff.name,
          designation: staff.designation,
          daysUsed,
          dutyLimit,
          remaining: dutyLimit - daysUsed
        });
      }
    });
    
    // Sort by designation and availability
    const designationOrder = ['Professor', 'Associate Professor', 'Assistant Professor G1', 'Assistant Professor LI', 'Assistant Professor'];
    
    const sortBatch = (batch) => {
      return batch.sort((a, b) => {
        const aOrder = designationOrder.indexOf(a.designation);
        const bOrder = designationOrder.indexOf(b.designation);
        return aOrder - bOrder || b.remaining - a.remaining;
      });
    };
    
    // Apply sorting
    suggestions.highPriority = sortBatch(suggestions.highPriority);
    suggestions.medium = sortBatch(suggestions.medium);
    suggestions.lowPriority = sortBatch(suggestions.lowPriority);
    
    // Get total needs
    const totalAvailable = 
      suggestions.highPriority.length + 
      suggestions.medium.length + 
      suggestions.lowPriority.length;
    
    // Suggest allocation
    const recommended = [];
    let needed = countNeeded;
    
    // Fill from high priority first
    for (const staff of suggestions.highPriority) {
      if (needed > 0 && staff.remaining > 0) {
        recommended.push(staff);
        needed--;
      }
    }
    
    // Fill from medium priority
    for (const staff of suggestions.medium) {
      if (needed > 0 && staff.remaining > 0) {
        recommended.push(staff);
        needed--;
      }
    }
    
    // Fill from low priority if necessary
    for (const staff of suggestions.lowPriority) {
      if (needed > 0 && staff.remaining > 0) {
        recommended.push(staff);
        needed--;
      }
    }
    
    return {
      subject,
      countNeeded,
      batchId: batchId || 'current',
      suggestions,
      recommended,
      stats: {
        totalStaff: allStaff.length,
        totalAvailable,
        blocked: suggestions.blocked.length,
        excluded: suggestions.excluded.length,
        canFulfill: recommended.length >= countNeeded,
        shortfall: Math.max(0, countNeeded - recommended.length)
      }
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Analyze batch allocation efficiency
 */
const analyzeBatch = async (batchId) => {
  try {
    const allocations = await InvigilatorAllocation.find({ batchId });
    const allStaff = await Staff.find();
    
    const dutyMap = {};
    let totalDaySlots = 0;
    
    allocations.forEach(alloc => {
      const dateStr = new Date(alloc.examDate).toLocaleDateString('en-IN');
      alloc.allocations.forEach(row => {
        totalDaySlots++;
        if (!dutyMap[row.staffName]) {
          dutyMap[row.staffName] = {
            days: 0,
            dates: [],
            designation: row.designation,
            count: 0
          };
        }
        dutyMap[row.staffName].count++;
        if (!dutyMap[row.staffName].dates.includes(dateStr)) {
          dutyMap[row.staffName].dates.push(dateStr);
          dutyMap[row.staffName].days++;
        }
      });
    });
    
    // Group by designation
    const byDesignation = {};
    Object.entries(dutyMap).forEach(([name, info]) => {
      const d = info.designation;
      if (!byDesignation[d]) {
        byDesignation[d] = {
          totalAssigned: 0,
          totalDays: 0,
          staff: []
        };
      }
      byDesignation[d].totalAssigned += info.count;
      byDesignation[d].totalDays += info.days;
      byDesignation[d].staff.push({
        name,
        days: info.days,
        slots: info.count,
        limit: DUTY_DAYS_MAP[d] || 5
      });
    });
    
    // Calculate efficiency
    const totalAllocated = Object.values(dutyMap).length;
    const totalStaff = allStaff.length;
    
    return {
      batchId,
      totalExams: allocations.length,
      totalDaySlots,
      totalStaffUsed: totalAllocated,
      totalStaffAvailable: totalStaff,
      utilizationPercent: ((totalAllocated / totalStaff) * 100).toFixed(2),
      byDesignation,
      allocations: allocations.map(a => ({
        examName: a.examName,
        subject: a.subjectName,
        date: new Date(a.examDate).toLocaleDateString('en-IN'),
        session: a.session,
        count: a.allocations.length
      }))
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Generate allocation quality report
 */
const validateAllocationQuality = async (batchId) => {
  try {
    const allocations = await InvigilatorAllocation.find({ batchId });
    const issues = [];
    
    // Check for inconsistencies
    const nameSet = new Set();
    allocations.forEach(alloc => {
      alloc.allocations.forEach(row => {
        // Check for missing data
        if (!row.staffName) issues.push(`Missing staff name in ${alloc.examName}`);
        if (!row.designation) issues.push(`Missing designation for ${row.staffName} in ${alloc.examName}`);
        
        // Check for duplicates on same day
        const key = `${row.staffName}-${alloc.examDate}-${alloc.session}`;
        if (nameSet.has(key)) {
          issues.push(`Duplicate: ${row.staffName} assigned twice on ${new Date(alloc.examDate).toLocaleDateString('en-IN')} ${alloc.session}`);
        }
        nameSet.add(key);
      });
    });
    
    return {
      batchId,
      isValid: issues.length === 0,
      issueCount: issues.length,
      issues
    };
  } catch (err) {
    throw err;
  }
};

// Export functions
module.exports = {
  getSuggestions,
  analyzeBatch,
  validateAllocationQuality,
  DUTY_DAYS_MAP
};

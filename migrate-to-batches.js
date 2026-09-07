/**
 * Migration Script - Add batchId to existing allocations
 * Ensures all allocations have proper batch IDs for the smart allocation system
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, './.env') });

const InvigilatorAllocation = require('./backend/models/InvigilatorAllocation');

const migrateAllocationsToBatches = async () => {
  try {
    console.log('🔄 Migrating allocations to batch-based system...\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all allocations without batchId
    const allocsWithoutBatch = await InvigilatorAllocation.find({ batchId: { $in: ['', null] } });
    console.log(`📋 Found ${allocsWithoutBatch.length} allocations without batchId\n`);

    if (allocsWithoutBatch.length === 0) {
      console.log('✅ All allocations already have batchId!\n');
      process.exit(0);
    }

    // Update each allocation
    let updated = 0;
    let errors = 0;

    for (const alloc of allocsWithoutBatch) {
      try {
        // Generate batchId from exam date (YYYY-MM)
        const batchId = new Date(alloc.examDate).toISOString().slice(0, 7);
        
        // Update allocation
        await InvigilatorAllocation.findByIdAndUpdate(
          alloc._id,
          { batchId, assessment: 1 },
          { new: true }
        );

        updated++;
        console.log(`✅ Updated: ${alloc.examName} → batchId: ${batchId}`);
      } catch (err) {
        errors++;
        console.error(`❌ Error updating ${alloc.examName}:`, err.message);
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   • Updated: ${updated}/${allocsWithoutBatch.length}`);
    console.log(`   • Errors: ${errors}/${allocsWithoutBatch.length}`);

    if (errors === 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('✨ All allocations now have proper batch IDs.\n');
    } else {
      console.log(`\n⚠️  ${errors} allocation(s) failed to update.\n`);
    }

    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  }
};

if (require.main === module) {
  migrateAllocationsToBatches();
}

module.exports = { migrateAllocationsToBatches };

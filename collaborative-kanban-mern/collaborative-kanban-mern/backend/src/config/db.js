const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);

async function connectDB(uri = env.mongoUri) {
  await mongoose.connect(uri);
  // Make sure all declared indexes exist (unique constraints, tenant-scoped compound indexes).
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  console.log(`[db] connected to ${mongoose.connection.name}`);
  return mongoose.connection;
}

module.exports = connectDB;

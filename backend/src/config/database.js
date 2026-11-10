const mongoose = require('mongoose');
const { mongoUri } = require('./env');

async function connectToDatabase() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
}

module.exports = connectToDatabase;

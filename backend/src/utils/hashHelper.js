const bcrypt = require('bcryptjs');

// Cost factor 12: provides ~4x more work than 10, strongly resists brute-force
// Benchmark: ~250ms per hash on a typical server (acceptable for auth endpoints)
const SALT_ROUNDS = 12;

const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return await bcrypt.hash(password, salt);
};

const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

module.exports = {
  hashPassword,
  comparePassword
};


const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { signToken } = require('../middleware/auth.middleware');
const { listOrganizationsForUser } = require('../services/access.service');
const { z, parse } = require('../utils/validate');
const { asyncHandler, conflict, unauthorized } = require('../utils/errors');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = parse(registerSchema, req.body);
  if (await User.exists({ email })) throw conflict('An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash });
  res.status(201).json({ token: signToken(user), user: user.toJSON() });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await User.findOne({ email }).select('+passwordHash');
  // Same message for unknown email and wrong password (no account enumeration).
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Invalid email or password');
  }
  res.json({ token: signToken(user), user: user.toJSON() });
});

exports.me = asyncHandler(async (req, res) => {
  const organizations = await listOrganizationsForUser(req.user._id);
  res.json({ user: req.user.toJSON(), organizations });
});

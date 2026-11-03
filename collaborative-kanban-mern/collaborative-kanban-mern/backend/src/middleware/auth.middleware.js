const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User } = require('../models');
const { unauthorized, asyncHandler } = require('../utils/errors');

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), name: user.name }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

/** Verify a JWT and load the user. Shared by REST and Socket.IO. */
async function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    return await User.findById(payload.sub);
  } catch {
    return null;
  }
}

/** Require `Authorization: Bearer <jwt>` on protected routes. */
const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = await userFromToken(token);
  if (!user) throw unauthorized('Invalid or expired token');
  req.user = user;
  next();
});

module.exports = { signToken, userFromToken, requireAuth };

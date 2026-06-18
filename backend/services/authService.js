const User = require("../models/User");
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require("../utils/tokenUtils");

// ─── FIX: The root cause of "Invalid email or password" even with correct creds ──
// When user.save({ validateBeforeSave: false }) was called to persist refreshToken,
// Mongoose was triggering the pre-save hook which re-hashed an already-hashed password
// because the 'password' field was marked modified from the initial create().
// Solution: use findByIdAndUpdate() for token-only saves to completely bypass the hook.

async function registerUser({ name, email, password }) {
  const existing = await User.findOne({ email });
  if (existing) {
    const err = new Error("An account with this email already exists.");
    err.statusCode = 409;
    throw err;
  }

  // Create user — pre-save hook will hash the password once
  const user = await User.create({ name, email, password });

  const accessToken  = generateAccessToken({ id: user._id, email: user.email });
  const refreshToken = generateRefreshToken({ id: user._id });

  // ✅ Use findByIdAndUpdate to save refreshToken — bypasses pre-save hook entirely
  await User.findByIdAndUpdate(user._id, { refreshToken });

  return { user: user.toPublic(), accessToken, refreshToken };
}

async function loginUser({ email, password }) {
  // Must select("+password") because it has select:false
  const user = await User.findOne({ email }).select("+password");

  if (!user || !user.isActive) {
    const err = new Error("Invalid email or password.");
    err.statusCode = 401;
    throw err;
  }

  const match = await user.comparePassword(password);
  if (!match) {
    const err = new Error("Invalid email or password.");
    err.statusCode = 401;
    throw err;
  }

  const accessToken  = generateAccessToken({ id: user._id, email: user.email });
  const refreshToken = generateRefreshToken({ id: user._id });

  // ✅ Use findByIdAndUpdate — does NOT trigger pre-save password hook
  await User.findByIdAndUpdate(user._id, { refreshToken, lastLoginAt: new Date() });

  return { user: user.toPublic(), accessToken, refreshToken };
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    const err = new Error("Refresh token is required."); err.statusCode = 401; throw err;
  }

  let decoded;
  try { decoded = verifyRefreshToken(refreshToken); }
  catch {
    const err = new Error("Invalid or expired refresh token. Please log in again.");
    err.statusCode = 401; throw err;
  }

  const user = await User.findById(decoded.id).select("+refreshToken");
  if (!user || user.refreshToken !== refreshToken || !user.isActive) {
    const err = new Error("Session invalid. Please log in again."); err.statusCode = 401; throw err;
  }

  const newAccessToken  = generateAccessToken({ id: user._id, email: user.email });
  const newRefreshToken = generateRefreshToken({ id: user._id });

  // ✅ findByIdAndUpdate — no pre-save hook
  await User.findByIdAndUpdate(user._id, { refreshToken: newRefreshToken });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

async function logoutUser(userId) {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
}

async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) { const err = new Error("User not found."); err.statusCode = 404; throw err; }
  return user.toPublic();
}

async function updateProfile(userId, { name, avatar }) {
  const updates = {};
  if (name   !== undefined) updates.name   = name;
  if (avatar !== undefined) updates.avatar = avatar;
  const user = await User.findByIdAndUpdate(userId, updates, { new: true, runValidators: true });
  if (!user) { const err = new Error("User not found."); err.statusCode = 404; throw err; }
  return user.toPublic();
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select("+password");
  if (!user) { const err = new Error("User not found."); err.statusCode = 404; throw err; }

  const match = await user.comparePassword(currentPassword);
  if (!match) {
    const err = new Error("Current password is incorrect."); err.statusCode = 400; throw err;
  }

  // Direct save IS correct here — we want to re-hash the new password
  user.password     = newPassword;
  user.refreshToken = null;
  await user.save();
}

module.exports = { registerUser, loginUser, refreshAccessToken, logoutUser, getMe, updateProfile, changePassword };

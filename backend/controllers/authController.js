const svc = require("../services/authService");
const { sendSuccess, sendCreated, sendNoContent } = require("../utils/apiResponse");
const { body } = require("express-validator");
const { validate } = require("../middleware/validators");

async function register(req, res, next) {
  try {
    const result = await svc.registerUser(req.body);
    return sendCreated(res, result, "Account created successfully.");
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const result = await svc.loginUser(req.body);
    return sendSuccess(res, result, "Logged in successfully.");
  } catch (err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const tokens = await svc.refreshAccessToken(req.body.refreshToken);
    return sendSuccess(res, tokens, "Token refreshed.");
  } catch (err) { next(err); }
}

async function logout(req, res, next) {
  try {
    await svc.logoutUser(req.user._id);
    return sendNoContent(res);
  } catch (err) { next(err); }
}

async function getMe(req, res, next) {
  try {
    const user = await svc.getMe(req.user._id);
    return sendSuccess(res, user);
  } catch (err) { next(err); }
}

async function updateProfile(req, res, next) {
  try {
    const user = await svc.updateProfile(req.user._id, req.body);
    return sendSuccess(res, user, "Profile updated.");
  } catch (err) { next(err); }
}

async function changePassword(req, res, next) {
  try {
    await svc.changePassword(req.user._id, req.body);
    return sendSuccess(res, null, "Password changed. Please log in again.");
  } catch (err) { next(err); }
}

module.exports = { register, login, refresh, logout, getMe, updateProfile, changePassword };

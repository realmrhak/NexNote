const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/noteController");
const { protect } = require("../middleware/auth");
const { validate, sanitize, noteRules, noteQueryRules, mongoIdParam } = require("../middleware/validators");

// Public
router.get("/shared/:token", ctrl.getSharedNote);

// Protected
router.use(protect);
router.get("/",         noteQueryRules, validate, ctrl.getNotes);
router.get("/tags",     ctrl.getTags);
router.get("/:id",      mongoIdParam("id"), validate, ctrl.getNoteById);
router.post("/",        sanitize, noteRules, validate, ctrl.createNote);
router.patch("/:id",    mongoIdParam("id"), sanitize, noteRules, validate, ctrl.updateNote);
router.delete("/:id",   mongoIdParam("id"), validate, ctrl.deleteNote);
router.patch("/:id/pin",    mongoIdParam("id"), validate, ctrl.togglePin);
router.post("/:id/share",   mongoIdParam("id"), validate, ctrl.shareNote);
router.delete("/:id/share", mongoIdParam("id"), validate, ctrl.unshareNote);

module.exports = router;

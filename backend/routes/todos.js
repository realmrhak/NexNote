const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/todoController");
const { protect }  = require("../middleware/auth");
const { validate, sanitize, todoRules, todoUpdateRules, mongoIdParam } = require("../middleware/validators");

router.use(protect);

router.get("/",          ctrl.getTodos);
router.get("/stats",     ctrl.getTodoStats);
router.get("/:id",       mongoIdParam("id"), validate, ctrl.getTodoById);
router.post("/",         sanitize, todoRules,   validate, ctrl.createTodo);
router.patch("/:id",     mongoIdParam("id"), sanitize, todoUpdateRules, validate, ctrl.updateTodo);
router.delete("/:id",    mongoIdParam("id"), validate, ctrl.deleteTodo);
router.patch("/:id/toggle", mongoIdParam("id"), validate, ctrl.toggleTodo);

module.exports = router;

const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/folderController");
const { protect } = require("../middleware/auth");
const { validate, sanitize, folderRules, folderUpdateRules, mongoIdParam } = require("../middleware/validators");

router.use(protect);
router.get("/",       ctrl.getFolders);
router.get("/:id",    mongoIdParam("id"), validate, ctrl.getFolderById);
router.post("/",      sanitize, folderRules,       validate, ctrl.createFolder);
router.patch("/:id",  mongoIdParam("id"), sanitize, folderUpdateRules, validate, ctrl.updateFolder);
router.delete("/:id", mongoIdParam("id"), validate, ctrl.deleteFolder);

module.exports = router;

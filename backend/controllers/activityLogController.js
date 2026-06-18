const svc = require("../services/activityLogService");
const { sendSuccess } = require("../utils/apiResponse");

async function getTeamLogs(req, res, next) {
  try {
    const { page = 1, limit = 100 } = req.query;
    const { logs, meta } = await svc.getTeamLogs(req.params.teamId, req.user._id, { page, limit });
    return sendSuccess(res, logs, "OK", 200, meta);
  } catch (err) { next(err); }
}

module.exports = { getTeamLogs };

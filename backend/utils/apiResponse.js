function sendSuccess(res, data = null, message = "OK", statusCode = 200, meta = null) {
  const body = { success: true, message };
  if (data !== null) body.data = data;
  if (meta !== null) body.meta = meta;
  return res.status(statusCode).json(body);
}

function sendError(res, message = "An error occurred", statusCode = 400, errors = null) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

function sendCreated(res, data, message = "Created successfully") {
  return sendSuccess(res, data, message, 201);
}

function sendNoContent(res) {
  return res.status(204).send();
}

module.exports = { sendSuccess, sendError, sendCreated, sendNoContent };

const { z } = require('zod');
const mongoose = require('mongoose');
const { badRequest, notFound } = require('./errors');

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v), {
  message: 'Invalid id',
});

/** Parse `data` with a zod schema or throw a 400 with field errors. */
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest('Validation failed', { errors });
  }
  return result.data;
}

/** Validate a route param id; unknown/malformed ids are treated as "not found". */
function idParam(value, label = 'Resource') {
  if (!objectId.safeParse(value).success) throw notFound(`${label} not found`);
  return value;
}

module.exports = { z, objectId, parse, idParam };

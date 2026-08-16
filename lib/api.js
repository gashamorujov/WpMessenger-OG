/**
 * Small helpers for Route Handlers.
 */
const { NextResponse } = require('next/server');

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function fail(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

module.exports = { json, fail };

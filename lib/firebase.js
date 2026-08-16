/**
 * Firebase Realtime Database client — the ONLY persistence layer.
 *
 * All app data (users, sessions, contacts, jobs, settings, WhatsApp state)
 * and realtime events live under /wpm/* in Firebase Realtime Database.
 * Transports:
 *   - rest (default): HTTPS REST API against the configured databaseURL
 *   - memory://       in-process JSON tree (unit tests, offline dev)
 *   - file:///path    JSON file tree (shared integration tests, offline dev)
 *
 * No local SQL files, no ./data folder, no PostgreSQL, no native modules —
 * deploys cleanly on serverless and any platform with network access.
 */
const crypto = require('crypto');
const config = require('./config');

const EVENTS_PATH = 'wpm/events';

function dbUrl() {
  return String(config.firebase.databaseURL || '').replace(/\/+$/, '');
}

function transportKind() {
  const u = String(config.firebase.databaseURL || '');
  if (u === 'memory://' || u.startsWith('memory:')) return 'memory';
  if (u.startsWith('file:')) return 'file';
  return 'rest';
}

function endpoint(path, query = '') {
  const p = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${dbUrl()}/${p}.json${query}`;
}

function splitPath(path) {
  return String(path || '').split('/').filter(Boolean).map(decodeURIComponent);
}

function filePath() {
  const u = String(config.firebase.databaseURL || '').replace(/^file:\/\//, '');
  return decodeURIComponent(u);
}

// ─── JSON tree helpers (memory + file transports) ───

const memTree = {};

function getAt(node, parts) {
  let cur = node;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setAt(node, parts, value) {
  if (!parts.length) return value;
  const [head, ...rest] = parts;
  if (!rest.length) {
    if (value === null || value === undefined) delete node[head];
    else node[head] = value;
    return node;
  }
  if (typeof node[head] !== 'object' || node[head] === null) node[head] = {};
  setAt(node[head], rest, value);
  return node;
}

function updateAt(node, parts, patch) {
  if (!parts.length) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === null || v === undefined) delete node[k];
      else node[k] = v;
    }
    return node;
  }
  const [head, ...rest] = parts;
  if (typeof node[head] !== 'object' || node[head] === null) node[head] = {};
  updateAt(node[head], rest, patch);
  return node;
}

/** Buffer-aware JSON round-trip (Baileys auth state stores Buffer fields). */
function stripBuffers(value) {
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: Array.from(value) };
  if (Array.isArray(value)) return value.map(stripBuffers);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripBuffers(v);
    return out;
  }
  return value;
}

function restoreBuffers(value) {
  if (Array.isArray(value)) return value.map(restoreBuffers);
  if (value && typeof value === 'object') {
    if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = restoreBuffers(v);
    return out;
  }
  return value;
}

async function localTree() {
  if (transportKind() === 'memory') return memTree;
  const fs = require('fs');
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf-8')) || {};
  } catch {
    return {};
  }
}

async function saveLocalTree(tree) {
  if (transportKind() === 'memory') return;
  const fs = require('fs');
  fs.mkdirSync(require('path').dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(tree));
}

function _memoryReset() {
  for (const k of Object.keys(memTree)) delete memTree[k];
}

// ─── Public store API (mirrors RTDB REST semantics) ───

/** GET path.json — returns the value or null when missing. */
async function get(path) {
  const parts = splitPath(path);
  if (transportKind() === 'rest') {
    const res = await fetch(endpoint(path), { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firebase GET ${path} failed: ${res.status}`);
    const data = await res.json().catch(() => null);
    return restoreBuffers(data);
  }
  return restoreBuffers(getAt(await localTree(), parts) ?? null);
}

/** PUT path.json — replaces the node. */
async function set(path, value) {
  const parts = splitPath(path);
  const body = JSON.stringify(stripBuffers(value));
  if (transportKind() === 'rest') {
    const res = await fetch(endpoint(path), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Firebase PUT ${path} failed: ${res.status}`);
    return;
  }
  const tree = await localTree();
  setAt(tree, parts, value === null ? null : stripBuffers(value));
  await saveLocalTree(tree);
}

/** PATCH path.json — shallow merge; null values delete keys. */
async function update(path, value) {
  const parts = splitPath(path);
  const body = JSON.stringify(stripBuffers(value));
  if (transportKind() === 'rest') {
    const res = await fetch(endpoint(path), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Firebase PATCH ${path} failed: ${res.status}`);
    return;
  }
  const tree = await localTree();
  updateAt(tree, parts, stripBuffers(value));
  await saveLocalTree(tree);
}

/** POST path.json — creates a child key; returns the new key. */
async function push(path, value) {
  const parts = splitPath(path);
  if (transportKind() === 'rest') {
    const res = await fetch(endpoint(path), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripBuffers(value)),
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Firebase POST ${path} failed: ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return (data && data.name) || null;
  }
  const tree = await localTree();
  const key = '-' + crypto.randomBytes(10).toString('hex');
  setAt(tree, [...parts, key], stripBuffers(value));
  await saveLocalTree(tree);
  return key;
}

/** DELETE path.json — removes the node. */
async function remove(path) {
  const parts = splitPath(path);
  if (transportKind() === 'rest') {
    const res = await fetch(endpoint(path), { method: 'DELETE', signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) throw new Error(`Firebase DELETE ${path} failed: ${res.status}`);
    return;
  }
  const tree = await localTree();
  setAt(tree, parts, null);
  await saveLocalTree(tree);
}

/** Publish one realtime event to /wpm/events (SPA listens via Firebase SDK). */
async function publish(type, data) {
  if (!config.firebase.enabled || !dbUrl()) return false;
  try {
    await push(EVENTS_PATH, { type, data: data === undefined ? null : data, ts: Date.now() });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  get, set, update, push, remove, publish,
  endpoint, dbUrl, transportKind, EVENTS_PATH,
  stripBuffers, restoreBuffers, _memoryReset,
};

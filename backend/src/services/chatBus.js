/**
 * @file chatBus.js
 * @description Wakes the requests waiting for news in a chat channel.
 *
 * Reading a channel may wait (long poll) until something new is written or
 * removed. Writers call `publish(channelId)` once their change is stored:
 * waiters on this instance wake at once, and a Postgres NOTIFY wakes the
 * other instances, which LISTEN on a connection of their own. A wake-up only
 * says "look again"; the messages are always read from the database, so a
 * lost or doubled notification costs a moment, never a message.
 *
 * Env: CHAT_PG_LISTEN=off keeps this instance to its own waiters (a single
 * instance does not need the database, and some connection poolers in
 * transaction mode cannot LISTEN).
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Client } = require('pg');
const db = require('../config/db');

const PG_CHANNEL = 'hackos_chat';
const INSTANCE = crypto.randomBytes(6).toString('hex');
const CLOSE = Symbol('close');

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let listener = null;
let connecting = false;
let closed = false;
let retryMs = 1000;

const listenEnabled = () => String(process.env.CHAT_PG_LISTEN || 'on').trim().toLowerCase() !== 'off';

function scheduleReconnect() {
  if (closed) return;
  const wait = retryMs;
  retryMs = Math.min(retryMs * 2, 60_000);
  setTimeout(() => { startListening(); }, wait).unref();
}

/** Opens the LISTEN connection; failures are logged and retried, never thrown. */
async function startListening() {
  if (listener || connecting || closed || !listenEnabled() || !process.env.DATABASE_URL) return;
  connecting = true;
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: db.getSslOption() });
  client.on('notification', (msg) => {
    const [from, id] = String(msg.payload || '').split(':');
    if (from !== INSTANCE && id) emitter.emit(id);
  });
  client.on('error', (err) => {
    console.error('[chat] listen connection lost:', err.message);
    if (listener === client) listener = null;
    client.end().catch(() => {});
    scheduleReconnect();
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${PG_CHANNEL}`);
    listener = client;
    retryMs = 1000;
  } catch (err) {
    console.error('[chat] listen unavailable:', err.message);
    client.end().catch(() => {});
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

/** Something changed in the channel: wake its readers here and elsewhere. */
function publish(channelId) {
  const key = String(channelId);
  emitter.emit(key);
  if (listenEnabled()) {
    db.query('SELECT pg_notify($1, $2)', [PG_CHANNEL, `${INSTANCE}:${key}`]).catch(() => {});
  }
}

/**
 * Resolves true when the channel has news, false after `ms`, when the
 * caller goes away (`res` closes: the request's own 'close' fires as soon as
 * its body is read) or when the server stops.
 */
function waitFor(channelId, ms, res = null) {
  startListening();
  return new Promise((resolve) => {
    const key = String(channelId);
    let done = false;
    let timer = null;
    const finish = (woken) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      emitter.off(key, onNews);
      emitter.off(CLOSE, onStop);
      if (res) res.off('close', onStop);
      resolve(woken);
    };
    const onNews = () => finish(true);
    const onStop = () => finish(false);
    timer = setTimeout(onStop, ms);
    emitter.on(key, onNews);
    emitter.on(CLOSE, onStop);
    if (res) res.on('close', onStop);
  });
}

/** Lets every waiting request go and closes the LISTEN connection (shutdown). */
function close() {
  closed = true;
  emitter.emit(CLOSE);
  if (listener) listener.end().catch(() => {});
  listener = null;
}

/** For the owner's health page: across instances or not, and how many readers wait now. */
function status() {
  const waiting = emitter.eventNames().reduce((n, name) => (name === CLOSE ? n : n + emitter.listenerCount(name)), 0);
  return { crossInstance: Boolean(listener), listenEnabled: listenEnabled(), waiting };
}

module.exports = { publish, waitFor, close, status };

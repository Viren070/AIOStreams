// Fetches for the page what CORS keeps from it, and serves what the page
// made to a player, which reads an address but not the page's own memory.
// It only moves bytes; the page decides what an answer means. Written for
// the Node a webOS 23 TV runs.
'use strict';

const Service = require('webos-service');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const service = new Service('io.github.viren070.aiostreams.service');

const MAX_REDIRECTS = 8;
const TIMEOUT_MS = 20000;
// Answers cross the bus as JSON, so bytes go as base64 in pieces.
const PIECE = 256 * 1024;
const agents = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
};
// By the call that asked, so a cancelled call stops its fetch.
const running = {};

// Authorization only goes to the host it was given for, and a body only on
// through a 307 or 308.
function get(address, ask, hops, answer, failed) {
  const { headers, method, body } = ask;
  let target;
  try {
    target = new URL(address);
  } catch (error) {
    return failed(error);
  }
  const lib = { 'http:': http, 'https:': https }[target.protocol];
  if (!lib) return failed(new Error('Only http and https can be read'));
  const request = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method,
      headers:
        body === undefined
          ? headers
          : Object.assign({}, headers, {
              'Content-Length': Buffer.byteLength(body),
            }),
      agent: agents[target.protocol],
    },
    (response) => {
      const status = response.statusCode;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (hops >= MAX_REDIRECTS)
          return failed(new Error('Too many redirects'));
        const next = new URL(location, target).href;
        const kept = {};
        for (const name of Object.keys(headers))
          if (
            new URL(next).host === target.host ||
            name.toLowerCase() !== 'authorization'
          )
            kept[name] = headers[name];
        const again = status === 307 || status === 308;
        return get(
          next,
          {
            headers: kept,
            method: again ? method : 'GET',
            body: again ? body : undefined,
          },
          hops + 1,
          answer,
          failed
        );
      }
      answer(response, target.href, hops > 0, request);
    }
  );
  request.setTimeout(TIMEOUT_MS, () =>
    request.destroy(new Error('The host did not answer in time'))
  );
  request.on('error', failed);
  request.end(body);
  return request;
}

// Takes { url, headers, method, body } with `subscribe`. Answers with the
// status, where the bytes came from and Retry-After, then the body in base64
// pieces, then { done: true }.
service.register(
  'fetch',
  (message) => {
    const { url, headers, method, body } = message.payload || {};
    const token = message.uniqueToken;
    // Numbered, so the page can drop an answer the bus repeats.
    let sent = 0;
    const respond = (answer) =>
      message.respond(Object.assign({ n: sent++ }, answer));
    let finished = false;
    const finish = (answer) => {
      if (finished) return;
      finished = true;
      delete running[token];
      respond(answer);
    };
    // The page tells these from a service that isn't there.
    const fail = (error) =>
      finish({
        returnValue: false,
        fetchFailed: true,
        errorText: error.message,
      });
    if (typeof url !== 'string') return fail(new Error('A url is needed'));
    get(
      url,
      {
        headers: Object.assign({}, headers),
        method: method || 'GET',
        body: typeof body === 'string' ? body : undefined,
      },
      0,
      (response, landed, redirected, request) => {
        running[token] = request;
        respond({
          returnValue: true,
          status: response.statusCode,
          url: landed,
          redirected,
          retryAfter: response.headers['retry-after'] || null,
          contentRange: response.headers['content-range'] || null,
        });
        let held = [];
        let size = 0;
        const send = () => {
          if (!size) return;
          respond({
            returnValue: true,
            data: Buffer.concat(held, size).toString('base64'),
          });
          held = [];
          size = 0;
        };
        response.on('data', (chunk) => {
          held.push(chunk);
          size += chunk.length;
          if (size >= PIECE) send();
        });
        response.on('end', () => {
          send();
          finish({ returnValue: true, done: true });
        });
        // A body cut off ends early; the page asks again for what is missing.
        response.on('aborted', () => {
          send();
          finish({ returnValue: true, done: true });
        });
        response.on('error', fail);
      },
      fail
    );
  },
  (message) => {
    const request = running[message.uniqueToken];
    delete running[message.uniqueToken];
    if (request) request.destroy();
  }
);

// The page keeps one of these open, which holds the service up: an idle
// one is killed, and with it the loopback its served playlists read from.
service.register('hold', (message) => {
  message.respond({ returnValue: true, held: true });
});

// What the page made, kept to be read by a player that reads an address but
// not the page's own memory. The oldest goes when the cap is hit; a playlist
// is small, and its links expire in hours anyway.
const SERVED_MAX = 64;
const served = new Map();
// The loopback server, once bound; the asks waiting for it to bind.
let listener = null;
let binding = null;

// Binds the loopback the made playlists are read from, on the TV itself so
// nothing else can, and answers every waiting ask from it.
function startBinding() {
  const waiting = [];
  const server = http.createServer(function (ask, reply) {
    const held = served.get(ask.url.split('?')[0]);
    if (!held) {
      reply.writeHead(404);
      return reply.end();
    }
    reply.writeHead(200, {
      'Content-Type': held.type,
      'Content-Length': Buffer.byteLength(held.text),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    reply.end(held.text);
  });
  let settled = false;
  server.on('error', function (error) {
    if (!settled) {
      // A bind that failed leaves its asks to the page's own fallback.
      settled = true;
      binding = null;
      for (let i = 0; i < waiting.length; i++) waiting[i].fail(error);
      return;
    }
    // A server that died after it bound kills the addresses it gave out,
    // which the page falls back from too.
    if (listener === server) listener = null;
  });
  server.listen(0, '127.0.0.1', function () {
    if (settled) return;
    settled = true;
    listener = server;
    binding = null;
    for (let i = 0; i < waiting.length; i++)
      waiting[i].give(server.address().port);
  });
  binding = waiting;
}

// Takes { text, type }, what the page made and the type to serve it as, and
// answers with the address a player reads it from.
service.register('serve', (message) => {
  const { text, type } = message.payload || {};
  let settled = false;
  const respond = (answer) => {
    if (settled) return;
    settled = true;
    message.respond(answer);
  };
  const fail = (error) =>
    respond({ returnValue: false, errorText: error.message });
  if (typeof text !== 'string' || typeof type !== 'string')
    return fail(new Error('Text and a type are needed'));
  const give = (port) => {
    if (served.size >= SERVED_MAX)
      served.delete(served.keys().next().value);
    // A name no one can guess, ending in the playlist's own ending.
    const token = crypto.randomBytes(16).toString('hex');
    served.set('/t/' + token + '.m3u8', { text: text, type: type });
    respond({
      returnValue: true,
      url: 'http://127.0.0.1:' + port + '/t/' + token + '.m3u8',
    });
  };
  if (listener) return give(listener.address().port);
  if (!binding) startBinding();
  binding.push({ give: give, fail: fail });
});

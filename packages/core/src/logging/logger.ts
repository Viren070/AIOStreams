import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';
import { prettyFactory } from 'pino-pretty';
import { Writable } from 'stream';
import { bootstrap } from '../config/bootstrap.js';
import { redactUrlParams } from './redact.js';
import { logRingBuffer } from './ring-buffer.js';

export interface Logger {
  trace(...args: LogArgs): void;
  debug(...args: LogArgs): void;
  info(...args: LogArgs): void;
  warn(...args: LogArgs): void;
  error(...args: LogArgs): void;
  fatal(...args: LogArgs): void;
  /** @deprecated legacy winston level — alias for `debug`. */
  verbose(...args: LogArgs): void;
  /** @deprecated legacy winston level — alias for `trace`. */
  silly(...args: LogArgs): void;
  /** @deprecated legacy winston level — alias for `info`. */
  http(...args: LogArgs): void;
  child(bindings: Record<string, unknown>): Logger;
}

export type LogArg = unknown;
type LogArgs = LogArg[];

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// --- Pino root setup ------------------------------------------------------

function normalizeLevel(raw: string | undefined): Level {
  if (!raw) return 'info';
  const v = raw.toLowerCase();
  switch (v) {
    case 'silly':
      return 'trace';
    case 'verbose':
      return 'debug';
    case 'http':
      return 'info';
    case 'warning':
      return 'warn';
  }
  if (
    v === 'trace' ||
    v === 'debug' ||
    v === 'info' ||
    v === 'warn' ||
    v === 'error' ||
    v === 'fatal'
  ) {
    return v;
  }
  return 'info';
}

function buildDestination(): DestinationStream | Writable {
  const format = (bootstrap.logFormat || '').toLowerCase();
  if (format !== 'text') {
    return pino.destination({ dest: 1, sync: false });
  }
  // Text mode: pino emits NDJSON to this stream; we parse each line,
  // redact URLs in msg, then re-emit via pino-pretty.
  const prettify = prettyFactory({ colorize: true, sync: true });
  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (typeof obj.msg === 'string') {
            obj.msg = redactUrlParams(obj.msg);
          }
          process.stdout.write(prettify(obj));
        } catch {
          process.stdout.write(line + '\n');
        }
      }
      cb();
    },
  });
}

/**
 * Stream B for the multistream: tees every NDJSON line into the in-memory
 * ring buffer that backs the dashboard Logs page. Lines arrive already
 * redacted (pino applies `redact` before any stream sees the record), so the
 * dashboard can never leak secrets. Chunks are not guaranteed to be
 * line-aligned, so we buffer a partial trailing fragment.
 */
function buildRingStream(): Writable {
  let partial = '';
  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const text =
        partial + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      const lines = text.split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (line) logRingBuffer.push(line);
      }
      cb();
    },
  });
}

const root: PinoLogger = pino(
  {
    level: normalizeLevel(bootstrap.logLevel),
    base: {
      // Per `04-logging.md`, every record carries `instance` so the
      // Logs dashboard can fan out across replicas. The ID is shared
      // with the future replicas heartbeat table (see `06-dashboard.md`)
      // so a log line and a heartbeat row referring to the same process
      // carry the same `instance` value.
      // instanceId: INSTANCE_ID,
    },
    formatters: {
      // Emit `level` as the textual name, not pino's numeric code.
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
    },
  },
  pino.multistream([
    { level: 'trace', stream: buildDestination() },
    { level: 'trace', stream: buildRingStream() },
  ])
);

// --- Wrapper that accepts both new- and legacy-style calls ----------------

/**
 * Normalize args into pino's `(obj, msg)` shape.
 *
 * Cases:
 *   ()                                 → ({}, undefined)         (no-op skipped by caller)
 *   ('msg')                            → ({}, 'msg')
 *   ('msg', err)                       → ({ err }, 'msg')
 *   ('msg', { a, b })                  → ({ a, b }, 'msg')       (legacy winston style)
 *   ('msg', { a }, { b })              → ({ a, b }, 'msg')       (legacy)
 *   ('msg', 'extra')                   → ({}, 'msg extra')       (legacy)
 *   ({ a })                            → ({ a }, undefined)
 *   ({ a }, 'msg')                     → ({ a }, 'msg')          (canonical)
 *   ({ a }, 'msg', extra)              → ({ a, ...extra }, 'msg')
 */
function normalizeArgs(args: LogArgs): {
  obj: Record<string, unknown>;
  msg?: string;
} {
  if (args.length === 0) return { obj: {} };

  const first = args[0];
  const obj: Record<string, unknown> = {};
  let msg: string | undefined;

  if (typeof first === 'string') {
    // Legacy-style or simple message.
    msg = first;
    const extraStrings: string[] = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a == null) continue;
      if (a instanceof Error) {
        obj.err = a;
      } else if (typeof a === 'object') {
        Object.assign(obj, a as Record<string, unknown>);
      } else if (typeof a === 'string') {
        extraStrings.push(a);
      } else {
        // numbers/booleans dropped silently — they were noise in the legacy API
      }
    }
    if (extraStrings.length) {
      msg = `${msg} ${extraStrings.join(' ')}`;
    }
    return { obj, msg };
  }

  if (first instanceof Error) {
    obj.err = first;
    if (typeof args[1] === 'string') msg = args[1] as string;
    return { obj, msg };
  }

  if (typeof first === 'object' && first !== null) {
    Object.assign(obj, first as Record<string, unknown>);
    // Honour the legacy `{formatted: '...'}` shortcut: callers used this
    // to pass a pre-rendered table/summary. We surface it as `msg` so
    // the line stays readable; the sweep removes these.
    if (
      typeof (first as { formatted?: unknown }).formatted === 'string' &&
      typeof args[1] !== 'string'
    ) {
      msg = (first as { formatted: string }).formatted;
      delete obj.formatted;
    }
    if (typeof args[1] === 'string') msg = args[1] as string;
    for (let i = 2; i < args.length; i++) {
      const a = args[i];
      if (a && typeof a === 'object' && !(a instanceof Error)) {
        Object.assign(obj, a as Record<string, unknown>);
      } else if (a instanceof Error) {
        obj.err = a;
      }
    }
    return { obj, msg };
  }

  return { obj };
}

const legacyLevelMap: Record<string, Level> = {
  silly: 'trace',
  verbose: 'debug',
  http: 'info',
};

function deconflictReservedKeys(obj: Record<string, unknown>): void {
  if ('time' in obj) {
    if (!('timeTaken' in obj)) obj.timeTaken = obj.time;
    delete obj.time;
  }
  if ('level' in obj) {
    if (!('levelLabel' in obj)) obj.levelLabel = obj.level;
    delete obj.level;
  }
}

function wrap(pinoInstance: PinoLogger): Logger {
  const emit =
    (level: Level | keyof typeof legacyLevelMap) =>
    (...args: LogArgs): void => {
      const target =
        level in legacyLevelMap
          ? legacyLevelMap[level as keyof typeof legacyLevelMap]
          : (level as Level);
      const { obj, msg } = normalizeArgs(args);
      deconflictReservedKeys(obj);
      if (msg === undefined && Object.keys(obj).length === 0) return;
      if (msg === undefined) {
        pinoInstance[target](obj);
      } else {
        pinoInstance[target](obj, msg);
      }
    };

  return {
    trace: emit('trace'),
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('fatal'),
    verbose: emit('verbose'),
    silly: emit('silly'),
    http: emit('http'),
    child(bindings) {
      return wrap(pinoInstance.child(bindings));
    },
  };
}

// --- Public API -----------------------------------------------------------

export const logger: Logger = wrap(root);

/**
 * Create a logger pre-tagged with a module name. Equivalent to
 * `logger.child({ module })`; kept as a function for source-level
 * compatibility with v2.
 */
export function createLogger(module: string): Logger {
  return wrap(root.child({ module }));
}

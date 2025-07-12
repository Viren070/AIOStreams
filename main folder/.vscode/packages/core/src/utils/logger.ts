import winston from 'winston';
import moment from 'moment-timezone';
import { Env } from './env';

// Map log levels to their full names
const levelMap: { [key: string]: string } = {
  error: 'ERROR',
  warn: 'WARNING',
  info: 'INFO',
  debug: 'DEBUG',
  verbose: 'VERBOSE',
  silly: 'SILLY',
  http: 'HTTP',
};

const moduleMap: { [key: string]: string } = {
  startup: '🚀  STARTUP',
  server: '🌐  SERVER',
  wrappers: '📦  WRAPPERS',
  crypto: '🔒  CRYPTO',
  core: '⚡  CORE',
  parser: '🔍  PARSER',
  mediaflow: '🌊  MEDIAFLOW',
  stremthru: '✨  STREMTHRU',
  cache: '🗄️  CACHE',
  regex: '🅰️  REGEX',
  database: '🗃️  DATABASE',
  users: '👤  USERS',
  http: '🌐  HTTP',
  proxy: '🚀 PROXY',
  stremio: '🎥 STREMIO',
  deduplicator: '🎯  DEDUPLICATOR',
  limiter: '⚖️  LIMITER',
  filterer: '🗑️  FILTERER',
  precomputer: '🧮  PRECOMPUTER',
  sorter: '📊  SORTER',
  proxifier: '🔀  PROXIFIER',
  fetcher: '🔎  SCRAPER',
};

// Define colors for each log level using full names
const levelColors: { [key: string]: string } = {
  ERROR: 'red',
  WARNING: 'yellow',
  INFO: 'cyan',
  DEBUG: 'magenta',
  HTTP: 'green',
  VERBOSE: 'blue',
  SILLY: 'grey',
};

const emojiLevelMap: { [key: string]: string } = {
  error: '❌',
  warn: '⚠️ ',
  info: '🔵',
  debug: '🐞',
  verbose: '🔍',
  silly: '🤪',
  http: '🌐',
};

// Calculate the maximum level name length for padding
const MAX_LEVEL_LENGTH = Math.max(
  ...Object.values(levelMap).map((level) => level.length)
);

// Apply colors to Winston
winston.addColors(levelColors);

export const createLogger = (module: string) => {
  const isJsonFormat = Env.LOG_FORMAT === 'json';
  const timezone = Env.LOG_TIMEZONE;

  const timestampFormat = winston.format((info) => {
    info.timestamp = moment().tz(timezone).format('YYYY-MM-DD HH:mm:ss.SSS z');
    return info;
  });

  return winston.createLogger({
    level: Env.LOG_LEVEL,
    format: isJsonFormat
      ? winston.format.combine(timestampFormat(), winston.format.json())
      : winston.format.combine(
          timestampFormat(),
          winston.format.printf(({ timestamp, level, message, ...rest }) => {
            const emoji = emojiLevelMap[level] || '';
            const formattedModule = moduleMap[module] || module;
            // Get full level name and pad it for centering
            const fullLevel = levelMap[level] || level.toUpperCase();
            const padding = Math.floor(
              (MAX_LEVEL_LENGTH - fullLevel.length) / 2
            );
            const paddedLevel =
              ' '.repeat(padding) +
              fullLevel +
              ' '.repeat(MAX_LEVEL_LENGTH - fullLevel.length - padding);

            // Apply color to the padded level
            const coloredLevel = winston.format
              .colorize()
              .colorize(fullLevel, paddedLevel);

            const formatLine = (line: unknown) => {
              return `${emoji} | ${coloredLevel} | ${timestamp} | ${formattedModule} | ${line} ${
                rest ? `${formatJsonToStyledString(rest)}` : ''
              }`;
            };
            if (typeof message === 'string') {
              return message.split('\n').map(formatLine).join('\n');
            } else if (typeof message === 'object') {
              return formatLine(formatJsonToStyledString(message));
            }
            return formatLine(message);
          })
        ),
    transports: [new winston.transports.Console()],
  });
};

function formatJsonToStyledString(json: any) {
  // return json.formatted
  if (json.formatted) {
    return json.formatted;
  }
  // extract keys and values, display space separated key=value pairs
  const keys = Object.keys(json);
  const values = keys.map((key) => `${key}=${json[key]}`);
  return values.join(' ');
}

export function maskSensitiveInfo(message: string) {
  if (Env.LOG_SENSITIVE_INFO) {
    return message;
  }
  return '<redacted>';
}

export const getTimeTakenSincePoint = (point: number) => {
  const timeNow = new Date().getTime();
  const duration = timeNow - point;
  if (duration < 1000) {
    return `${duration.toFixed(2)}ms`;
  } else {
    return `${(duration / 1000).toFixed(2)}s`;
  }
};

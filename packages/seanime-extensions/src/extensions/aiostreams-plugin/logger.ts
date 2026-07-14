// Fans every log out to both sinks: `console.*` reaches the Seanime server
// log and the browser console (already prefixed with the extension id) in
// normal mode, while `$debug.*` feeds the plugin dev console, which only
// exists in development mode.
class Logger {
  debug(...values: unknown[]): void {
    console.debug(...values);
    $debug.debug(...values);
  }

  info(...values: unknown[]): void {
    console.info(...values);
    $debug.info(...values);
  }

  warn(...values: unknown[]): void {
    console.warn(...values);
    $debug.warn(...values);
  }

  error(...values: unknown[]): void {
    console.error(...values);
    $debug.error(...values);
  }
}

export const log = new Logger();

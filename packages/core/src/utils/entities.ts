const HASH = 0x23; // #

/**
 * Decode the five XML entities plus numeric character references. Anything
 * else is left as written, so a stray `&` never fails the text around it.
 */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole: string, body: string) => {
      switch (body) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
      }
      if (body.charCodeAt(0) === HASH) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return whole;
          }
        }
      }
      return whole;
    }
  );
}

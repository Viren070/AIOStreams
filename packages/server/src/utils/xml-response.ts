import type { Response } from 'express';

/**
 * Shared JSON/XML content negotiation for the dual-format protocol endpoints
 * (SABnzbd, newznab/torznab). Both honour an `output`/`o` query param; the
 * serialiser is supplied per-call so each route keeps its own document shape.
 */

/**
 * Whether the client asked for XML via `output`/`o`. `defaultFormat` picks the
 * fallback when neither is present (SABnzbd defaults to JSON, nab feeds to XML).
 */
export function wantsXml(
  params: Record<string, string>,
  defaultFormat: 'json' | 'xml' = 'json'
): boolean {
  return (params.output ?? params.o ?? defaultFormat).toLowerCase() === 'xml';
}

/** Send `payload` as XML (via `renderXml`) when `xml`, otherwise as JSON. */
export function sendXmlOrJson(
  res: Response,
  status: number,
  payload: unknown,
  xml: boolean,
  renderXml: (payload: unknown) => string
): void {
  if (xml) {
    res.status(status).type('application/xml').send(renderXml(payload));
  } else {
    res.status(status).json(payload);
  }
}

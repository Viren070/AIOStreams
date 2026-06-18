import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Configured to reproduce the result shape of xml2js with
 * `explicitArray: true` (its default), which our XML consumers were written
 * against: attributes grouped under `$` (no prefix), every child element
 * wrapped in an array (but not the root), text content of mixed nodes under
 * `_`, and all values left as strings.
 */
const compatParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: '$',
  textNodeName: '_',
  parseTagValue: false,
  parseAttributeValue: false,
  // xml2js drops the XML declaration; keep parity.
  ignoreDeclaration: true,
  // Leaf/attribute values are trimmed (fast-xml-parser default). xml2js does
  // not trim, but the only observable difference is stray surrounding
  // whitespace in upstream data (e.g. a typo `tvdbid="337936 "`), where the
  // trimmed value is what every consumer wants anyway.
  // Wrap every child element in an array but not the document root, matching
  // xml2js `explicitArray: true`. fast-xml-parser passes either the dotted
  // jPath string or a MatcherView (depending on its `jPath` option); the root
  // is the only node with no '.'/depth 1.
  isArray: (_name, jpath, _isLeaf, isAttribute) => {
    if (isAttribute) return false;
    return typeof jpath === 'string'
      ? jpath.includes('.')
      : jpath.getDepth() > 1;
  },
});

/**
 * Parse an XML document into the xml2js-compatible shape described above.
 * Malformed/non-XML input throws (xml2js rejected it too); fast-xml-parser
 * alone would silently best-effort it, so validation runs first.
 */
export function parseXmlCompat(xml: string | Buffer): any {
  const text = typeof xml === 'string' ? xml : xml.toString('utf8');
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw new Error(
      `Invalid XML: ${validation.err.msg} (line ${validation.err.line})`
    );
  }
  return compatParser.parse(text);
}

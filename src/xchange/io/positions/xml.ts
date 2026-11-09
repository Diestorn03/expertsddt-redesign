/**
 * Small strict XML reader for position files (DOMParser does not exist in Web Workers).
 *
 * Accepted: an XML declaration (first thing only), comments, elements, attributes quoted with ' or ",
 * character data, CDATA, the 5 predefined entities and numeric character references. Refused: DOCTYPE,
 * ENTITY, every other markup declaration and every processing instruction, so nothing can be expanded,
 * fetched or executed. One pass with indexOf and a sticky single-class name regex: linear time, no
 * backtracking on input. No namespace processing: names stay verbatim ("ns:Tag").
 * ponytail: no end-of-line normalisation (CRLF stays CRLF in text; in attributes each of CR/LF/tab becomes a
 * space). The position families trim and split on whitespace, so it cannot change a value; add it if a
 * consumer ever compares raw text.
 *
 * Errors (details):
 * - XML_FORBIDDEN {reason, offset}: 'doctype' | 'entity' | 'declaration' | 'processingInstruction'
 * - XML_MALFORMED {reason, offset}: 'invalidChar' | 'xmlDeclaration' | 'noRoot' | 'textOutsideRoot' |
 *   'multipleRoots' | 'comment' | 'cdata' | 'text' | 'reference' | 'name' | 'tag' | 'attribute' |
 *   'attributeValue' | 'duplicateAttribute' | 'endTag' | 'unclosed' | 'tooManyElements' | 'tooDeep'
 * - FILE_TOO_LARGE {limitBytes, bytes}: text longer than LIMITS.positions.maxBytes
 */
import { XchangeError } from '../../core/errors';
import { LIMITS, PARSE_LIMITS } from '../../core/limits';

export interface XmlElement {
  name: string; // verbatim, prefix included ("ns:Tag")
  attributes: Readonly<Record<string, string>>;
  children: XmlElement[];
  /** Concatenated character data of this element (entities decoded), not trimmed. */
  text: string;
}

/** Characters XML 1.0 forbids anywhere: C0 controls except tab, LF, CR; U+FFFE; U+FFFF. */
const INVALID_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;
/** XML Name, sticky; a single greedy character class, so matching is linear. */
const NAME = /[\p{L}_:][\p{L}\p{M}\p{N}_:.\xB7-]*/uy;
const LT = 0x3c, GT = 0x3e, SLASH = 0x2f, EQUALS = 0x3d;

const malformed = (reason: string, offset: number): XchangeError => new XchangeError('XML_MALFORMED', { reason, offset });
const forbidden = (reason: string, offset: number): XchangeError => new XchangeError('XML_FORBIDDEN', { reason, offset });
const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
const isXmlChar = (cp: number): boolean =>
  cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);

function resolveReference(ref: string, offset: number): string {
  // A switch, not an object lookup: "&constructor;" must not resolve to Object.prototype.constructor.
  switch (ref) {
    case 'lt': return '<';
    case 'gt': return '>';
    case 'amp': return '&';
    case 'apos': return "'";
    case 'quot': return '"';
  }
  const hex = ref.startsWith('#x');
  const digits = hex ? ref.slice(2) : ref.startsWith('#') ? ref.slice(1) : '';
  if (!(hex ? /^[0-9A-Fa-f]{1,6}$/ : /^[0-9]{1,7}$/).test(digits)) throw malformed('reference', offset);
  const codePoint = Number.parseInt(digits, hex ? 16 : 10);
  if (!isXmlChar(codePoint)) throw malformed('reference', offset);
  return String.fromCodePoint(codePoint);
}

/** Decodes the references in `raw` (which holds no '<'); `offset` is where raw starts in the document. */
function decodeReferences(raw: string, offset: number): string {
  let amp = raw.indexOf('&');
  if (amp < 0) return raw;
  let out = '';
  let from = 0;
  while (amp >= 0) {
    const semi = raw.indexOf(';', amp + 1);
    if (semi < 0 || semi - amp > 12) throw malformed('reference', offset + amp);
    out += raw.slice(from, amp) + resolveReference(raw.slice(amp + 1, semi), offset + amp);
    from = semi + 1;
    amp = raw.indexOf('&', from);
  }
  return out + raw.slice(from);
}

/** Parses a whole document and returns its root element. */
export function parseXml(text: string): XmlElement {
  const limitBytes = LIMITS.positions.maxBytes;
  if (text.length > limitBytes) throw new XchangeError('FILE_TOO_LARGE', { limitBytes, bytes: text.length });
  const invalid = INVALID_CHAR.exec(text);
  if (invalid) throw malformed('invalidChar', invalid.index);

  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // a BOM left in a decoded string
  const skipSpace = (): boolean => {
    const start = i;
    while (i < n && isSpace(text.charCodeAt(i))) i++;
    return i > start;
  };
  const readName = (): string => {
    NAME.lastIndex = i;
    const match = NAME.exec(text);
    if (!match) throw malformed('name', i);
    i = NAME.lastIndex;
    return match[0];
  };

  skipSpace();
  if (text.startsWith('<?xml', i) && isSpace(text.charCodeAt(i + 5))) {
    const end = text.indexOf('?>', i + 5);
    if (end < 0) throw malformed('xmlDeclaration', i);
    i = end + 2;
  }

  const open: XmlElement[] = [];
  let root: XmlElement | undefined;
  let elements = 0;
  for (;;) {
    const parent = open[open.length - 1];
    if (parent) {
      const lt = text.indexOf('<', i);
      if (lt < 0) throw malformed('unclosed', i);
      if (lt > i) {
        const raw = text.slice(i, lt);
        if (raw.includes(']]>')) throw malformed('text', i);
        parent.text += decodeReferences(raw, i);
        i = lt;
      }
    } else {
      skipSpace();
      if (i >= n) break;
      if (text.charCodeAt(i) !== LT) throw malformed('textOutsideRoot', i);
    }

    const at = i;
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) throw malformed('comment', at);
      const body = text.slice(i + 4, end);
      if (body.includes('--') || body.endsWith('-')) throw malformed('comment', at);
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      if (!parent) throw malformed('textOutsideRoot', at);
      const end = text.indexOf(']]>', i + 9);
      if (end < 0) throw malformed('cdata', at);
      parent.text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      throw forbidden('processingInstruction', at);
    } else if (text.startsWith('<!', i)) {
      const word = text.slice(i + 2, i + 9).toUpperCase();
      throw forbidden(word === 'DOCTYPE' ? 'doctype' : word.startsWith('ENTITY') ? 'entity' : 'declaration', at);
    } else if (text.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (!parent || name !== parent.name || text.charCodeAt(i) !== GT) throw malformed('endTag', at);
      i++;
      open.pop();
    } else {
      i++;
      const name = readName();
      // Null prototype: an attribute called "__proto__" or "constructor" is plain data.
      const attributes = Object.create(null) as Record<string, string>;
      let selfClosing = false;
      for (;;) {
        const spaced = skipSpace();
        if (i >= n) throw malformed('tag', at);
        const c = text.charCodeAt(i);
        if (c === GT) {
          i++;
          break;
        }
        if (c === SLASH) {
          if (text.charCodeAt(i + 1) !== GT) throw malformed('tag', i);
          i += 2;
          selfClosing = true;
          break;
        }
        if (!spaced) throw malformed('attribute', i);
        const key = readName();
        skipSpace();
        if (text.charCodeAt(i) !== EQUALS) throw malformed('attribute', i);
        i++;
        skipSpace();
        const quote = text[i];
        if (quote !== '"' && quote !== "'") throw malformed('attributeValue', i);
        const end = text.indexOf(quote, i + 1);
        if (end < 0) throw malformed('attributeValue', i);
        const raw = text.slice(i + 1, end);
        if (raw.includes('<')) throw malformed('attributeValue', i);
        if (key in attributes) throw malformed('duplicateAttribute', i);
        // Attribute-value normalisation: literal tab / LF / CR become spaces (character references are kept).
        attributes[key] = decodeReferences(raw.replace(/[\t\n\r]/g, ' '), i + 1);
        i = end + 1;
      }
      if (++elements > PARSE_LIMITS.xmlMaxElements) throw malformed('tooManyElements', at);
      if (open.length >= PARSE_LIMITS.xmlMaxDepth) throw malformed('tooDeep', at);
      const element: XmlElement = { name, attributes, children: [], text: '' };
      if (parent) parent.children.push(element);
      else if (root) throw malformed('multipleRoots', at);
      else root = element;
      if (!selfClosing) open.push(element);
    }
  }
  if (!root) throw malformed('noRoot', i);
  return root;
}

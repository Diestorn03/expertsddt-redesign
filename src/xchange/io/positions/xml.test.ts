import { describe, expect, it } from 'vitest';
import { XchangeError } from '../../core/errors';
import { LIMITS, PARSE_LIMITS } from '../../core/limits';
import { parseXml } from './xml';

function failure(text: string): string {
  try {
    parseXml(text);
    return 'accepted';
  } catch (e) {
    return e instanceof XchangeError ? `${e.code}:${String(e.details.reason ?? '')}` : `other:${String(e)}`;
  }
}

describe('parseXml: accepted XML', () => {
  it('reads elements, attributes, text, entities, character references, CDATA and comments', () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- prolog comment -->\n<ns:Root a="1" b='two &amp; &quot;q&quot;' c="x&#10;y\tz">` +
        `<Child>a &lt; b &gt; c &apos;d&apos; &#65;&#x42;&#x1F600;</Child><Empty/><Mixed>x<!-- c -->y<![CDATA[<raw & ]]>z</Mixed>` +
        `</ns:Root>\n<!-- epilog -->\n`,
    );
    expect(root.name).toBe('ns:Root');
    expect(root.attributes).toEqual({ a: '1', b: 'two & "q"', c: 'x\ny z' });
    expect(root.children.map((c) => c.name)).toEqual(['Child', 'Empty', 'Mixed']);
    expect(root.children[0]!.text).toBe("a < b > c 'd' AB\u{1F600}");
    expect(root.children[1]!.text).toBe('');
    expect(root.children[2]!.text).toBe('xy<raw & z');
  });

  it('keeps text untrimmed, tolerates leading whitespace and treats "__proto__" as a plain attribute', () => {
    const root = parseXml(`  \n<a __proto__="p" constructor="c"> x <b /> y </a>`);
    expect(root.text).toBe(' x  y ');
    expect(root.attributes['__proto__']).toBe('p');
    expect(root.attributes['constructor']).toBe('c');
    expect(Object.getPrototypeOf(root.attributes)).toBeNull();
    expect(parseXml('<a/>').children).toEqual([]);
  });
});

describe('parseXml: refused XML', () => {
  it('refuses DOCTYPE, ENTITY, billion laughs and processing instructions', () => {
    const laughs =
      '<?xml version="1.0"?>\n<!DOCTYPE lolz [\n <!ENTITY lol "lol">\n' +
      Array.from({ length: 9 }, (_, k) => ` <!ENTITY lol${k + 1} "${`&lol${k || ''};`.repeat(10)}">`).join('\n') +
      '\n]>\n<lolz>&lol9;</lolz>';
    expect(failure(laughs)).toBe('XML_FORBIDDEN:doctype');
    expect(failure('<!DOCTYPE a SYSTEM "file:///etc/passwd"><a/>')).toBe('XML_FORBIDDEN:doctype');
    expect(failure('<!doctype html><html/>')).toBe('XML_FORBIDDEN:doctype');
    expect(failure('<!ENTITY x "y"><a/>')).toBe('XML_FORBIDDEN:entity');
    expect(failure('<a><!ELEMENT a ANY></a>')).toBe('XML_FORBIDDEN:declaration');
    expect(failure('<?xml-stylesheet href="x.xsl"?><a/>')).toBe('XML_FORBIDDEN:processingInstruction');
    expect(failure('<a><?php echo 1; ?></a>')).toBe('XML_FORBIDDEN:processingInstruction');
    expect(failure('<!-- c --><?xml version="1.0"?><a/>')).toBe('XML_FORBIDDEN:processingInstruction');
  });

  it('refuses undefined entities and invalid character references', () => {
    expect(failure('<a>&lol9;</a>')).toBe('XML_MALFORMED:reference');
    expect(failure('<a>&constructor;</a>')).toBe('XML_MALFORMED:reference');
    expect(failure('<a>a & b</a>')).toBe('XML_MALFORMED:reference');
    expect(failure('<a>&#0;</a>')).toBe('XML_MALFORMED:reference');
    expect(failure('<a>&#xD800;</a>')).toBe('XML_MALFORMED:reference');
    expect(failure('<a>&#x110000;</a>')).toBe('XML_MALFORMED:reference');
    expect(failure('<a b="&nope;"/>')).toBe('XML_MALFORMED:reference');
  });

  it('refuses malformed structure', () => {
    const cases: Array<[string, string]> = [
      ['', 'noRoot'],
      ['<?xml version="1.0"?>', 'noRoot'],
      ['text<a/>', 'textOutsideRoot'],
      ['<a/>tail', 'textOutsideRoot'],
      ['<a/><b/>', 'multipleRoots'],
      ['<a><b></a>', 'endTag'],
      ['<a></b>', 'endTag'],
      ['</a>', 'endTag'],
      ['<a>', 'unclosed'],
      ['<a><b>', 'unclosed'],
      ['<a', 'tag'],
      ['<a /b>', 'tag'],
      ['< a/>', 'name'],
      ['<1a/>', 'name'],
      ['<a b/>', 'attribute'],
      ['<a b="1"c="2"/>', 'attribute'],
      ['<a b=1/>', 'attributeValue'],
      ['<a b="1/>', 'attributeValue'],
      ['<a b="<"/>', 'attributeValue'],
      ['<a b="1" b="2"/>', 'duplicateAttribute'],
      ['<a><!-- x -- y --></a>', 'comment'],
      ['<a><!-- x</a>', 'comment'],
      ['<a><![CDATA[x</a>', 'cdata'],
      ['<![CDATA[x]]><a/>', 'textOutsideRoot'],
      ['<a>x]]>y</a>', 'text'],
      ['<?xml version="1.0"', 'xmlDeclaration'],
      ['<a>\u0001</a>', 'invalidChar'],
      ['<a>\uFFFF</a>', 'invalidChar'],
    ];
    for (const [text, reason] of cases) expect([text, failure(text)]).toEqual([text, `XML_MALFORMED:${reason}`]);
  });

  it('enforces the depth, element and size limits', () => {
    const depth = PARSE_LIMITS.xmlMaxDepth;
    expect(failure('<a>'.repeat(depth) + '</a>'.repeat(depth))).toBe('accepted');
    expect(failure('<a>'.repeat(depth + 1) + '</a>'.repeat(depth + 1))).toBe('XML_MALFORMED:tooDeep');
    expect(failure(`<r>${'<e/>'.repeat(PARSE_LIMITS.xmlMaxElements - 1)}</r>`)).toBe('accepted');
    expect(failure(`<r>${'<e/>'.repeat(PARSE_LIMITS.xmlMaxElements)}</r>`)).toBe('XML_MALFORMED:tooManyElements');
    const big = `<a>${' '.repeat(LIMITS.positions.maxBytes)}</a>`;
    expect(failure(big)).toBe('FILE_TOO_LARGE:');
  });

  it('stays linear on hostile near-limit input', () => {
    const size = LIMITS.positions.maxBytes - 64;
    const started = performance.now();
    for (const text of [
      `<a>${'&amp;'.repeat(Math.floor(size / 5) - 2)}</a>`,
      `<a b="${'&#65;'.repeat(Math.floor(size / 5) - 4)}"/>`,
      `<a>${'x'.repeat(size - 16)}`,
      `<a>${'<!---->'.repeat(Math.floor(size / 7) - 2)}</a>`,
      `<a>&${'x'.repeat(size - 16)}</a>`,
    ]) {
      expect(text.length).toBeLessThanOrEqual(LIMITS.positions.maxBytes);
      failure(text);
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

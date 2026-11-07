/**
 * ScanAdaptor XML (iCam; spec 3.3). Every `ScanAdaptor` element outside any namespace holds exactly one
 * `ToothNumber` and one each of `Mat0`..`Mat3` (text only; four `;`-separated numbers = one row of the
 * row-major matrix). The root and other elements are free. Units, wherever declared (`units` attribute or
 * `Units` element), must be mm.
 *
 * Errors (details): POSITIONS_MALFORMED {format, reason, row?}: 'nested' | 'elementMissing' |
 * 'elementRepeated' | 'notText' (+ 'declarationRepeated' from common.ts); MATRIX_INVALID {reason: 'shape', row};
 * NUMBER_INVALID {row}; UNITS_NOT_MM {row?}; XML_* (xml.ts); plus SiteCollector errors (common.ts).
 */
import { declared, malformed, matRow, requireMm, SiteCollector, type ParsedPositions } from './common';
import { parseXml, type XmlElement } from './xml';

const FORMAT = 'scanadaptor-xml';

interface Visit {
  element: XmlElement;
  /** Default namespace in scope ('' = none). */
  ns: string;
  insideAdaptor: boolean;
}

const isAdaptor = ({ element, ns }: Visit): boolean => element.name === 'ScanAdaptor' && ns === '';

/** Pre-order (document order) walk that tracks the default namespace. */
function walk(root: XmlElement, visit: (v: Visit) => void): void {
  const stack: Visit[] = [{ element: root, ns: root.attributes['xmlns'] ?? '', insideAdaptor: false }];
  for (let v = stack.pop(); v; v = stack.pop()) {
    visit(v);
    const insideAdaptor = v.insideAdaptor || isAdaptor(v);
    for (let k = v.element.children.length - 1; k >= 0; k--) {
      const element = v.element.children[k]!;
      stack.push({ element, ns: element.attributes['xmlns'] ?? v.ns, insideAdaptor });
    }
  }
}

export function hasScanAdaptor(root: XmlElement): boolean {
  let found = false;
  walk(root, (v) => {
    found ||= isAdaptor(v);
  });
  return found;
}

export function parseScanAdaptorXML(text: string): ParsedPositions {
  return scanAdaptorsFromXml(parseXml(text));
}

export function scanAdaptorsFromXml(root: XmlElement): ParsedPositions {
  const sites = new SiteCollector(FORMAT);
  let row = 0;
  walk(root, (v) => {
    const adaptor = isAdaptor(v);
    if (adaptor) {
      row++;
      if (v.insideAdaptor) throw malformed(FORMAT, 'nested', row);
    }
    const at = adaptor || v.insideAdaptor ? row : undefined;
    const units = declared(v.element, 'units', 'Units', FORMAT, at);
    if (units !== undefined) requireMm(units, at);
    if (!adaptor) return;

    const child = (name: string): string => {
      const matches = v.element.children.filter((c) => c.name === name && (c.attributes['xmlns'] ?? v.ns) === '');
      if (matches.length !== 1) throw malformed(FORMAT, matches.length ? 'elementRepeated' : 'elementMissing', row);
      if (matches[0]!.children.length) throw malformed(FORMAT, 'notText', row);
      return matches[0]!.text;
    };
    const label = child('ToothNumber');
    const values = [0, 1, 2, 3].flatMap((r) => matRow(child(`Mat${r}`), row));
    sites.add(label, values, row);
  });
  return sites.result();
}

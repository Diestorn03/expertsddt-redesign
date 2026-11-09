/**
 * MicronMapper native CSV (spec 3.3). Marker rows of one family (three capital letters plus digits: AXO#, AHY#,
 * BTH#...), each followed by nine numbers: origin XYZ, +Z axis XYZ, indexed +X XYZ. The family is not tied to
 * the version (V1.6 writes AHY and BTH alike), but one file holds one family. `Camera:` and `Max divergence
 * angle:` rows are skipped; exactly one `Application:` row must name `MicronMapper V1.4.x.x` or `V1.6.x.x`.
 * Delimiter `,` `;` or tab; a UTF-8 BOM is tolerated (the lexer trims it). Axes are kept as written (the files
 * round to 6 decimals): Y = Z × X, then validateRigid(RIGID_TOLERANCE). Marker IDs are labels, not tooth numbers.
 *
 * Errors (details): FORMAT_UNSUPPORTED {reason: 'unknownVersion'} (another version); POSITIONS_MALFORMED
 * {format, reason, row?}: 'applicationMissing' | 'applicationRepeated' | 'row' | 'markerFamily' (a marker of
 * another family than the first one); NUMBER_INVALID {row}; plus lexer, delimiter and SiteCollector errors (common.ts).
 */
import {
  frameFromOriginAxes,
  malformed,
  number,
  parseWithDelimiters,
  SiteCollector,
  unsupported,
  type ParsedPositions,
  type TextRecord,
} from './common';

const FORMAT = 'micronmapper-csv';
/** Marker family + number (index.ts MARKER_ROW sniffs the same rule). */
const MARKER = /^[A-Z]{3}\d+$/;
const APPLICATION = /^MicronMapper\s+V1\.[46]\.\d+\.\d+(?:\s|$)/i;

export function parseMicronMapperCSV(text: string): ParsedPositions {
  return parseWithDelimiters(text, FORMAT, [',', ';', '\t'], interpret, score, 1);
}

/** Records whose first field is a marker or the application signature (0 for a wrong delimiter). */
function score(records: TextRecord[]): number {
  return records.filter(({ fields }) => fields[0] === 'Application:' || MARKER.test(fields[0]!)).length;
}

function interpret(records: TextRecord[]): ParsedPositions {
  const applications = records.filter(({ fields }) => fields[0] === 'Application:');
  if (!applications.length) throw malformed(FORMAT, 'applicationMissing');
  if (applications.length > 1) throw malformed(FORMAT, 'applicationRepeated', applications[1]!.row);
  if (!APPLICATION.test(applications[0]!.fields[1] ?? '')) throw unsupported('unknownVersion');

  const sites = new SiteCollector(FORMAT);
  let family: string | undefined;
  for (const { row, fields } of records) {
    const first = fields[0]!;
    if (first === 'Application:' || first === 'Camera:' || first.startsWith('Max divergence angle:')) continue;
    if (!MARKER.test(first) || fields.length !== 10) throw malformed(FORMAT, 'row', row);
    family ??= first.slice(0, 3);
    if (!first.startsWith(family)) throw malformed(FORMAT, 'markerFamily', row);
    sites.add(first, frameFromOriginAxes(fields.slice(1).map((field) => number(field, row))), row);
  }
  return sites.result();
}

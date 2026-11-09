/**
 * Generic position tables in CSV / TXT (spec 3.3). Header (case-insensitive): exactly one identity column
 * (name | label | position | toothnumber | marker) plus exactly one schema and nothing else:
 *   Mat0..Mat3   each cell "a;b;c;d" = one matrix row
 *   m00..m33     the 16 row-major values
 *   marker + originX..Z, axisX..Z (+Z), indexedX..Z (+X), kept as written, Y = Z × X
 * Delimiters `,` `;` tab `|` and runs of whitespace: every delimiter that parses must give the same data.
 * Units: an optional first record `units,mm` / `units: mm` and/or a `units` column; neither ->
 * warning UNITS_ASSUMED_MM. A column with an empty header may only hold empty cells.
 *
 * Errors (details): POSITIONS_MALFORMED {format, reason, row}: 'columns' | 'unitsRepeated'; UNITS_NOT_MM {row};
 * MATRIX_INVALID {reason: 'shape', row}; NUMBER_INVALID {row}; POSITIONS_EMPTY; plus lexer, delimiter and
 * SiteCollector errors (common.ts).
 */
import { XchangeError } from '../../core/errors';
import {
  frameFromOriginAxes,
  malformed,
  matRow,
  number,
  parseWithDelimiters,
  requireMm,
  SiteCollector,
  type ParsedPositions,
  type TextRecord,
} from './common';

const FORMAT = 'matrix-table';
const IDENTITY = ['name', 'label', 'position', 'toothnumber', 'marker'];
type Kind = 'rows' | 'matrix' | 'axis';
const SCHEMAS: Readonly<Record<Kind, readonly string[]>> = {
  rows: ['mat0', 'mat1', 'mat2', 'mat3'],
  matrix: Array.from({ length: 16 }, (_, k) => `m${k >> 2}${k & 3}`),
  axis: ['originx', 'originy', 'originz', 'axisx', 'axisy', 'axisz', 'indexedx', 'indexedy', 'indexedz'],
};
const HEADER_WORDS = new Set([...IDENTITY, ...SCHEMAS.rows, ...SCHEMAS.matrix, ...SCHEMAS.axis, 'units']);

interface Schema {
  kind: Kind;
  identity: number;
  columns: number[];
  /** Index of the units column, -1 if none. */
  units: number;
}

export function parseMatrixTable(text: string): ParsedPositions {
  return parseWithDelimiters(text, FORMAT, [',', ';', '\t', '|', ' '], interpret, score, 2);
}

/** Known header words in the first two records (a wrong delimiter sees whole lines: 0). */
function score(records: TextRecord[]): number {
  let value = 0;
  for (const { fields } of records.slice(0, 2)) for (const field of fields) if (HEADER_WORDS.has(field.toLowerCase())) value++;
  return value;
}

/** Value of a `units,mm` / `units mm` / `units: mm` / `units=mm` record, else undefined. */
function unitsRecord({ fields }: TextRecord): string | undefined {
  const key = fields[0]!;
  if (fields.length === 2 && /^units\s*[:=]?$/i.test(key)) return fields[1];
  const prefix = fields.length === 1 ? /^units\s*[:=]/i.exec(key) : null;
  return prefix ? key.slice(prefix[0].length) : undefined;
}

function matchSchema(names: readonly string[], row: number): Schema {
  const unitColumns = names.flatMap((name, c) => (name === 'units' ? [c] : []));
  if (unitColumns.length > 1) throw malformed(FORMAT, 'unitsRepeated', row);
  const units = unitColumns[0] ?? -1;
  const named = names.filter((name, c) => name !== '' && c !== units);
  const identities = IDENTITY.filter((name) => named.includes(name));
  if (new Set(named).size === named.length && identities.length === 1) {
    const identity = identities[0]!;
    for (const kind of ['rows', 'matrix', 'axis'] as const) {
      const columns = SCHEMAS[kind];
      if (kind === 'axis' && identity !== 'marker') continue;
      if (named.length === columns.length + 1 && columns.every((name) => named.includes(name))) {
        return { kind, identity: names.indexOf(identity), columns: columns.map((name) => names.indexOf(name)), units };
      }
    }
  }
  throw malformed(FORMAT, 'columns', row);
}

function interpret(all: TextRecord[]): ParsedPositions {
  let records = all;
  let unitsDeclared = false;
  const declaredUnits = records[0] ? unitsRecord(records[0]) : undefined;
  if (declaredUnits !== undefined) {
    requireMm(declaredUnits, records[0]!.row);
    unitsDeclared = true;
    records = records.slice(1);
  }
  const [header, ...rows] = records;
  if (!header) throw new XchangeError('POSITIONS_EMPTY', { format: FORMAT });
  const schema = matchSchema(header.fields.map((field) => field.toLowerCase()), header.row);
  const allowed = new Set([schema.identity, ...schema.columns, schema.units]);

  const sites = new SiteCollector(FORMAT);
  for (const { row, fields } of rows) {
    fields.forEach((value, c) => {
      if (value !== '' && !allowed.has(c)) throw malformed(FORMAT, 'columns', row);
    });
    const cells = schema.columns.map((c) => fields[c] ?? '');
    if (schema.units >= 0) requireMm(fields[schema.units] ?? '', row);
    const matrix =
      schema.kind === 'rows'
        ? cells.flatMap((cell) => matRow(cell, row))
        : schema.kind === 'matrix'
          ? cells.map((cell) => number(cell, row))
          : frameFromOriginAxes(cells.map((cell) => number(cell, row)));
    sites.add(fields[schema.identity] ?? '', matrix, row);
  }
  return sites.result(unitsDeclared || schema.units >= 0 ? [] : [{ code: 'UNITS_ASSUMED_MM' }]);
}

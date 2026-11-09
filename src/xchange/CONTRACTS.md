# DDT Xchange: module contracts

Source of truth for the five parallel builders (io/mesh, io/positions, geometry + detect, align, export).
Behaviour reference: `DDT-XCHANGE-SPEC.md` (sections cited as "spec x.y"). The ChatGPT prototype is a
reference for semantics and formats only: never copy its code or embed its data files.

`core/` and `test/fixtures/` are done and tested. Read `core/types.ts` first: every shared type lives there.

## 0. Rules for every module

1. **Imports.** A module imports only from `core/` and its own folder. Tests may also import `test/fixtures/`.
   No imports between the parallel modules (they are built at the same time). Only exception: `detect/` may
   import `geometry/` (same builder).
2. **Do not edit** `core/`, `test/fixtures/index.ts` or `test/fixtures/encoders.ts`. Need a shared helper?
   Write it in your module and list it in your summary as "candidate for core". Need more fixtures? Add
   `test/fixtures/<your-module>.ts`.
3. **No new npm dependencies.** No `node:*` imports, even in tests (`@types/node` is not enabled; code ships to
   browsers). `three` is only for `viewer/`.
4. **Worker-safe.** Nothing in core, io, geometry, detect, align or export may touch the DOM (`document`,
   `window`, `DOMParser`, `File`, `FileReader`). Inputs are `Uint8Array` or `string`, outputs plain objects and
   typed arrays.
5. **Errors.** Throw `new XchangeError(code, details)` (`core/errors.ts`) with the codes listed for your module.
   `details` holds numbers, booleans and short camelCase `reason` ids that you list in a comment at the top of
   the file that throws them. Never a file name, never text copied from the file (not even a label: give the
   `row`/`line` number). Warnings are `XchangeWarning` with `WARNING_CODES` only. If a code is truly missing,
   use the closest one plus a `reason` and report it; do not edit `core/errors.ts`.
6. **Limits before memory.** Check `bytes.byteLength` against `LIMITS` first, then every declared count
   (STL triangle count, PLY element counts, table rows) against the limit and against the bytes actually present,
   then allocate. Reject NaN/Infinity and |coordinate| > `MAX_ABS_COORDINATE_MM`.
7. **No aliasing.** Returned typed arrays never view the input buffer (the caller may transfer or keep it).
8. **Numbers.** Millimetres, radians, fractions 0-1 in every API (µm only in `deviationMap`). Compute in
   float64, store positions in `Float32Array`. Matrices are row-major `Mat4` (`core/mat4.ts`); call
   `validateRigid` on every matrix that comes from a file.
9. **Determinism.** Randomness only through `createRng(seed)` / `sampleSurface(mesh, n, seed)`, seed in the
   options with a fixed default.
10. **Style.** TypeScript strict with `noUncheckedIndexedAccess` (use `!` in hot loops once bounds are known),
    `import type` for types (`verbatimModuleSyntax`), extensionless relative imports, no `any` without a comment
    saying why. Hot loops use scalars over typed arrays, no per-element allocation.
11. **Tests.** Vitest, `*.test.ts` next to the code, synthetic data from `test/fixtures` only. Each test file under
    5 s; run `npx vitest run src/xchange/<module>` and `npm run typecheck:xchange` before you finish.

### What core already gives you

| File | Exports |
|---|---|
| `core/types.ts` | `Vec3`, `Mat4`, `Bounds`, `TriMesh`, `Arch`, `MeshFormat`, `MeshPurpose`, `PositionFormat`, `CaptureFormat`, `SiteFlags`, `ImplantSite`, `Capture`, `ReferenceBody`, `ReplacementGeometry`, `JawScan`, `AssemblyPart`, `LandmarkPair`, `AlignmentStatus`, `AlignmentMethod`, `AlignmentFlag`, `SiteFit`, `AlignmentResult`, `MatchedBody`, `ExportRequest` |
| `core/errors.ts` | `ERROR_CODES`, `ErrorCode`, `WARNING_CODES`, `WarningCode`, `ErrorDetails`, `XchangeWarning`, `XchangeError`, `XchangeErrorPayload`, `isXchangeError`, `toErrorPayload`, `fromErrorPayload` |
| `core/limits.ts` | `LIMITS` (jaw / capture / geometry / positions / bundle), `maxVertices(purpose)`, `MESH_FORMATS_BY_PURPOSE`, `MAX_ABS_COORDINATE_MM`, `PLAUSIBLE_EXTENT_MM[purpose]`, `RIGID_TOLERANCE`, `PARSE_LIMITS` |
| `core/vec3.ts` | `add`, `sub`, `scale`, `dot`, `cross`, `length`, `distance`, `normalize` |
| `core/mat4.ts` | `Quat`, `identity`, `fromRowMajor`, `fromColumnMajor`, `toRowMajorArray`, `fromAxes`, `getColumn`, `fromTranslation`, `compose`, `multiply`, `inverseRigid`, `validateRigid`, `fromAxisAngle`, `fromQuaternion`, `toQuaternion`, `transformPoint`, `transformDirection`, `rotationAngleBetween`, `maxAbsDiff`. Every function treats the bottom row as 0 0 0 1 (`multiply` is a rigid composition); `validateRigid` returns the bottom row exact (a copy when the input's was only within tolerance) |
| `core/linalg.ts` | `eigenSymmetric(a, n)` (Jacobi, descending, eigenvectors as columns), `solveLinear(a, b, n)` (null if singular) |
| `core/rigid.ts` | `kabsch(src, dst, weights?)` (Horn quaternion, never a reflection, n >= 3), `solvePointToPlane(src, dst, dstNormals, weights?)` (one linearised step, `Mat4 \| null`, n >= 6) |
| `core/mesh.ts` | `checkMesh(mesh, maxTriangles?)` (trust boundary: typed arrays, limit, finite positions, index range; INVALID_ARGUMENT), `countTriangles`, `computeBounds`, `computeFaceNormals`, `computeVertexNormals`, `surfaceArea`, `transformMesh` (the spec's `applyToMesh`; copies all arrays), `mergeMeshes`, `closestPointOnTriangle(positions, indices, tri, px, py, pz, out?)` (exact, returns squared distance) |
| `core/sampling.ts` | `Rng`, `createRng(seed)`, `gaussian(rng)`, `SurfaceSamples {points, normals, triangles}`, `sampleSurface(mesh, count, seed)` (area-weighted, stratified, shuffled: any prefix is a fair subsample), `hashSeed()` + `hash3(x, y, z, seed)` (secret-seeded hash for tables keyed by file content: HashDoS; never changes a result) |
| `core/stl-writer.ts` | `STL_HEADER`, `writeBinarySTL(mesh \| meshes, header?)` |
| `core/text.ts` | `decodeText(bytes)` (strict UTF-8, BOM UTF-16; rejects NUL), `parseStrictNumber(token)` (`number \| null`) |
| `test/fixtures/index.ts` | `makeScanBody(opts)`, `makeRevolutionBody(opts)`, `makeArch(arch, opts)`, `makeFrames(n, arch, seed?, opts?)`, `placeBodies(frames, body)`, `addNoise(mesh, sigmaMm, seed)`, `randomRigid(seed, maxAngleRad?, maxTranslationMm?)`, `makeSyntheticCase(opts)` -> `{arch, body, frames, sites, parts, captureMesh, archMesh, jaw, captureToJaw}` |
| `test/fixtures/encoders.ts` | `encodeAsciiSTL(mesh, name?)`, `encodePLY(mesh, 'ascii' \| 'binary_little_endian' \| 'binary_big_endian', {colors?})`, `encodeOBJ(mesh)` (binary STL: `writeBinarySTL`) |

Fixture facts you can rely on: bodies have the connection at z = 0 and the axis +Z; `makeScanBody()` has a flat on
+X (index recoverable) and a top chamfer (+Z recoverable); `makeRevolutionBody()` is symmetric about +Z.
In `makeSyntheticCase`, body i of `captureMesh` occupies triangles `[i·T, (i+1)·T)`, `sites[i].componentIndex = i`,
and `jaw = captureToJaw · (archMesh + captureMesh)` plus optional noise.

---

## 1. io/mesh (builder 1)

Files: `io/mesh/index.ts`, `io/mesh/stl.ts`, `io/mesh/ply.ts`, `io/mesh/obj.ts`.

```ts
// io/mesh/index.ts
export interface ParsedMesh {
  mesh: TriMesh;
  format: MeshFormat;
  warnings: XchangeWarning[];
}
export interface MeshParseLimits {
  maxBytes: number;
  maxTriangles: number;
}
/** Content sniffing only (never the file name). Never throws; null when nothing matches. */
export function detectMeshFormat(bytes: Uint8Array): MeshFormat | null;
/** Size check, detect, allowed-format check, parse with LIMITS[purpose], then add warnings. */
export function parseMesh(bytes: Uint8Array, purpose: MeshPurpose, hint?: MeshFormat): ParsedMesh;

// io/mesh/stl.ts, ply.ts, obj.ts
export function parseSTL(bytes: Uint8Array, limits: MeshParseLimits): ParsedMesh;
export function parsePLY(bytes: Uint8Array, limits: MeshParseLimits): ParsedMesh;
export function parseOBJ(bytes: Uint8Array, limits: MeshParseLimits): ParsedMesh;
```

- **Detection** (spec 3.2): binary STL when `byteLength >= 84` and `84 + 50·count === byteLength`, even if the header
  starts with "solid"; PLY when the bytes start with `ply\n` or `ply\r\n`; ASCII STL when the first token is `solid`
  and a `facet` follows; OBJ when the text has `v ` and `f ` records. Inspect at most the first 1 MB.
- **parseMesh order:** `FILE_EMPTY` -> `FILE_TOO_LARGE {limitBytes, bytes}` -> detect (null: with `hint`, run that
  parser so the user gets its specific error; without, `FORMAT_UNKNOWN`) -> `FORMAT_NOT_ALLOWED {format, purpose}`
  per `MESH_FORMATS_BY_PURPOSE` -> parse with `LIMITS[purpose]` -> warnings `MESH_LARGE {triangles}` (jaw above
  `LIMITS.jaw.warnTriangles`) and `MESH_UNITS_SUSPECT {extentMm}` (bounds diagonal outside `PLAUSIBLE_EXTENT_MM[purpose]`:
  jaw 15-250 mm, capture and geometry 2-250 mm; never convert units). The hint never overrides content.
- **Output:** always indexed. STL merges bit-identical vertices (+0 equals -0; no tolerance: that is
  `geometry/weld`). Triangles with a repeated vertex index are dropped and counted
  (`MESH_DEGENERATE_TRIANGLES_DROPPED {count}`); nothing left -> `MESH_EMPTY`. Colors only from PLY/OBJ.
- **Improvements over the prototype (spec 6, C6):** ASCII STL with several `solid` blocks is accepted
  (`STL_MULTIPLE_SOLIDS {count}`); one degenerate face never rejects the whole file; file normals are ignored.
- **STL:** binary count > `maxTriangles` -> `TOO_MANY_TRIANGLES` before allocating; length mismatch ->
  `MESH_TRUNCATED`. ASCII grammar `facet normal / outer loop / 3 × vertex / endloop / endfacet` (spec 3.2), anything
  else -> `MESH_MALFORMED {format:'stl', reason, line}`. Parse ASCII without building a JS array of numbers per file.
- **PLY:** spec 3.2 rules (header <= `PARSE_LIMITS.plyMaxHeaderBytes`, `ascii | binary_little_endian |
  binary_big_endian 1.0`, element counts <= `plyMaxElementCount` and checked against the remaining bytes, `vertex`
  needs scalar x/y/z, `face` needs one `vertex_indices|vertex_index` list, polygons up to `maxPolygonCorners` are
  triangulated without flipping convex faces). Colors: red/green/blue all or none; uchar kept, float 0-1 ->
  `round(255·v)` clamped; partial color sets -> `MESH_COLORS_IGNORED`. Other properties and elements are skipped.
  Index out of range -> `MESH_INDEX_OUT_OF_RANGE`. Bytes after the last element -> `MESH_MALFORMED reason
  'trailingData'`. No faces (point cloud) -> `MESH_EMPTY`.
- **OBJ:** spec 3.2 (`v` with 3/4 (w = 1)/6 (rgb 0-1)/7 fields, `f` with `v`, `v/vt`, `v//vn`, `v/vt/vn`, negative
  indices, `\` continuation, records <= `maxLineChars`). `surf/curv/curv2` -> `FORMAT_UNSUPPORTED reason 'freeform'`.
  `o g s usemtl mtllib l p vt vn` ignored; materials are never loaded.
- **Errors:** `FILE_EMPTY`, `FILE_TOO_LARGE`, `FORMAT_UNKNOWN`, `FORMAT_NOT_ALLOWED`, `FORMAT_UNSUPPORTED`,
  `TEXT_ENCODING`, `NUMBER_INVALID`, `COORDINATE_OUT_OF_RANGE`, `TOO_MANY_TRIANGLES`, `TOO_MANY_VERTICES`,
  `MESH_TRUNCATED`, `MESH_MALFORMED`, `MESH_INDEX_OUT_OF_RANGE`, `MESH_EMPTY`.
- **Tests (minimum):** round trips with `writeBinarySTL`, `encodeAsciiSTL`, `encodePLY` (3 encodings, with and without
  colors) and `encodeOBJ` give back the same triangles; binary STL whose header says "solid"; multi-solid ASCII;
  truncated / one byte extra; huge declared count with a tiny body (must fail without allocating); NaN; PLY index out
  of range; OBJ quads, negative indices and a concave polygon; `FORMAT_NOT_ALLOWED` for an OBJ jaw; detection never
  throws on random bytes. Budget: 1 M-triangle binary STL < 1 s.

## 2. io/positions (builder 2)

Files: `io/positions/index.ts`, `xml.ts`, `micronmapper.ts`, `scanadaptor.ts`, `table.ts`, `json.ts`, `matrix-xml.ts`, `icam.ts`.

```ts
// io/positions/index.ts
export interface ParsedPositions {
  sites: ImplantSite[];
  format: PositionFormat;
  warnings: XchangeWarning[];
}
export interface PositionParseOptions {
  /** Lower-case extension without the dot. Only used to refuse native vendor files and spreadsheets. */
  extension?: string;
}
export function parsePositions(input: Uint8Array | string, options?: PositionParseOptions): ParsedPositions;
/** Content-based (spec 3.3 priority). Never throws. */
export function detectPositionFormat(text: string): PositionFormat | null;

// one parser per family, each on decoded text
export function parseMicronMapperCSV(text: string): ParsedPositions; // micronmapper.ts
export function parseScanAdaptorXML(text: string): ParsedPositions;  // scanadaptor.ts
export function parseMatrixTable(text: string): ParsedPositions;     // table.ts
export function parsePositionsJSON(text: string): ParsedPositions;   // json.ts
export function parseMatrixXML(text: string): ParsedPositions;       // matrix-xml.ts
export function parseICamPoints(text: string): ParsedPositions;      // icam.ts

// io/positions/xml.ts: small strict XML reader (no DOMParser: it does not exist in workers)
export interface XmlElement {
  name: string; // verbatim, prefix included ("ns:Tag")
  attributes: Readonly<Record<string, string>>;
  children: XmlElement[];
  /** Concatenated character data of this element (entities decoded), not trimmed. */
  text: string;
}
export function parseXml(text: string): XmlElement; // returns the root element
```

- **parsePositions order:** `FILE_EMPTY` -> `FILE_TOO_LARGE` (`LIMITS.positions.maxBytes`) -> extension `pic | tupel |
  beb` -> `FORMAT_UNSUPPORTED reason 'nativeVendorFormat'`; extension `xlsx | xls` or ZIP (`PK\x03\x04`) / CFB
  (`D0 CF 11 E0`) magic -> `FORMAT_UNSUPPORTED reason 'spreadsheet'` -> `decodeText` -> detect -> family parser.
  Excel 2003 XML (`urn:schemas-microsoft-com:office:spreadsheet`) is also `'spreadsheet'`.
- **XLSX is out of scope for v1:** users export CSV (the UI says so). No SheetJS, no ZIP reader here.
- **Families and exact rules:** spec 3.3 table (MicronMapper marker rows of one family, three capital letters plus
  digits: AXO, AHY, BTH… not tied to the version, with the single `Application:` row naming V1.4 or V1.6; ScanAdaptor
  `ToothNumber` + `Mat0..Mat3`; ImplantPositions / Matrix4x4 with `Order=row-major` or 16 `Entry` with `indexBase`;
  delimited tables with exactly one of `Mat0..Mat3` / `m00..m33` / marker + `originX..indexedZ`, identical data
  across the delimiters that parse; JSON `positions[]` / array / `{matrix}` with `units` and `matrixOrder`
  (`format: "expertsddt-positions"` implies row-major); iCam `<name>_Origin/_X/_Y/_Z` endpoints, equal axis lengths
  within 1e-4 relative, normalised, then `validateRigid(m, 1e-5)`).
- **Sites:** `id` = `site-1..n` in file order; `label` must match `/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u` (else
  `LABEL_INVALID {row}`), unique (else `LABEL_DUPLICATE {row}`); `matrix` through `validateRigid` (default
  `RIGID_TOLERANCE`; rethrow as `MATRIX_NOT_RIGID {...details, row}`); `source` = the format id; `flags = {}`.
  More than `LIMITS.positions.maxPositions` -> `TOO_MANY_POSITIONS {limit}`; none -> `POSITIONS_EMPTY`.
- **Units:** JSON and matrix XML must declare mm (`UNITS_MISSING` / `UNITS_NOT_MM`); tables may omit them
  (warning `UNITS_ASSUMED_MM`); ScanAdaptor units, if present, must be mm; MicronMapper and iCam are mm.
- **Refused without guessing:** column-major (`FORMAT_UNSUPPORTED reason 'columnMajor'`), quaternions
  (`'quaternion'`), other MicronMapper versions (`'unknownVersion'`), two marker families in one MicronMapper file
  (`POSITIONS_MALFORMED reason 'markerFamily' {row}`), unnamed or extra columns
  (`POSITIONS_MALFORMED reason 'columns'`), several delimiters giving different data (`POSITIONS_AMBIGUOUS`).
- **XML reader:** XML declaration (first thing only), comments, elements, attributes with `'` or `"`, character
  data, CDATA, the 5 predefined entities and numeric character references. `<!DOCTYPE`, `<!ENTITY` and any other
  processing instruction -> `XML_FORBIDDEN`; anything malformed -> `XML_MALFORMED {reason, offset}`. At most
  `PARSE_LIMITS.xmlMaxElements` elements and `xmlMaxDepth` depth. Linear time; no regex backtracking on input.
- **Errors:** `FILE_EMPTY`, `FILE_TOO_LARGE`, `FORMAT_UNKNOWN`, `FORMAT_UNSUPPORTED`, `TEXT_ENCODING`,
  `NUMBER_INVALID`, `POSITIONS_MALFORMED`, `POSITIONS_EMPTY`, `POSITIONS_AMBIGUOUS`, `LABEL_INVALID`,
  `LABEL_DUPLICATE`, `UNITS_MISSING`, `UNITS_NOT_MM`, `XML_MALFORMED`, `XML_FORBIDDEN`, `MATRIX_INVALID`,
  `MATRIX_NOT_RIGID`, `TOO_MANY_POSITIONS`. Warning: `UNITS_ASSUMED_MM`.
- **Tests (minimum):** write each family from the SAME `makeFrames(n, arch)` (your own encoders in
  `test/fixtures/positions.ts`) and compare parsed matrices to the frames: 1e-9, or 1e-5 for 6-decimal MicronMapper.
  Rejections: DOCTYPE / ENTITY / billion-laughs text, column-major, quaternion, inches, duplicate label, extra column,
  ambiguous delimiter, oversize, NaN, `.pic`, XLSX magic. `detectPositionFormat` never throws on random text.

## 3. geometry + detect (builder 3)

Files: `geometry/weld.ts`, `geometry/components.ts`, `geometry/pca.ts`, `geometry/bvh.ts`, `detect/sites.ts`.

```ts
// geometry/weld.ts
/** Merges vertices closer than toleranceMm (grid hashing incl. neighbour cells); drops triangles that become degenerate; keeps the first vertex's color. */
export function weld(mesh: TriMesh, toleranceMm?: number /* default 1e-5 */): TriMesh;

// geometry/components.ts
export interface ComponentLabels {
  count: number;
  /** Per triangle, 0..count-1; components numbered in order of their lowest triangle index. */
  triangleComponent: Uint32Array;
}
/** Triangles sharing a vertex index are connected (union-find). Weld first for tolerance. */
export function connectedComponents(mesh: TriMesh): ComponentLabels;
/** One compact mesh per component (unused vertices removed), in label order. */
export function extractComponents(mesh: TriMesh, labels: ComponentLabels): TriMesh[];

// geometry/pca.ts
export interface Pca {
  centroid: Vec3;
  /** Unit axes, descending variance, right-handed: axes[2] = axes[0] × axes[1]. */
  axes: [Vec3, Vec3, Vec3];
  variances: Vec3;
}
export function pcaOfPoints(points: ArrayLike<number>, weights?: ArrayLike<number>): Pca;
/** Exact area-weighted covariance of the surface (not of the vertices). */
export function pcaOfSurface(mesh: TriMesh): Pca;

// geometry/bvh.ts
export interface Bvh {
  readonly mesh: TriMesh;
  // internals: typed arrays only (no object per node)
}
export interface SurfaceHit {
  triangle: number;
  point: Vec3;
  distanceMm: number;
}
export function buildBvh(mesh: TriMesh): Bvh;
/** Exact closest point on the surface (uses core closestPointOnTriangle); null if farther than maxDistanceMm. */
export function closestPoint(bvh: Bvh, p: Readonly<Vec3>, maxDistanceMm?: number): SurfaceHit | null;
/** Nearest hit along the ray, both faces count. */
export function raycast(bvh: Bvh, origin: Readonly<Vec3>, direction: Readonly<Vec3>, maxDistanceMm?: number): SurfaceHit | null;

// detect/sites.ts
export interface MeshComponent {
  index: number;
  mesh: TriMesh;             // the shell; for a body with inner pieces, its outer shell (fitted, linked, aligned)
  areaMm2: number;
  bounds: Bounds;
  centroid: Vec3;
  /** area < 0.5 % of the largest AND diagonal < 20 % of the largest (spec 4.1.2): kept, flagged. */
  fragment: boolean;
  /** Shells inside this body (an insert in a cap): never counted, fitted or linked alone; planAssembly keeps them. */
  inner: TriMesh[];
}
/** weld + connectedComponents + extractComponents, inner pieces folded into their body. Order = lowest triangle index, so body i of placeBodies is component i. */
export function splitComponents(captureMesh: TriMesh, options?: { weldToleranceMm?: number }): MeshComponent[];

export interface RecoverOptions {
  seed?: number;
  samples?: number;          // per component, default 400
  maxRmsMm?: number;         // reliable fit, default 0.03
  minCoverage?: number;      // fraction within maxRmsMm, default 0.98
  source?: MeshFormat;       // site.source, default 'stl'
}
export interface RecoverResult {
  sites: ImplantSite[];      // one per reliably (or provisionally) fitted component
  unresolved: number[];      // component indices without a usable fit (UI asks for a matching reference)
  components: MeshComponent[];
  warnings: XchangeWarning[];
}
/** Fits `reference` (implant frame) to every non-fragment component: PCA starts + ICP with core/rigid and geometry/bvh. */
export function recoverSitesFromMesh(captureMesh: TriMesh, reference: ReferenceBody, options?: RecoverOptions): RecoverResult;
/** Position file + capture mesh: give each site the nearest unused component (siteCost: hypot(x, y) + 0.1·|z| + max(0, |z| − 20) in the site frame, greedy, max 10 mm). Returns new site objects. */
export function linkSitesToComponents(sites: readonly ImplantSite[], components: readonly MeshComponent[]): ImplantSite[];
```

- Recovered sites: `id` `site-1..n` and `label` `Implant 1..n` in component order, `matrix` = fitted pose (implant
  frame -> capture) through `validateRigid`, `componentIndex` set. Index ambiguity: if poses rotated about the fitted
  +Z by > 5° fit as well, set `flags.indexAmbiguous` (the matrix keeps an arbitrary clocking) and warn
  `SITE_INDEX_AMBIGUOUS {count}`. A fit within 3 × `maxRmsMm` but failing a check -> `flags.provisional` and
  `SITE_PROVISIONAL {count}`; worse -> `unresolved`. Fragments -> `COMPONENT_FRAGMENTS {count}`.
  A centroid alone is never a datum (spec 4.1.5).
- **One body = the outer shell plus what sits inside it.** A non-fragment shell B is folded into A (`A.inner`, out of
  the list, indices renumbered) when A is the bigger one (diagonal; the lower index for twins), B's centroid lies on
  A's axis (the principal axis whose variance stands apart) and B lies inside A's box, axis-aligned and in A's
  principal frame, all within 2 % of A's diagonal. So a positions STL whose caps each carry an insert counts one body
  per implant, detection fits only the caps (no duplicate implants, no "wrong scan body"), linking never picks the
  insert, and `planAssembly` exports each cap with its insert. Neighbours stick out of each other's box and a body on
  an arch strip is far from the strip's axis, so neither is folded in. The pair test is skipped above 1,024 shells.
- More than `LIMITS.capture.maxComponents` non-fragment components -> `TOO_MANY_COMPONENTS {limit}`.
- **Different coordinate systems.** A centroid more than 20 mm along a site's axis is not that implant's body
  (`siteCost` adds every millimetre beyond 20 in full), so a position file and a mesh in different frames no longer
  link by chance. `state/jobs-handler.readCapture` keeps the links only when at least half of the positions that can
  have a body (min(sites, bodies)) found one; otherwise no site is linked and the result carries `framesDiffer: true`
  (the UI offers to use only one of the two files, `captureOnly`). `planAssembly` returns `normalized` only for bodies
  at the sites; `fixed` carries `atSites` (false: one body per site, but elsewhere; the UI does not apply it).
- **Errors:** `INVALID_ARGUMENT`, `MESH_EMPTY`, `DEGENERATE_GEOMETRY`, `TOO_MANY_COMPONENTS`, `INSUFFICIENT_DATA`,
  `REFERENCE_NO_MATCH` (reference unusable, e.g. zero area). Warnings: `COMPONENT_FRAGMENTS`,
  `SITE_INDEX_AMBIGUOUS`, `SITE_PROVISIONAL`.
- **Tests (minimum):** `placeBodies(makeFrames(4..8), makeScanBody())` -> every frame recovered within 20 µm (origin)
  and 0.05° (`rotationAngleBetween`), also with `addNoise` 10 µm (looser: 30 µm / 0.3°); revolution body -> origin and
  axis recovered, `indexAmbiguous` true; the arch strip as an extra component -> `unresolved`; tiny fragment flagged;
  `closestPoint` / `raycast` match brute force; `weld` merges a split mesh; `linkSitesToComponents` on shuffled sites;
  caps with an insert (`test/fixtures/detect.capWithInsert`) -> one body each, found once with the cap or the cap and
  insert as reference, linked to the cap; an off-axis shell inside the box stays apart; a body 47 mm along a site's
  axis is never linked; files in different frames -> `framesDiffer`, the STL as geometry `fixed` with `atSites` false.

## 4. align (builder 4)

Files: `align/kdtree.ts`, `icp.ts`, `multistart.ts`, `seeds.ts`, `landmarks.ts`, `metrics.ts`, `deviation.ts`,
`protocol.ts`, `handler.ts`, `worker.ts`, `client.ts`. PCA for the starts: compute it from your samples with
`core/linalg.eigenSymmetric` (do not import `geometry/`).

```ts
// align/kdtree.ts
export interface KdTree {
  readonly points: Float64Array | Float32Array;
  // internals: typed arrays only
}
export function buildKdTree(points: Float64Array | Float32Array): KdTree;
/** Index of the nearest point, or -1 if none within maxDistanceMm. */
export function nearest(tree: KdTree, x: number, y: number, z: number, maxDistanceMm?: number): number;

// align/icp.ts
export interface IcpTarget {
  points: Float64Array;   // jaw surface samples (or vertices)
  normals: Float64Array;  // unit
  tree: KdTree;
}
export function buildIcpTarget(jaw: TriMesh, options?: { samples?: number; seed?: number }): IcpTarget;
export interface IcpOptions {
  maxIterations?: number;        // 60
  trimFraction?: number;         // 0.8: keep the closest 80 % of pairs
  maxCorrespondenceMm?: number;  // 1.0
  minNormalDot?: number;         // 0.35
  convergenceMm?: number;        // 1e-5
  convergenceRad?: number;       // 1e-5
  onIteration?: (iteration: number, rmsMm: number) => void;
  /** Checked every iteration; true -> throw XchangeError('CANCELLED'). */
  shouldCancel?: () => boolean;
}
export interface IcpResult {
  transform: Mat4;
  rmsMm: number;
  pairs: number;
  iterations: number;
  converged: boolean;
}
/** Trimmed ICP from `initial`: point-to-plane steps (core solvePointToPlane), point-to-point (kabsch) when it returns null or far from the optimum. */
export function icp(source: SurfaceSamples, target: IcpTarget, initial: Mat4, options?: IcpOptions): IcpResult;

// align/multistart.ts
export type AlignStage = 'prepare' | 'coarse' | 'fine' | 'metrics';
/** PROVISIONAL (quality-views, from Fernando's 8 aligned arches); his tolerance answer (report question 1) sets the final numbers. */
export interface QualityThresholds {
  goodRmsMm: number;          // 0.11  (was 0.05 on the whole body)
  goodCoverage: number;       // 0.75  (was 0.95)
  acceptableRmsMm: number;    // 0.16  (was 0.10)
  acceptableCoverage: number; // 0.50  (was 0.80)
  minVisible: number;         // 0.55: good and acceptable need this visible fraction, else at best weak
  /** Another finalist ending > toleranceMm from the best (any sample) and scoring within max(ratio · best, best + slack) -> 'ambiguous'. */
  ambiguityRatio: number;     // 1.1
  ambiguitySlackMm: number;   // 0.005 (added at integration: near-zero residuals make any ratio too tight)
  usableCoverage: number;     // 0.45 (was 0.40): below -> 'failed'
  siteUsableCoverage: number; // 0.30: one implant below -> 'poor' (a distorted scan lands on single implants)
  symmetryTolerance: number;  // 0.01
}
export const DEFAULT_QUALITY: QualityThresholds;
export interface AlignOptions extends IcpOptions {
  seed?: number;              // 1
  sourceSamples?: number;     // 2500
  toleranceMm?: number;       // 0.1, the coverage tolerance
  quality?: Partial<QualityThresholds>;
  onProgress?: (stage: AlignStage, fraction: number) => void;
}
/** Global search (capture pose, scan-body seeds, identity and 24 PCA axis matchings, turns about the jaw's normal when no seed fits) -> coarse ICP -> up to 5 finalists -> fine ICP + untrimmed polish -> metrics + status. With `initial`, refine locally first and search globally only if that is not 'good'. */
export function multiStartAlign(parts: readonly AssemblyPart[], target: IcpTarget, options?: AlignOptions & { initial?: Mat4 }): AlignmentResult;

// align/landmarks.ts
export interface LandmarkFit {
  transform: Mat4;
  mode: 'translation' | 'axis' | 'full';
  rmsMm: number;
}
/** 1 pair: translation. 2 pairs or collinear: minimal rotation aligning the segment + translation (roll free). 3+ non-collinear: kabsch. */
export function landmarkAlign(pairs: readonly LandmarkPair[]): LandmarkFit;
/** Guided point of a site: top centre of the body (bbox centre in X/Y, max Z, implant frame) in capture coordinates. */
export function guidePoint(site: ImplantSite, bodyInImplantFrame: TriMesh): Vec3;
/** Order for the guided clicks 1-2-3-4: from one end of the arch to the other; deterministic. */
export function orderSitesAlongArch(sites: readonly ImplantSite[]): ImplantSite[];
/** landmarkAlign, then local ICP refinement from that pose (no global search), then metrics. method 'landmarks'. */
export function alignFromLandmarks(parts: readonly AssemblyPart[], target: IcpTarget, pairs: readonly LandmarkPair[], options?: AlignOptions): AlignmentResult;

// align/metrics.ts
export interface FitMetrics {
  rmsMm: number;     // visible samples, each distance capped at 3 × toleranceMm
  p95Mm: number;     // visible samples, uncapped
  coverage: number;  // share of the visible samples within toleranceMm
  visible: number;   // share of all samples that are visible
  perSite: SiteFit[];
}
/** Points on one part with their normals (any winding). */
export interface PartPoints { points: ArrayLike<number>; normals: ArrayLike<number> }
/** mm from every point (moved by transform) to the jaw, and whether it is hidden from the scan (rule below). */
export function jawDistances(clouds: readonly PartPoints[], surface: TriangleTree, transform: Mat4, toleranceMm: number, maxMm?: number): { mm: Float64Array; hidden: Uint8Array }[];
/** Fit on the part of the bodies the scan sees (no trimming), exact on the jaw triangles. */
export function measureFit(parts: readonly AssemblyPart[], target: IcpTarget, transform: Mat4, options?: { toleranceMm?: number; samplesPerSite?: number; seed?: number }): FitMetrics;
/** good / acceptable / weak by rms, coverage and visible (the set's and each implant's grade). */
export function grade(m: Pick<FitMetrics, 'rmsMm' | 'coverage' | 'visible'>, q: QualityThresholds): 'good' | 'acceptable' | 'weak';
export function statusOf(m: Pick<FitMetrics, 'rmsMm' | 'coverage' | 'visible'>, flags: readonly AlignmentFlag[], q: QualityThresholds): AlignmentStatus;
/** Metrics of a pose the user placed by hand: method 'manual', flag 'manualPose'. */
export function measureManualPose(parts: readonly AssemblyPart[], target: IcpTarget, transform: Mat4, options?: AlignOptions): AlignmentResult;

// align/deviation.ts
/** Unsigned distance in µm from every vertex of meshA (after transformA) to the SURFACE of meshB. Exact (vs brute force, 0.5 µm) below 200 µm; may be approximate above 1000 µm. */
export function deviationMap(meshA: TriMesh, meshB: TriMesh, transformA?: Mat4): Float32Array;
/** The colour map (the worker's 'deviation' answer): µm per vertex of each part, clamped to maxUm, NaN where hidden from the scan (as measureFit leaves it out). */
export function partDeviations(parts: readonly AssemblyPart[], surface: TriangleTree, transform?: Mat4, toleranceMm?: number, maxUm?: number): Float32Array[];

// align/protocol.ts
export type AlignOptionsData = Omit<AlignOptions, 'onProgress' | 'onIteration' | 'shouldCancel'>; // functions cannot be posted
export type AlignRequest =
  | { type: 'setJaw'; id: number; jaw: TriMesh }
  | { type: 'auto'; id: number; parts: AssemblyPart[]; initial?: Mat4; options?: AlignOptionsData }
  | { type: 'landmarks'; id: number; parts: AssemblyPart[]; pairs: LandmarkPair[]; options?: AlignOptionsData }
  | { type: 'measure'; id: number; parts: AssemblyPart[]; transform: Mat4; options?: AlignOptionsData }
  | { type: 'deviation'; id: number; parts: AssemblyPart[]; transform: Mat4 };
export type AlignResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; stage: AlignStage; fraction: number }
  | { type: 'result'; id: number; result: AlignmentResult }
  | { type: 'deviation'; id: number; perSite: { siteId: string; distancesUm: Float32Array }[] }
  | { type: 'error'; id: number; error: XchangeErrorPayload };

// align/handler.ts (all logic; testable in Node without a Worker)
export function createAlignHandler(post: (message: AlignResponse, transfer?: Transferable[]) => void): (message: AlignRequest) => void;

// align/worker.ts: only wires createAlignHandler to the worker scope. Both DOM and WebWorker libs are loaded,
// so type the scope explicitly: const scope = self as unknown as DedicatedWorkerGlobalScope;

// align/client.ts
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent | ErrorEvent) => void): void;
  terminate(): void;
}
export interface CallOptions {
  signal?: AbortSignal;
  onProgress?: (stage: AlignStage, fraction: number) => void;
}
export class AlignClient {
  /** Default factory: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }). */
  constructor(createWorker?: () => WorkerLike);
  /** Copies the jaw (structured clone; the caller keeps its arrays). The worker keeps its IcpTarget between calls. */
  setJaw(jaw: TriMesh): Promise<void>;
  autoAlign(parts: readonly AssemblyPart[], options?: AlignOptionsData & { initial?: Mat4 }, call?: CallOptions): Promise<AlignmentResult>;
  alignFromLandmarks(parts: readonly AssemblyPart[], pairs: readonly LandmarkPair[], options?: AlignOptionsData, call?: CallOptions): Promise<AlignmentResult>;
  measure(parts: readonly AssemblyPart[], transform: Mat4, options?: AlignOptionsData, call?: CallOptions): Promise<AlignmentResult>;
  /** Per site id: µm per vertex of that part's mesh (after transform) to the jaw surface. */
  deviation(parts: readonly AssemblyPart[], transform: Mat4, call?: CallOptions): Promise<Map<string, Float32Array>>;
  /** Forgets the jaw: running and queued calls are CANCELLED, the worker (and its IcpTarget) is terminated. */
  clearJaw(): void;
  dispose(): void;
}
```

- **Result semantics:** a bad fit is not an exception: return `status: 'failed'` with the best attempt's metrics
  (the UI shows "last attempt, not applied"). Throw only for unusable input: no jaw set or empty parts
  (`INSUFFICIENT_DATA`), fewer than 6 pairs everywhere (`ALIGNMENT_FAILED reason 'noPairs'`).
- **Search** (align-robust, from Fernando's 8 real arches; `seeds.ts`, `multistart.ts`, `icp.ts` `polish`):
  - Seeds: the parts' wall radius (samples moved by r along their normals pile up on the axis; refined to the wall's
    mean distance from each part's axis), the parts' axes and the scanned bodies of that radius in the jaw (fullest
    peaks of the same histogram on 40 k jaw samples), then site <-> scanned-body pairs at equal distance and axis angle,
    each a kabsch fit on the top end and the axis, kept by the number of sites it puts on a scanned body (up to 6).
    Winding-agnostic. No seeds for 1 part or parts without a round wall; without the bodies in the jaw, no seed puts
    3 sites on scanned bodies.
  - The 24 PCA matchings assume the implant set shares the jaw's in-plane axes; real sets are 15-35° off. Unless a seed
    puts max(3, parts - 1) sites on scanned bodies, the 8 matchings that put the parts' normal axis on the jaw's turn by
    15°-75° about it (voted translation only). The vote counts in one dense grid (2 M cells at most).
  - Sizes (vote cell, coarse correspondence radius) come from the parts' box in their PCA frame, so the result does not
    depend on how the capture arrives: on the real arches every start ends on one pose (spread <= 3 µm).
  - Finalists: the first 3 coarse fits may be close (not distinct) if every sample ends > toleranceMm from the others;
    then distinct ones up to 5. Each: fine ICP, then `polish` (icp untrimmed with pairs within poseScore's cap,
    3 × toleranceMm; kept only if poseScore improves). poseScore ranks them. The 80 % trim alone held a fixed point
    0.57° off on a real case; the robust (MAD) polish is gone (never kept after this one). `alignFromLandmarks` polishes
    the same way.
- **Metrics on the visible part** (quality-views; before, every sample counted and the 2-3 mm of each body under the
  gum read 'weak' on every correct real case, 'failed' on one): a sample is hidden when it lies more than
  3 × toleranceMm (0.3 mm, poseScore's cap) from the jaw and the scanned surface does not clearly face it (offset within
  60° of the outward normal): under the gum, where the scanner never looked. Farther samples the scan faces stick out
  where it shows free space: visible misses. The scan's outside is the side its normals take where the parts lie on it
  (samples within the tolerance, each part's normals turned outward first), so neither winding matters. rms, p95 and
  coverage are over the visible samples (rms capped at 3 × toleranceMm: a scanned screw recess the body file lacks
  counts as a miss, not as millimetres); `visible` is their share. Known limit: a set pushed straight along the implant
  axes slides on the scanned walls and shows only at the tops (1 mm in: weak or acceptable; 2 mm: weak or failed).
- **Status** (`DEFAULT_QUALITY`): `failed` (coverage < usableCoverage: nothing usable) -> `ambiguous` (flag
  `ambiguousAlternative`, or nearly isotropic source PCA within 1 % -> `symmetricSource`) -> `good` (visible >=
  minVisible, rms <= goodRmsMm and coverage >= goodCoverage) -> `acceptable` (visible >= minVisible, rms <=
  acceptableRmsMm, coverage >= acceptableCoverage) -> `weak`. Per implant (`state/case.siteStatus`): the same grade,
  `poor` below siteUsableCoverage. `flags` always contains `visualCheckRequired`. The thresholds are PROVISIONAL, from
  Fernando's 8 arches: his poses read good (rms 0.07-0.10 mm, coverage 0.80-0.94, visible 0.68-0.96) except the
  stretched case 2 upper, acceptable (0.149 mm / 0.54); the same poses moved 2 mm and 3° in 12 random directions all
  read failed (96 of 96), and so does the case 3 MM3.0 set aligned without the exchange. Fernando's tolerance answer
  (report question 1) sets the final numbers: keep them in `DEFAULT_QUALITY`, nowhere else (the UI interpolates them).
- **Cancel and progress:** algorithms are synchronous and report through `onProgress` / `onIteration`. The
  client cancels by terminating the worker: the promise rejects with `CANCELLED` at once and the next call
  re-creates the worker and re-sends the last jaw (`ponytail:` simple and instant; no shared memory needed).
  Calls are serialised FIFO; aborting a queued call removes it. Worker `error` event -> `WORKER_FAILED`. Errors cross
  postMessage as `toErrorPayload` / `fromErrorPayload`.
- **Errors:** `INVALID_ARGUMENT`, `CANCELLED`, `INSUFFICIENT_DATA`, `DEGENERATE_GEOMETRY`, `ALIGNMENT_FAILED`,
  `LANDMARKS_INVALID {reason: 'none' | 'coincident' | 'nonFinite'}`, `WORKER_FAILED`, `INTERNAL`.
- **Tests (minimum, spec 7.5):** `makeSyntheticCase` with `maxAngleRad: Math.PI` over several seeds -> `transform`
  within 20 µm / 0.05° of `captureToJaw` noise-free, RMS < 30 µm with `noiseSigmaMm: 0.01`, status `good`; 1 implant
  with `makeRevolutionBody` -> `ambiguous`; landmarks with 1, 2, 3 and 4 pairs hit the three modes and refine to the
  truth; `deviationMap` vs brute force; client <-> handler through a fake in-process `WorkerLike`: result, progress,
  error payload, cancel then reuse. Budget: 4 implants on a 50 k-triangle jaw < 10 s in the test runner. Search
  (`multistart-search.test.ts`, `seeds.test.ts`): a set 15-35° off the jaw's axes with round bodies 2.5 mm under the
  gum and with prism bodies (no seeds: the turns), scanned bodies off the layout (result scores <= the truth), a near
  rival flagged; wall radius of several bodies and windings, seeds with half the jaw wound the other way, none
  without round walls. Visible part (`metrics.test.ts`, `deviation.test.ts`; `test-utils.buriedJaw`): four bodies 2 mm
  deep under a gum line -> the exact pose good (the whole-body metric read weak), 2 mm / 3° off in six directions and
  ±2 mm along the axes failed, the same numbers with the jaw or the parts wound the other way; `partDeviations` NaN
  under the gum line, whatever the windings.

## 5. export (builder 5)

Files: `export/placement.ts`, `export/zip.ts`, `export/report.ts`, `export/bundle.ts`.

```ts
// export/placement.ts
export interface PlacedReplacement {
  siteId: string;
  label: string;
  geometryId: string;
  geometryName: string;
  /** implant frame -> output coordinates = assemblyTransform · site.matrix */
  matrix: Mat4;
  /** transformMesh(geometry.mesh, matrix) */
  mesh: TriMesh;
}
export function placeReplacements(sites: readonly ImplantSite[], geometryBySite: Readonly<Record<string, ReplacementGeometry>>, assemblyTransform: Mat4): PlacedReplacement[];

// export/zip.ts
export interface BundleFile {
  name: string;
  bytes: Uint8Array;
}
/** Stored (method 0) ZIP: CRC-32, UTF-8 names (flag 0x0800), fixed DOS date 1980-01-01 00:00, no extra fields, no ZIP64. */
export function zipStore(files: readonly BundleFile[]): Uint8Array;
export function crc32(bytes: Uint8Array, crc?: number): number;

// export/report.ts
/** Geometry id of a site's own body from the positions file ("No exchange"): in sites[].geometry and matchedWith. */
export const CAPTURE_BODY_ID = 'capture';
/** The main file: `${arch}_implant_position.stl`. */
export function mainFileName(arch: Arch): string;
export interface ExportReport { /* exactly the schema below */ }
export function buildReport(request: ExportRequest, placed: readonly PlacedReplacement[], files: readonly BundleFile[]): ExportReport;
/** README.txt, Spanish then English, CRLF line endings. */
export function buildReadme(report: ExportReport): string;

// export/bundle.ts
export interface ExportBundle {
  zipName: string; // `DDT-Xchange_${arch}_export.zip`
  zip: Uint8Array;
  files: BundleFile[];
  report: ExportReport;
}
export function buildBundle(request: ExportRequest): ExportBundle;
/** NFKD, diacritics removed, only [A-Za-z0-9._-] (others -> '_'), trimmed, <= 64 chars, Windows reserved names prefixed '_', empty -> fallback. */
export function safeFilename(label: string, fallback: string): string;
```

- **Bundle entries, in this order:** the main file `<upper|lower>_implant_position.stl` (every placed replacement, the
  group to open in Exocad; named as Fernando names his files, workflow-map G7; it was `replacements.stl`),
  `combined.stl` (jaw mesh, re-serialised, plus every replacement; without a jaw it equals the main file),
  `replacement_<safeFilename(label, 'implant_N')>.stl` per site in site order (case-insensitive duplicates get `_2`,
  `_3`), `jaw.stl` or `jaw.ply` = `jaw.originalBytes` byte for byte (only with a jaw), `report.json`
  (`JSON.stringify(report, null, 2)`), `README.txt`. STLs via `writeBinarySTL`. Shells are concatenated: no Boolean, no
  cutting (say so in notes and README). Without a jaw the bundle is complete in the capture's coordinates: exporting
  without a scan is a normal path.
- **`ExportRequest.matchedWith`** (optional): per site id, `{ id, name }` of the body the alignment was made with.
  `CAPTURE_BODY_ID` (`'capture'`) is the site's own body from the positions file ("No exchange", or the captured-bodies
  surfaces); a site missing from it was aligned with the geometry it exports (the default). Copied into
  `alignment.perSite[].matchedWith` (whitelisted `id`, `name`; anything else attached is dropped). When some site
  exports another body than it was aligned with (an exchange after aligning: the alignment keeps its pose and metrics),
  notes get the `exchanged` sentence and README the line "Alineado con …; se exporta …" / "Aligned with …; exported
  with …" (the file's bodies read "los cuerpos del archivo de posiciones" / "the bodies of the positions file").
  A "No exchange" geometry is exported with id `capture` in `sites[].geometry`.
- **Validation:** every site needs a geometry (`EXPORT_GEOMETRY_MISSING {site: index}`); a `matchedWith` entry of a
  perSite site needs a string `id` and `name` (`INVALID_ARGUMENT {reason: 'matchedWith', index}`); `validateRigid`
  on `assemblyTransform`; the total ZIP size is computed before allocating and must be <= `LIMITS.bundle.maxBytes`
  (`EXPORT_TOO_LARGE {limitBytes, bytes}`); <= 65 535 entries; entry names non-empty, <= 255 UTF-8 bytes, no `/ \ :`,
  no `..`, no control characters, unique ignoring case (`EXPORT_NAME_INVALID {index}`).
- **report.json schema (v1).** No input file names exist anywhere in `ExportRequest`, so none can leak; keep it so.

```jsonc
{
  "schema": "ddt-xchange-report",
  "schemaVersion": 1,
  "application": "DDT Xchange",
  "appVersion": "<request.appVersion>",
  "createdAt": "<request.createdAt>",
  "units": "mm",
  "matrixConvention": "4x4 row-major, column vectors: p' = M·p",
  "implantFrame": "origin = connection, +Z = implant axis, +X = indexed direction",
  "arch": "upper | lower",
  "coordinateFrame": "jaw | capture | capture-adjusted",   // jaw present -> jaw; identity -> capture; else capture-adjusted (fixes spec C3)
  "captureToOutput": [16 numbers],
  "capture": { "format": "<CaptureFormat>", "siteCount": 4 },
  "alignment": null | {
    "method": "auto | landmarks | manual", "status": "<AlignmentStatus>",
    "rmsMm": 0.0, "p95Mm": 0.0, "coverage": 0.0, "visible": 0.0, "toleranceMm": 0.1, "flags": ["visualCheckRequired"],
    "matchesExport": true,                                  // maxAbsDiff(alignment.transform, assemblyTransform) <= 1e-9
    "perSite": [{ "siteId": "site-1", "label": "AXO1", "rmsMm": 0.0, "coverage": 0.0, "visible": 0.0, "samples": 400,
                  "matchedWith": { "id": "capture | <geometry id>", "name": "<name>" } }]   // the body this site was aligned with
  },
  "sites": [{
    "id": "site-1", "label": "AXO1", "source": "<CaptureFormat>",
    "indexAmbiguous": false, "provisional": false,
    "implantToCapture": [16 numbers], "implantToOutput": [16 numbers],
    "geometry": { "id": "<id>", "name": "<library name>" },
    "file": "replacement_AXO1.stl"
  }],
  "jaw": null | { "file": "jaw.stl | jaw.ply", "format": "stl | ply", "preservation": "exact-original-bytes",
                  "bytes": 123, "crc32": "1a2b3c4d", "triangles": 456 },
  "files": [{ "name": "lower_implant_position.stl", "bytes": 123, "crc32": "1a2b3c4d" }],   // every entry except report.json and README.txt, main file first
  "notes": ["<fixed English sentences: no Boolean/cut, visual check required, index ambiguity when present, exchanged after aligning when present, not a clinical validation>"]
}
```

- **Errors:** `EXPORT_GEOMETRY_MISSING`, `EXPORT_NAME_INVALID`, `EXPORT_TOO_LARGE`, `INVALID_ARGUMENT`,
  `MATRIX_INVALID`, `MATRIX_NOT_RIGID`.
- **Tests (minimum):** placed vertices equal `assemblyTransform · site.matrix · geometry` computed independently
  (float32 tolerance); `jaw.*` identical to `originalBytes`; the ZIP read back by a tiny independent reader in the
  test (local + central headers, CRCs, sizes, UTF-8 flag, names, EOCD); report keys exactly the schema; `coordinateFrame`
  for the three cases; duplicate and hostile labels (`../x`, `CON`, `ä/ö`) produce safe unique names; oversize refused
  before allocating (fake a huge request with a stubbed mesh count, not real memory); the main file named after the arch
  and first, equal to every per-site file in order; `matchedWith` default (the exported geometry), given (the file's
  bodies, then an exchange: note + README line in both languages, nothing else copied), one implant exchanged, and a
  malformed entry refused.

---

## 6. Later stages (not in this batch)

- `state/`: typed store, case lifecycle (a new valid capture replaces the case; invalid keeps it), geometry library
  in IndexedDB (versioned schema, size and entry limits, never deletes silently), favourite applies at once to all
  implants or to one, multi-file capture (position file + mesh -> `linkSitesToComponents`). Workflow 2
  (`state/case.ts`, workflow2-export): `capturedBodies(sites, components, name)` = "No exchange", each site's own
  captured body in its implant frame (case geometry `capture:<site id>`, kind `capture`); `alignedWith` (the surfaces
  and geometry of each site when the alignment was made) is set and cleared with `alignment`; `chosenBodies` (what a
  new alignment uses) and `measuredBodies` (what a re-measure and the color map use: `alignedWith`, else the choice);
  `exchangedSites`, `shownDeviation` (no map on an exchanged part), `matchedBodies` (report.json matchedWith) and
  `stepAfterGeometry` (a pick for all implants goes on to step 3, or back to step 4 once step 3 is done). Tests
  (`state.test.ts`, `test/ux/workflow2.ux.test.ts`): a BTH CSV + STL of caps with inserts, each body back at its site
  is the captured shell, exchanges of all or one implant, the old re-measure of a healing cap reads weak or failed where
  the kept alignment stays good, a hand move measured with the file's bodies, the map leaving the exchanged parts,
  the export request and its real bundle.
- `viewer/`: three.js scene, exocad mouse preset, picking, assembly manipulation (drag, Ctrl + rotate, arrows, flip),
  markers, opacity, FOV, colour map legend (grey = not seen by the scan: NaN from `partDeviations`). Builds its own
  buffers once; never re-uploads per render. View presets per case (`viewer/presets.ts`, quality-views):
  `archFrame(implants, jawShape)` -> `{ occlusal, anterior }` in world axes, `presetView(preset, arch, frame)`;
  occlusal = the implants' mean axis averaged with the normal of the plane through their connections (3 or more in an
  arch), anterior = across the line through the two implants farthest apart, toward the others; implants that do not
  sit on the jaw (median connection > 6 mm from it) or too few leave it to the jaw (mean normal; outline main axis,
  front at its narrow end); nothing -> the world table (+Z occlusal on the lower arch, -Y anterior). On Fernando's 8
  arches every preset lands within 8.6° of the jaw's normal and mirror axis (the world table: 57-178° off).
- `ui/`: four-step wizard in the site's style, ES/EN, keyboard alternative for guided clicks, privacy copy, the
  optional marketing e-mail (the only network call).

Known duplication to unify at integration (`ponytail:` accepted for parallel building): ICP in `detect/` (BVH) and in
`align/` (k-d tree); `geometry/bvh` vs the k-d tree candidates in `align/deviation`. Unified at integration: the mesh
check (`core/mesh.checkMesh`; `geometry/check.ts` removed). The two ICPs and the two closest-point trees remain.

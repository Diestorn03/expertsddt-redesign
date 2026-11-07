# DDT Xchange (Scan Studio)

Free browser tool for expertsddt.com: replace the implant geometry of a capture (scan-body mesh or position table)
with library geometry in the same positions, optionally align everything to the jaw scan, and export a ZIP.
Clean TypeScript rebuild; the client's ChatGPT prototype is a specification only (no code or data copied).

Commands (from the repo root): `npm run test:xchange`, `npm run typecheck:xchange`, one file:
`npx vitest run src/xchange/<path>`.

## Folders

| Folder | What lives there |
|---|---|
| `core/` | Shared types, errors, limits, vec3/mat4 (row-major rigid), rigid fits, mesh helpers, sampling, binary STL writer, strict text decoding. Pure, worker-safe, no dependencies |
| `io/mesh/` | STL (binary/ASCII), PLY, OBJ parsers -> indexed `TriMesh`, content-based detection, limits |
| `io/positions/` | Implant position files: MicronMapper CSV, ScanAdaptor XML (strict mini XML reader, no DOMParser), matrix tables, JSON, ImplantPositions XML, iCam TXT. XLSX is out of scope for v1 (users export CSV) |
| `geometry/` | Weld, connected components, PCA, BVH (closest point, ray pick) |
| `detect/` | Implant frames from a capture mesh: component split, reference fitting, index ambiguity, linking position files to components |
| `align/` | k-d tree, trimmed ICP, multi-start auto alignment, guided landmarks 1-2-3-4, metrics, deviation map (µm), Web Worker protocol + Promise client |
| `export/` | Replacement placement, combined/individual STLs, jaw copied byte for byte, `report.json`, README (ES/EN), stored ZIP |
| `state/` | Later: typed case store, geometry library (IndexedDB) |
| `viewer/` | Later: three.js scene, exocad-style controls, picking, manipulation |
| `ui/` | Later: the 4-step wizard, i18n, accessibility, optional e-mail capture |
| `test/fixtures/` | Deterministic synthetic generators (scan bodies, arch, frames, full cases) and file encoders |

`CONTRACTS.md` has the exact exported signatures, error codes and rules for each module.

## Privacy rules (non-negotiable)

- Files never leave the user's computer: parsing, alignment and export run in the browser. No upload, no telemetry.
  The only network call is the optional marketing e-mail, sent by the UI.
- No login and no patient data. Never store, show, log or export input **file names** (they often contain the
  patient's name). No type in `core/types.ts` has a file-name field; keep it that way.
- Error and warning details carry codes, numbers and reason ids only: never file names or text copied from a file.
- Tests use synthetic data generated in code (`test/fixtures`). Never commit or load real scans, and never open the
  client's sample archive (it contains a real patient name).

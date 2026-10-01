# Four-Level Logic Workshop Implementation Plan

**Goal:** Deliver four playable circuit lessons with editing, live signals, exhaustive judging, progression, history, and persistent drafts.
**Architecture:** React Flow editor with a serializable circuit model; DigitalJS headless simulation behind an adapter; independent mathematical judging; browser storage isolated from rendering.
**Tech Stack:** React, TypeScript, Vite, React Flow, DigitalJS, Vitest, Playwright.
**Spec:** ../../logic-lab-design.md; current delivery is stages A and B, lessons L01-L04.

## Constraints

- Preserve the four level interfaces, truth tables, X semantics and single-driver rules.
- Saved progress never substitutes for validation of the current answer.
- Start with the actual game workspace. Chinese task copy, responsive desktop/tablet/mobile layout, icon tools with accessible names.
- No sequential circuits or general component library in this delivery. Level four's NOT uses two NAND inputs tied together in the compiler.
- Files and npm cache remain inside the workspace. This folder is a new application, not an existing Git checkout.

## Task 1: Establish circuit behavior

Files: src/model.ts, src/levels.ts, src/simulator.ts, src/vendor.d.ts, tests/circuit.test.ts.
Interfaces: createCircuit(levelId), validateCircuit(circuit), canConnect(circuit, connection), simulate(circuit, inputs), judge(circuit).

- [x] Write tests for four valid solutions, unknown values, invalid driver connections, forbidden gates, cycles and counterexample feedback.
- [x] Run `npm test`; confirm failures arise from missing behavior.
- [x] Adapt DigitalJS HeadlessCircuit and Vector3vl for synchronous settling, compile NOT to a tied-input NAND, return node and wire values.
- [x] Run tests; confirm all mathematical truth tables independently.

## Task 2: Deliver editor and four-level flow

Files: src/App.tsx, src/CircuitNode.tsx, src/WireEdge.tsx, src/styles.css, src/main.tsx, index.html.
Interfaces: editor commits a Circuit revision, simulator produces values, judge returns rows and first failure.

- [x] Write Playwright flow covering level one connection, failure, passing, level two unlock and reload.
- [x] Run browser test before implementation and observe missing UI.
- [x] Implement draggable nodes, drag/click port connections, edge selection/deletion, undo/redo, zoom, input switches, truth table, hints, pass feedback and level switching.
- [x] Implement all four actual puzzle interfaces and allowed component sets.

## Task 3: Persist and validate complete workflow

Files: src/storage.ts, tests/storage.test.ts, tests/editor.spec.ts, README.md, playwright.config.ts.
Interfaces: save/load versioned workspace state; save failure remains visible; import validates all circuit interfaces and recomputes progress.

- [x] Test save/load, malformed data, per-level drafts and revalidation after import.
- [x] Add versioned local storage, manual export/import, reset confirmation and empty/failed/success states.
- [x] Verify all four levels with browser-driven placement and wiring, wrong answers and live signals, undo/delete/reload and import/export.
- [x] Run `npm test`, `npm run build`, `npm run test:e2e`; inspect desktop/mobile screenshots.
- [x] Start a hidden local server, document its URL and limitations, and mark completed checklist items with evidence.

## Implementation choices

For four small one-bit circuits, use synchronous bounded headless evaluation first; verify this engine before committing to Worker packaging. This keeps the future adapter boundary. LocalStorage is used for the small four-level drafts rather than IndexedDB; save errors are explicit. Both decisions are scoped to this first delivery and recorded in README.

## Verification Evidence

2026-09-30: 14 unit tests passed; 10 Playwright workflows passed; TypeScript and production build passed. Screenshots at 390x844, 1280x720, 1440x1000 and 1920x1080 were generated. Browser checks found no page errors or horizontal overflow in the tested viewport cases. Controlled edge selection and short-viewport table clipping regressions were reproduced and repaired. The desktop check now asserts that the entire test panel footer fits in the viewport. DigitalJS's synchronous headless engine is verified for these lessons; Worker packaging is deferred with the larger-circuit expansion. Production build warns about the size of the third-party simulation bundle, documented in README.

The detached local server is available at http://127.0.0.1:5173/; its startup command returned successfully and HTTP status 200 was verified.

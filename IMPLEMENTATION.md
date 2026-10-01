# Twenty lessons and reusable components

## Contracts

Shared data types live in src/contracts.ts. Levels retain inputs (names) and expected (first numeric output) for compatibility, and add inputPorts, outputPorts and expectedOutputs. Bits are 1, 2, 4 or 8. Component keys are immutable id@version references. The state/time extension adds sequential mode, temporal sequences and DFF d/rst/q ports; grading of sequential lessons uses complete observation sequences rather than the legacy single-capture expected function.

Model API retains existing functions and adds an optional final library argument to connect/canConnect/validateCircuit. addGate retains its first four arguments, then library and bits. getPorts(node, library) returns typed ports. addComponent(circuit,key,position,library,id?) creates an instance.

Component API: packageCircuit(circuit,name,library) returns {definition,key,library}; encapsulateSelection(circuit,nodeIds,name,library) returns {circuit,key,library}; expandComponent(circuit,instanceId,library) returns Circuit. Internal interface nodes use the exact port IDs from the definition. SPLIT out0..outN and JOIN in0..inN are least significant bit first; their bus is in/out.

Simulation API simulate(circuit,inputs,library={},options={state?,tick?}), replaySequence(circuit,library,steps), and judge(circuit,library={}). TestRow retains first-output expected/actual and adds complete output maps, mismatch names and optional scenario/step/cycle metadata. Worker supports simulate/judge/verify/load/tick/reset/replay. Live requests include an electrical sessionKey; worker owns transient runtime state and a bounded trace. verify returns validated consecutive proofs, and load parses and verifies a v3 archive before returning a workspace. Evaluation uses DigitalJS and bounded expansion/events.

## Work Ledger

- [x] Core: typed buses, immutable component graphs, dependency validation, encapsulation/expansion, reusable DigitalJS engine, worker; core acceptance tests.
- [x] Lessons: all 20 definitions and legal reference circuits; exhaustive checks against independent mathematical expected outputs (1,672 cases).
- [x] Storage: v1 migration, schema v2 with complete component dependencies, import transaction and proof verification.
- [x] Editor: component library, packaging and expansion, multi-output/bus controls, complete history, paginated truth table, asynchronous simulation and cancellation.
- [x] Acceptance: counterexample replay, nested component equivalence, history recovery, dependency roundtrip, worker responsiveness, browser screenshots.

## Ownership

Core owns model.ts, components.ts, simulator.ts, simulation.worker.ts, vendor.d.ts and core tests. Lessons own levels.ts and reference fixtures/lesson tests. Integration owns contracts.ts, storage.ts, App.tsx, node/edge views, styling, worker client, browser tests and docs.

## Verification

Run unit tests, browser tests and production build. Every reference circuit must pass every enumerated input, including 512-vector lessons. Verify malformed dependencies and recursion are rejected. Verify UI responds during worker judging and exported/imported dependency graphs are equivalent. Preserve first-four lesson behavior and saved progress.

Completed verification and scope are recorded in [docs/acceptance-report.md](docs/acceptance-report.md).

The next delivered stage is [state and time](docs/state-and-time-design.md), implemented according to [its plan](docs/state-and-time-plan.md). It adds lessons 21–32 and pauses for user testing before architecture/programming work.

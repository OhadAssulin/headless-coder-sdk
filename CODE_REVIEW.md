# Code Review – `feature/interrupt-support` vs `main`

## Findings

## Review #1 Findings (addressed)

1. **Gemini stream close handler swallows CLI exit failures (packages/gemini-adapter/src/index.ts:250-285)**  
   The original `handleClose` marked the stream as `finished` immediately, preventing the `exit` handler from reporting non-zero exit codes or signals. Consumers therefore saw `DONE` with no error even when the CLI crashed. The fix should defer `finished` until the `exit` event runs (or only short-circuit when an abort is already in progress) so worker failures still surface errors.

2. **Codex adapter mislabels worker crashes as user cancellations (packages/codex-adapter/src/index.ts:373-399)**  
   The worker exit handler emitted `createCancelledEvent(...)` for every unexpected exit path, making crashes indistinguishable from user cancellations. The adapter should only emit `cancelled` when `active.aborted` is true; other exits must emit the worker-exit error event without cancellation metadata.

Both findings have since been resolved in subsequent commits.

## Review #2 Findings (current)

No additional blocking issues were identified when re-reviewing `feature/interrupt-support` against `main`. The earlier Gemini and Codex regressions were fixed, and no new regressions or design gaps were observed in the remaining diffs (README/docs updates, new interrupt tests, and adapter refactors). Keep an eye on end-to-end CI once Codex worker changes roll out, but no corrective action is required from this review.

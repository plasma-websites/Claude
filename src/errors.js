// Step-tagged errors so the UI can tell the user (or caretaker) exactly what
// failed and whether retrying makes sense.
export class StepError extends Error {
  constructor(step, message, { retryable = false, status = 502, code = 'upstream_error' } = {}) {
    super(message);
    this.step = step;
    this.retryable = retryable;
    this.status = status;
    this.code = code;
  }
}

export const toPublic = (e) => ({
  error: { step: e.step || 'unknown', code: e.code || 'error', message: e.message, retryable: !!e.retryable },
});

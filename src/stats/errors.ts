/**
 * Typed errors thrown by the EARTHSCOPE statistics engine.
 * @module stats/errors
 */

/**
 * Thrown when a statistical method is asked to run on too little (or
 * degenerate) data, e.g. an OLS fit with fewer than 3 valid points, a
 * correlation where one input has zero variance, or an analysis with fewer
 * than 8 valid annual values. UI code can catch this specifically and show a
 * friendly "not enough data" message instead of a NaN-filled result.
 */
export class InsufficientDataError extends Error {
  /** Minimum number of valid observations the method needs (if applicable). */
  readonly required: number | undefined;
  /** Number of valid observations actually supplied (if applicable). */
  readonly actual: number | undefined;

  constructor(message: string, required?: number, actual?: number) {
    super(message);
    this.name = "InsufficientDataError";
    this.required = required;
    this.actual = actual;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Type guard for {@link InsufficientDataError} (works across bundles/realms by name). */
export function isInsufficientDataError(e: unknown): e is InsufficientDataError {
  return e instanceof InsufficientDataError || (e instanceof Error && e.name === "InsufficientDataError");
}

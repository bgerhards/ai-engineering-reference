/**
 * A `Result` makes failure a value instead of a control-flow surprise.
 *
 * The domain never throws for expected outcomes ("this member is suspended" is
 * an outcome, not an exception), so every caller is forced by the type system
 * to decide what to do about the failure case.
 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/** Transform the success value, leaving a failure untouched. */
export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

/** Chain another fallible step. The first failure short-circuits the rest. */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result);

/**
 * Collect a list of results into a result of a list.
 * Returns the first failure encountered, which keeps error reporting predictable.
 */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

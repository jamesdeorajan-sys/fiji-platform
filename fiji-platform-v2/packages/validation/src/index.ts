export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}
export const valid = <T>(value: T): ValidationResult<T> => ({
  ok: true,
  value,
});
export const invalid = (
  ...issues: ValidationIssue[]
): ValidationResult<never> => ({ ok: false, issues });

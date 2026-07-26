export type Brand<T, B extends string> = T & { readonly __brand: B };
export type EntityId<T extends string> = Brand<string, T>;
export type IsoTimestamp = Brand<string, "IsoTimestamp">;
export type CurrencyCode = Brand<string, "CurrencyCode">;
export type MinorUnits = Brand<number, "MinorUnits">;
export interface Money {
  readonly amountMinor: MinorUnits;
  readonly currency: CurrencyCode;
}
export const minorUnits = (value: number): MinorUnits => {
  if (!Number.isSafeInteger(value))
    throw new TypeError("Money must be a safe integer in minor units");
  return value as MinorUnits;
};
export const currencyCode = (value: string): CurrencyCode => {
  if (!/^[A-Z]{3}$/.test(value))
    throw new TypeError("Currency must be a three-letter uppercase code");
  return value as CurrencyCode;
};

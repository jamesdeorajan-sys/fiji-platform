export const priceWithCredit = ({ offerPriceCents, maxCreditCents, availableCents, minSpendCents = 0 }) => {
  const eligible = offerPriceCents >= minSpendCents;
  const credit = eligible ? Math.max(0, Math.min(maxCreditCents, availableCents, offerPriceCents)) : 0;
  return { offerPriceCents, creditCents: credit, netPayableCents: offerPriceCents - credit, creditEligible: eligible };
};
export const fjd = (cents) => `FJ$${(cents / 100).toFixed(2)}`;
export function dollarsToCents(s) { // strict: digits with up to 2 decimals
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(String(s).trim());
  if (!m) throw new Error(`not a money amount: "${s}"`);
  return +m[1] * 100 + (m[2] ? +m[2].padEnd(2, '0') : 0);
}

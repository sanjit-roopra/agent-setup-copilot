/** Divides two non-negative integers and rounds the result half to even. SPEC 1. */
export function divideHalfEven(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0) {
    throw new RangeError('divideHalfEven takes a non-negative integer and a positive integer');
  }
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  if (remainder * 2 > denominator) return quotient + 1;
  if (remainder * 2 === denominator) return quotient + (quotient % 2);
  return quotient;
}

/** A share of an amount, given in basis points (1 bp = 0.01 percent). */
export function basisPoints(cents, bp) {
  return divideHalfEven(cents * bp, 10000);
}

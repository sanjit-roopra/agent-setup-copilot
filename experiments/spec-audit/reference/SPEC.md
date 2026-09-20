# Shipping fee engine: specification

This document is authoritative. Where the implementation and this document
disagree, the implementation is wrong.

All money is an integer number of cents. All weights are an integer number of
grams. All timestamps are ISO 8601 strings in UTC.

## 1. Rounding

1.1. Whenever a computation produces a fraction of a cent, the result is rounded
to the nearest cent.

1.2. A fraction of exactly half a cent is rounded to the nearest **even** cent
("banker's rounding"). 110.5 becomes 110; 111.5 becomes 112.

1.3. Rounding is performed with integer arithmetic. Floating-point division must
not decide the direction of a tie.

1.4. No other rounding mode is used anywhere in the engine for money.

## 2. Billable weight

2.1. The volumetric weight of a parcel is its volume in cubic centimetres
divided by 5000, expressed in kilograms. Equivalently, one cubic centimetre
counts as one fifth of a gram.

2.2. The billable weight is the larger of the actual weight and the volumetric
weight.

2.3. The billable weight is then rounded **up** to the next multiple of 500
grams. A weight that is already a multiple of 500 grams is unchanged. 1100 grams
becomes 1500 grams.

2.4. A parcel with a non-positive dimension or a non-positive actual weight is
rejected with a `RangeError`.

2.5. The maximum billable weight is 70000 grams. A heavier parcel is rejected
with a `RangeError`.

## 3. Zones

3.1. The destination zone is found from the destination postal code by prefix.

3.2. When more than one prefix in the zone table matches a postal code, the
**longest** matching prefix decides the zone, regardless of the order of the
table.

3.3. A postal code that matches no prefix is rejected with an `Error` whose
message names the postal code.

3.4. Postal codes are compared after removing spaces and converting to upper
case.

3.5. A zone has a base fee in cents, a fee in cents per 500 grams of billable
weight, a tax rate in basis points and a flag that marks it as a remote area.

## 4. Base fee

4.1. The base fee is the zone's base fee plus the zone's per-500-gram fee
multiplied by the number of 500-gram steps in the billable weight.

## 5. Surcharges

5.1. The fuel surcharge is 8.5 percent of the base fee **before any discount**,
rounded according to section 1.

5.2. A parcel whose billable weight is **30000 grams or more** carries a heavy
parcel surcharge of 1500 cents. A parcel of exactly 30000 grams carries it.

5.3. A parcel to a remote-area zone carries a remote-area surcharge of 700
cents.

5.4. Surcharges are never discounted and never count towards the minimum charge
in section 6.4.

## 6. Discounts

6.1. A customer with at least 100 shipments in the current month receives a
volume discount of 5 percent of the base fee. With at least 500 shipments the
volume discount is 12 percent instead. The discount amount is rounded according
to section 1.

6.2. A coupon takes a fixed number of cents off the base fee.

6.3. When both apply, the volume discount is computed on the full base fee and
subtracted **first**; the coupon is subtracted from the result **afterwards**.
The coupon never changes the amount of the volume discount.

6.4. After discounts, the base fee is never lower than the minimum charge of 250
cents. If discounts would take it lower, it is 250 cents.

6.5. A negative coupon amount is rejected with a `RangeError`.

## 7. Line total

7.1. The total of one shipment line is the discounted base fee plus every
surcharge that applies.

## 8. Tax

8.1. Tax is computed **per line**: the line total multiplied by the tax rate of
the line's zone, rounded according to section 1.

8.2. The tax of an invoice is the **sum of the per-line taxes**. It is not the
tax of the sum of the lines.

8.3. Tax rates are expressed in basis points: 1900 is 19 percent.

## 9. Dispatch date

9.1. Each warehouse has a fixed offset from UTC in minutes. There is no daylight
saving time.

9.2. Every rule in this section is evaluated in the **warehouse's local time**,
including which calendar day and which day of the week the order falls on.

9.3. An order placed before 16:00 local time is dispatched the same local day.
An order placed at or after 16:00 local time is dispatched the next local day.

9.4. Nothing is dispatched on a Saturday or a Sunday. A dispatch that would fall
on one moves forward to the following Monday.

9.5. The dispatch date is reported as `YYYY-MM-DD` in local time.

## 10. Invoice

10.1. An invoice lists its lines, the sum of the line totals as `subtotalCents`,
the tax from section 8 as `taxCents`, and their sum as `totalCents`.

10.2. An invoice with no lines is rejected with an `Error`.

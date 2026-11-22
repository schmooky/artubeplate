// The payout step and Artube's Bet Factor (preparing-math, "Payout step, no third decimal place and
// Bet Factor"). The Games API pays floor((multiplier / betCredit) × bet) to the currency's cent, on
// a ladder of 14 bets (EUR and USD at Bet Factor 1.0). A payout step finer than 0.10 of a bet leaves
// fractions of a cent on some of those bets; floored, they cost 0.5-0.8 RTP points at the smallest
// bet and the game fails Artube's math acceptance. The cure is coarser payouts, or a Bet Factor the
// studio asks its Artube AM for before Live Ready (a 0.05 step needs 2.0, 0.04 needs 2.5, 0.02
// needs 5.0). A step of 0.01 or finer pays whole cents at no Bet Factor: Artube does not allow it.

/** Artube's EUR/USD bet ladder at Bet Factor 1.0, in cents. */
export const BET_LADDER_CENTS: readonly number[] = Object.freeze([10, 20, 50, 100, 150, 200, 300, 500, 800, 1000, 2000, 5000, 7500, 10000]);

/** The Bet Factors to look for, in tenths: 1.0 (the default) up to 5.0, Artube's largest. */
const FACTORS = Array.from({ length: 41 }, (_, i) => 10 + i);

const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a;
};

export interface PayoutStep {
  /** The greatest common divisor of the mode's non-zero payouts, in credits. */
  credits: number;
  /** The step as a share of the base bet (credits / betCredit). */
  bets: number;
  /** The smallest Bet Factor (1.0 to 5.0) at which every payout is whole cents on every bet of the
   *  ladder, or null when none is. 1 means the default works. */
  betFactor: number | null;
  /** The ladder's bets (EUR) on which some payout falls between cents at Bet Factor 1.0. */
  inexactBets: number[];
}

/** Every multiple of `step` credits pays whole cents on a bet of `betCents` at Bet Factor `tenths`/10
 *  when step × betCents × tenths is a multiple of betCredit × 10. */
const whole = (step: bigint, betCredit: bigint, tenths: number, betCents: number): boolean => (step * BigInt(betCents) * BigInt(tenths)) % (betCredit * 10n) === 0n;

/** The payout step of a mode's multipliers (credits) and the Bet Factor it needs; null when the mode
 *  never pays. */
export function payoutStep(multipliers: Iterable<bigint>, betCredit: number): PayoutStep | null {
  let step = 0n;
  for (const m of multipliers) if (m > 0n) step = gcd(m, step);
  if (step === 0n || !(betCredit > 0)) return null;
  const bc = BigInt(betCredit);
  const factor = FACTORS.find((t) => BET_LADDER_CENTS.every((b) => whole(step, bc, t, b)));
  return {
    credits: Number(step),
    bets: Number(step) / betCredit,
    betFactor: factor === undefined ? null : factor / 10,
    inexactBets: BET_LADDER_CENTS.filter((b) => !whole(step, bc, 10, b)).map((b) => b / 100),
  };
}

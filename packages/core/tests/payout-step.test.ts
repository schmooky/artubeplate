import { describe, it, expect } from 'vitest';
import { payoutStep, validateArtifact } from '../src/math/index';
import { artifact, memSource } from './helpers';

/**
 * WHOLE CENTS ON EVERY BET.
 *
 * Artube's preparing-math page: the Games API pays floor((multiplier / betCredit) × bet) to the
 * cent, on a ladder of 14 bets (0.10 to 100 EUR at Bet Factor 1.0). A payout step finer than 0.10
 * of a bet leaves fractions of a cent on some bets; floored, they cost 0.5-0.8 RTP points at the
 * smallest bet and the game fails Artube's math acceptance. Sushi Up Bonanza's first math paid on a
 * 0.05 step (0.75x and 7.5x pays) and our validator called it READY.
 */

const big = (xs: number[]): bigint[] => xs.map((x) => BigInt(x));

describe('the payout step and the Bet Factor it needs (Artube table)', () => {
  it('0.10x pays whole cents at the default Bet Factor', () => {
    expect(payoutStep(big([0, 10, 20, 150, 1_000_000]), 100)).toMatchObject({ credits: 10, bets: 0.1, betFactor: 1, inexactBets: [] });
  });
  it('0.05x needs 2.0, 0.04x 2.5, 0.02x 5.0, and names the bets that lose half cents', () => {
    // a coarser odd step can need less: 0.75x pays whole cents on the ladder at 1.2
    expect(payoutStep(big([75, 225]), 100)).toMatchObject({ credits: 75, betFactor: 1.2 });
    expect(payoutStep(big([5, 75, 750]), 100)).toMatchObject({ credits: 5, betFactor: 2, inexactBets: [0.1, 0.5, 1.5] });
    expect(payoutStep(big([4, 8, 400]), 100)).toMatchObject({ credits: 4, betFactor: 2.5 });
    expect(payoutStep(big([2, 6, 1000]), 100)).toMatchObject({ credits: 2, betFactor: 5 });
  });
  it('0.01x (odd units) pays whole cents at no Bet Factor', () => {
    expect(payoutStep(big([1, 3, 115]), 100)).toMatchObject({ credits: 1, betFactor: null });
  });
  it('the step is the greatest common divisor of the payouts, whatever betCredit is', () => {
    expect(payoutStep(big([30, 45]), 100)).toMatchObject({ credits: 15, betFactor: 2 });
    expect(payoutStep(big([2, 4]), 20)).toMatchObject({ credits: 2, bets: 0.1, betFactor: 1 });
  });
  it('a mode that never pays has no step', () => {
    expect(payoutStep(big([0, 0]), 100)).toBeNull();
  });
});

describe('math validate reports the step', () => {
  // losing rows weigh 50 so the declared RTP stays a plausible few percent
  const mode = (mults: number[]) => ({ name: 'base', cost: 100, rows: mults.map((m, i): [number, number, number] => [i + 1, m === 0 ? 50 : 1, m]) });
  const stepIssues = async (mults: number[]) => {
    const r = await validateArtifact(memSource(artifact([mode(mults)])));
    return { ok: r.ok, step: r.modes[0]!.payoutStep, issues: r.issues.filter((i) => i.code === 'payout-step') };
  };

  it('a 0.10x step passes without a word', async () => {
    const r = await stepIssues([0, 0, 50, 250]);
    expect(r.ok).toBe(true);
    expect(r.step).toMatchObject({ credits: 50, betFactor: 1 });
    expect(r.issues).toEqual([]);
  });
  it('a 0.05x step passes with a warning that names the Bet Factor to ask for', async () => {
    const r = await stepIssues([0, 0, 5, 155]);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ level: 'warn', mode: 'base' });
    expect(r.issues[0]!.message).toMatch(/Bet Factor 2\.0/);
    expect(r.issues[0]!.message).toMatch(/0\.1, 0\.5, 1\.5 EUR/);
  });
  it('a 0.01x step fails the set', async () => {
    const r = await stepIssues([0, 0, 101, 299]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ level: 'error', code: 'payout-step' });
    expect(r.issues[0]!.message).toMatch(/does not allow it/);
  });
});

// A round that throws still ends. The platform settled the money when the spin answered, so a phase
// that fails afterwards (a scene bug, a book the scene cannot show) must still land the result:
// Settle credits the win and reports the round, and the machine returns to idle. Before this the
// machine stayed in the phase that threw and the game froze mid-round with the bar locked (Gates
// of Gorilla's Gym, 2026-11-20: its bonus threw on the first board of every free-spins round).

import type { FSM, PhaseContext } from './fsm';

/**
 * Play one round (`spin` onwards) so that it always ends at idle. A failure after the spin answered
 * settles that round; a failure before any answer goes to `ctx.recover`, which re-reads the session
 * (the outcome is unknown, so nothing is shown that the platform did not say). `onFailure` runs once
 * when a phase throws (the boot stops autoplay there). Resolves when the round, or its rescue, is over.
 */
export async function playGuarded<T, V, P>(fsm: FSM<T, V, P>, ctx: PhaseContext<T, V, P>, onFailure?: (e: unknown) => void): Promise<void> {
  const before = ctx.round;
  try {
    await fsm.transition('spin');
    return;
  } catch (e) {
    console.error('[artubeplate] round failed: settling it so the game goes on', e);
    try {
      onFailure?.(e);
    } catch {
      /* the rescue goes on */
    }
  }
  try {
    const answered = ctx.round !== null && ctx.round !== before;
    if (answered && fsm.current !== 'settle' && fsm.current !== 'idle' && fsm.has('settle')) await fsm.transition('settle');
    else if (!answered && fsm.current !== 'idle') await ctx.recover('round failed');
  } catch (e) {
    console.error('[artubeplate] settling the failed round failed too', e);
  }
  if (fsm.current === 'idle') return;
  ctx.stores.ui.spinning.set(false);
  try {
    await fsm.transition('idle');
  } catch (e) {
    console.error('[artubeplate] the idle phase failed after a failed round', e);
  }
}

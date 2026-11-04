import { defaultMods, GameMods } from '../sim/types';

export const MOD_TOGGLES: { key: keyof GameMods; label: string }[] = [
  { key: 'unlimitedAmmo', label: 'Unlimited ammo' },
  { key: 'unlimitedFuel', label: 'Unlimited jetpack' },
  { key: 'instantReload', label: 'Instant reload' },
  { key: 'dualWield', label: 'Dual wield (fires faster)' },
  { key: 'unlimitedGrenades', label: 'Unlimited grenades' },
  { key: 'godMode', label: 'God mode' },
  { key: 'oneHitKill', label: 'One-hit kills' },
  { key: 'lowGravity', label: 'Low gravity (everyone)' },
  { key: 'applyToBots', label: 'Bots get mods too' },
];

export const MOD_PRESETS: { name: string; mods: Partial<GameMods> }[] = [
  { name: 'Full Kit', mods: { unlimitedAmmo: true, unlimitedFuel: true, dualWield: true } },
  { name: 'Unstoppable', mods: { unlimitedAmmo: true, unlimitedFuel: true, instantReload: true, dualWield: true, unlimitedGrenades: true, godMode: true } },
  { name: 'Sniper Duel', mods: { unlimitedAmmo: true, oneHitKill: true, startWeapon: 'sniper', applyToBots: true } },
  { name: 'Rocket Party', mods: { unlimitedAmmo: true, instantReload: true, unlimitedFuel: true, startWeapon: 'rocket', applyToBots: true } },
  { name: 'Moon Base', mods: { lowGravity: true, unlimitedFuel: true, applyToBots: true } },
  { name: 'Clear all', mods: {} },
];

export function applyPreset(partial: Partial<GameMods>): GameMods {
  return { ...defaultMods(), ...partial };
}

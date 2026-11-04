import { defaultMods, Difficulty, GameMode, GameMods } from '../sim/types';

export interface SetupState {
  mode: GameMode;
  mapId: string;
  bots: number;
  difficulty: Difficulty;
  timeLimit: number;
  scoreLimit: number;
  /** The Normal / Modded switch. Mods only take effect while this is on. */
  modded: boolean;
  mods: GameMods;
}

export interface Settings {
  name: string;
  color: string;
  volume: number;
  shake: boolean;
  damageNumbers: boolean;
  reducedEffects: boolean;
  tutorialSeen: boolean;
  setup: SetupState;
}

export interface Record {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  bestStreak: number;
  bestWave: number;
}

export interface Stats {
  normal: Record;
  modded: Record;
}

const SETTINGS_KEY = 'sky-skirmish.settings.v1';
const STATS_KEY = 'sky-skirmish.stats.v1';

function defaults(): Settings {
  return {
    name: 'Player', color: '#3a86ff', volume: 70, shake: true, damageNumbers: true, reducedEffects: false, tutorialSeen: false,
    setup: { mode: 'ffa', mapId: 'ridge', bots: 5, difficulty: 'normal', timeLimit: 300, scoreLimit: 20, modded: false, mods: defaultMods() },
  };
}

function emptyRecord(): Record {
  return { matches: 0, wins: 0, kills: 0, deaths: 0, bestStreak: 0, bestWave: 0 };
}

/** Storage can be unavailable (private windows, blocked site data), so every access is guarded. */
function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing useful to do: the game still works, it just won't remember.
  }
}

export function loadSettings(): Settings {
  const base = defaults();
  const saved = read<Settings>(SETTINGS_KEY);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    setup: { ...base.setup, ...saved.setup, mods: { ...base.setup.mods, ...saved.setup?.mods } },
  };
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export function loadStats(): Stats {
  const saved = read<Stats>(STATS_KEY);
  return {
    normal: { ...emptyRecord(), ...saved?.normal },
    modded: { ...emptyRecord(), ...saved?.modded },
  };
}

export function saveStats(s: Stats): void {
  write(STATS_KEY, s);
}

export function clearStats(): Stats {
  const fresh: Stats = { normal: emptyRecord(), modded: emptyRecord() };
  saveStats(fresh);
  return fresh;
}

import { GameMap, MapBuilder } from './map';

/** Rolling hills, floating islands and a central bunker. The all-rounder. */
function outpostRidge(): GameMap {
  const b = new MapBuilder('ridge', 'Skyline Ridge', 'meadow', 100, 48);
  b.rect(0, 40, 50, 8);
  b.ellipse(9, 43, 15, 8);
  b.ellipse(32, 45, 12, 7);

  // Left base.
  b.rect(1, 22, 10, 2);
  b.platform(11, 22, 4);
  b.platform(4, 30, 7);

  // Floating islands.
  b.ellipse(21, 25, 7, 2.5);
  b.ellipse(36, 15, 6, 2);
  b.ellipse(14, 12, 5, 1.7);
  b.platform(26, 32, 7);

  // Central bunker: the roof is high ground, the inside is cover.
  b.rect(42, 27, 8, 2);
  b.rect(42, 27, 2, 6);
  b.platform(44, 33, 6);
  b.platform(44, 20, 6);

  b.spawn(4, 33, 1).spawn(7, 21, 1).spawn(16, 34, 1).spawn(21, 21, 1).spawn(26, 37, 1).spawn(36, 12, 1);
  b.pickup(14, 9, 'common').pickup(28, 31, 'common').pickup(21, 21, 'grenade').pickup(6, 29, 'health')
    .pickup(22, 38, 'common').pickup(38, 37, 'health');
  b.mirror();
  b.pickup(50, 26, 'power').pickup(50, 32, 'grenade').pickup(50, 19, 'common');
  return b.autoSlope().border().build();
}

/** Tight compound with buildings and alleys. Rewards close-range weapons. */
function dustYard(): GameMap {
  const b = new MapBuilder('dust', 'Dust Yard', 'desert', 96, 44);
  b.rect(0, 38, 48, 6);

  // Left building: two storeys, a door gap at street level, and a window up top.
  b.rect(6, 22, 16, 1);
  b.rect(6, 22, 1, 12);
  b.rect(21, 22, 1, 12);
  b.platform(7, 30, 14);
  b.rect(6, 15, 1, 7);
  b.rect(21, 15, 1, 3);
  b.rect(6, 14, 16, 1);

  // Crates.
  b.rect(25, 36, 5, 2);
  b.rect(27, 34, 3, 2);
  b.rect(38, 36, 4, 2);

  // Central water tower.
  b.platform(40, 24, 8);
  b.rect(41, 25, 1, 13);
  b.platform(42, 31, 6);

  // Catwalks.
  b.platform(24, 26, 10);
  b.platform(30, 17, 9);
  b.platform(1, 27, 5);
  b.platform(1, 19, 5);

  b.spawn(3, 37, 1).spawn(14, 37, 1).spawn(14, 29, 1).spawn(14, 21, 1).spawn(28, 25, 1).spawn(34, 37, 1);
  b.pickup(13, 21, 'power').pickup(3, 26, 'common').pickup(28, 33, 'common').pickup(33, 16, 'grenade')
    .pickup(14, 37, 'health').pickup(36, 37, 'common');
  b.mirror();
  b.pickup(47, 23, 'common').pickup(47, 30, 'health').pickup(47, 37, 'grenade');
  return b.border().build();
}

/** Solid ice with carved tunnels. Grenades and tight corners decide fights. */
function frostbiteCaves(): GameMap {
  const b = new MapBuilder('caves', 'Frostbite Caves', 'ice', 100, 50);
  b.rect(0, 0, 50, 50);

  // Caverns.
  b.ellipse(14, 12, 13, 8, 0);
  b.ellipse(36, 10, 12, 6, 0);
  b.ellipse(13, 37, 12, 8, 0);
  b.ellipse(37, 38, 12, 7, 0);
  b.ellipse(50, 24, 11, 8, 0);

  // Tunnels joining them.
  b.clear(10, 14, 6, 22);
  b.clear(24, 9, 6, 4);
  b.clear(23, 36, 6, 4);
  b.clear(33, 12, 5, 26);
  b.clear(36, 22, 8, 5);
  b.clear(38, 10, 12, 4);
  b.clear(40, 38, 10, 4);

  // Footholds.
  b.platform(10, 25, 6);
  b.platform(33, 25, 5);
  b.platform(18, 15, 6);
  b.platform(36, 34, 7);
  b.platform(8, 32, 8);
  b.ellipse(50, 30, 6, 2.2);

  b.spawn(8, 15, 1).spawn(14, 17, 1).spawn(6, 40, 1).spawn(15, 42, 1).spawn(36, 13, 1).spawn(38, 40, 1);
  b.pickup(5, 12, 'common').pickup(12, 24, 'health').pickup(35, 24, 'grenade').pickup(10, 41, 'common')
    .pickup(30, 41, 'common').pickup(40, 13, 'common');
  b.mirror();
  b.pickup(50, 26, 'power').pickup(50, 12, 'grenade').pickup(50, 40, 'health');
  return b.autoSlope().border().build();
}

/** Layered steel gantries. Little cover on the ground, so fuel management matters. */
function neonFoundry(): GameMap {
  const b = new MapBuilder('foundry', 'Neon Foundry', 'night', 104, 52);
  b.rect(0, 46, 52, 6);

  // Pillars and machine blocks.
  b.rect(1, 26, 7, 2);
  b.rect(1, 13, 5, 2);
  b.rect(14, 8, 2, 12);
  b.rect(14, 28, 2, 12);
  b.rect(30, 16, 2, 10);
  b.rect(30, 34, 2, 12);
  b.rect(38, 38, 6, 8);

  // Gantries.
  b.platform(8, 20, 16);
  b.platform(16, 28, 14);
  b.platform(4, 36, 18);
  b.platform(22, 12, 18);
  b.platform(32, 22, 12);
  b.platform(32, 30, 8);
  b.platform(24, 40, 6);

  // Central core.
  b.rect(46, 18, 6, 2);
  b.rect(46, 32, 6, 2);
  b.platform(44, 26, 8);

  b.spawn(4, 45, 1).spawn(4, 25, 1).spawn(12, 35, 1).spawn(20, 19, 1).spawn(24, 27, 1).spawn(34, 11, 1);
  b.pickup(3, 12, 'common').pickup(10, 19, 'common').pickup(26, 27, 'grenade').pickup(10, 45, 'health')
    .pickup(34, 21, 'common').pickup(40, 37, 'health').pickup(36, 11, 'common');
  b.mirror();
  b.pickup(52, 17, 'power').pickup(52, 25, 'grenade').pickup(52, 31, 'common');
  return b.border().build();
}

const FACTORIES: Record<string, () => GameMap> = {
  ridge: outpostRidge,
  dust: dustYard,
  caves: frostbiteCaves,
  foundry: neonFoundry,
};

export const MAP_LIST = [
  { id: 'ridge', name: 'Skyline Ridge', blurb: 'Open skies, floating islands and a contested bunker.' },
  { id: 'dust', name: 'Dust Yard', blurb: 'Rooftops and alleys. Keep a shotgun handy.' },
  { id: 'caves', name: 'Frostbite Caves', blurb: 'Narrow tunnels and big caverns.' },
  { id: 'foundry', name: 'Neon Foundry', blurb: 'Stacked gantries. Watch your fuel.' },
];

export function createMap(id: string): GameMap {
  return (FACTORIES[id] ?? outpostRidge)();
}

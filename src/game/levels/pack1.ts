import type { LevelDef } from '../core/types.ts';

/**
 * Levels 1-5 - movement, then the first guard.
 *
 * Legend: `#` wall  `.` floor  ` ` void  `S` start  `E` exit  `$` loot
 *         `1 2 3` keycards     `A B C` matching doors
 */
export const PACK_1: LevelDef[] = [
  {
    id: 1,
    name: 'COLD OPEN',
    brief: 'Hold to freeze time. Tap a tile. Release to move.',
    map: [
      '#########',
      '#...E...#',
      '#.......#',
      '#.#####.#',
      '#.#####.#',
      '#.......#',
      '#...$...#',
      '#.......#',
      '#.#####.#',
      '#.#####.#',
      '#.......#',
      '#...S...#',
      '#########',
    ],
  },
  {
    id: 2,
    name: 'TWO PIECES',
    brief: 'Both cases, then the fire door. Route order matters.',
    map: [
      '###########',
      '#$.......E#',
      '#.........#',
      '#.........#',
      '###.###.###',
      '#.........#',
      '#.........#',
      '#.........#',
      '###.###.###',
      '#.........#',
      '#.........#',
      '#S.......$#',
      '###########',
    ],
  },
  {
    id: 3,
    name: 'THE LONG WAY',
    brief: 'The shortest line is a wall. Plan the whole loop.',
    map: [
      '###########',
      '#....E....#',
      '#.#######.#',
      '#.#.....#.#',
      '#.#.###.#.#',
      '#.#.#$#.#.#',
      '#.#.#.#.#.#',
      '#.#.#.#.#.#',
      '#.#...#...#',
      '#.#####.###',
      '#.........#',
      '#....S....#',
      '###########',
    ],
  },
  {
    id: 4,
    name: 'NIGHT WATCH',
    brief: 'One guard, one corridor. Walk in behind him.',
    map: [
      '###########',
      '#........E#',
      '#.........#',
      '#.........#',
      '#.........#',
      '#####.#####',
      '#.........#',
      '#.#######.#',
      '#.........#',
      '#.........#',
      '#.........#',
      '#S...$....#',
      '###########',
    ],
    guards: [
      {
        path: [
          [1, 6],
          [9, 6],
        ],
        loop: 'pingpong',
        stepTicks: 30,
        pause: 60,
      },
    ],
  },
  {
    id: 5,
    name: 'THE SWEEP',
    brief: 'He circles the vault forever. The vault itself is safe.',
    map: [
      '###########',
      '#....E....#',
      '#.........#',
      '#.#######.#',
      '#.#.....#.#',
      '#.#..$..#.#',
      '#.#.....#.#',
      '#.###.###.#',
      '#.........#',
      '#.........#',
      '#.#######.#',
      '#.........#',
      '#....S....#',
      '###########',
    ],
    guards: [
      {
        path: [
          [1, 2],
          [9, 2],
          [9, 9],
          [1, 9],
        ],
        loop: 'cycle',
        stepTicks: 30,
      },
    ],
  },
];

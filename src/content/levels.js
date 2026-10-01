// Career ranks. Reputation (XP) comes from finishing commissions, keeping
// animals well, building and learning; each rank unlocks stock, gear and
// bigger tanks (content/economy.js says which).

export const RANKS = [
  { level: 1, name: 'Hobbyist', rep: 0, text: 'You have a jar, a little moss and a lot to learn.' },
  { level: 2, name: 'Keeper', rep: 100, text: 'Water tools, fish and shrimp: your first pond.' },
  { level: 3, name: 'Moss Gardener', rep: 300, text: 'Rain systems, live food and the nano paludarium.' },
  { level: 4, name: 'Aquascaper', rep: 650, text: 'Poison frogs, false bottoms and the first biotopes.' },
  { level: 5, name: 'Herpetoculturist', rep: 1100, text: 'Geckos, crabs and pro lighting.' },
  { level: 6, name: 'Biotope Designer', rep: 1700, text: 'The standard paludarium and cool-climate species.' },
  { level: 7, name: 'Systems Tinkerer', rep: 2500, text: 'Automation: let the tank run itself.' },
  { level: 8, name: 'Exhibitor', rep: 3500, text: 'Axolotls, and exhibition commissions.' },
  { level: 9, name: 'Curator', rep: 4800, text: 'The grand display tank.' },
  { level: 10, name: 'Conservator', rep: 6500, text: 'Breeding programmes for threatened species.' },
  { level: 11, name: 'Master Vivarist', rep: 9000, text: 'Everything is possible; now make it beautiful.' },
  { level: 12, name: 'Grand Warden', rep: 12000, text: 'You have nothing left to prove. Build for the joy of it.' },
];

// The rank a reputation total reaches, and how far it is toward the next.
export function rankFor(rep) {
  let i = 0;
  while (i + 1 < RANKS.length && rep >= RANKS[i + 1].rep) i++;
  const cur = RANKS[i], next = RANKS[i + 1] ?? null;
  return {
    level: cur.level, rank: cur.name, floor: cur.rep, next: next?.rep ?? null,
    progress: next ? (rep - cur.rep) / (next.rep - cur.rep) : 1,
    nextIn: next ? next.rep - rep : 0,
  };
}

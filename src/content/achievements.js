// Achievements: things worth noticing. `test(stats, ctx)` is checked whenever
// stats change or every few seconds; `stats` are the career's counters and
// `ctx` is a metrics snapshot (game/metrics.js) that may be missing fields.

const m = (ctx, k, d = 0) => ctx?.[k] ?? d;

export const ACHIEVEMENTS = [
  { id: 'first-plant', name: 'Green thumb', text: 'Plant your first plant.', icon: 'leaf', funds: 10, rep: 5, test: (s) => s.plantsPlaced >= 1 },
  { id: 'first-animal', name: 'Welcome home', text: 'Release your first animal.', icon: 'frog', funds: 10, rep: 5, test: (s) => s.animalsBought >= 1 },
  { id: 'first-pool', name: 'Water works', text: 'Fill your first pool.', icon: 'drop', funds: 15, rep: 8, test: (s, c) => m(c, 'pools') >= 1 },
  { id: 'cycled', name: 'Cycled', text: 'Finish the nitrogen cycle: ammonia and nitrite at zero, nitrate present.', icon: 'flask', funds: 40, rep: 25, test: (s, c) => m(c, 'cycle') > 0.85 && m(c, 'ammonia', 1) < 0.1 && m(c, 'nitrite', 1) < 0.1 },
  { id: 'moss-carpet', name: 'Moss carpet', text: 'Cover a quarter of the surfaces in moss.', icon: 'sprout', funds: 30, rep: 20, test: (s, c) => m(c, 'mossPct') >= 25 },
  { id: 'cascade', name: 'Cascade builder', text: 'Run three waterfalls at once.', icon: 'drop', funds: 60, rep: 30, test: (s, c) => m(c, 'falls') >= 3 },
  { id: 'crew', name: 'Clean-up crew', text: 'Have 30 springtails and 10 isopods living together.', icon: 'bug', funds: 25, rep: 15, test: (s, c) => (c?.animals?.byId?.springtail ?? 0) >= 30 && (c?.animals?.byId?.isopod ?? 0) >= 10 },
  { id: 'first-birth', name: 'New life', text: 'Something is born in your tank.', icon: 'heart', funds: 25, rep: 20, test: (s) => s.births >= 1 },
  { id: 'frog-parent', name: 'Frog parent', text: 'Raise a tadpole into a frog.', icon: 'frog', funds: 60, rep: 40, test: (s) => s.metamorphs >= 1 },
  { id: 'full-house', name: 'Full house', text: 'Keep ten species alive at once.', icon: 'grid', funds: 80, rep: 40, test: (s, c) => (c?.animals?.species ?? 0) >= 10 },
  { id: 'hundred-days', name: 'Centenarian tank', text: 'Keep one tank going for 100 days.', icon: 'clock', funds: 100, rep: 50, test: (s, c) => m(c, 'tankDays') >= 100 },
  { id: 'no-losses-30', name: 'Zero losses', text: 'Thirty days without losing an animal (with at least six alive).', icon: 'heart', funds: 90, rep: 45, test: (s, c) => m(c, 'daysSinceDeath') >= 30 && (c?.animals?.total ?? 0) >= 6 },
  { id: 'diverse-plants', name: 'Botanist', text: 'Grow ten different plant species.', icon: 'leaf', funds: 70, rep: 35, test: (s, c) => (c?.plants?.species ?? 0) >= 10 },
  { id: 'entrepreneur', name: 'Entrepreneur', text: 'Earn ¤5,000 in total.', icon: 'coin', funds: 0, rep: 60, test: (s) => s.moneyEarned >= 5000 },
  { id: 'first-sale', name: 'Open for business', text: 'Sell an animal you raised.', icon: 'coin', funds: 15, rep: 10, test: (s) => s.animalsSold >= 1 },
  { id: 'breeder-10', name: 'Breeder', text: 'Sell ten animals.', icon: 'coin', funds: 60, rep: 30, test: (s) => s.animalsSold >= 10 },
  { id: 'vacation', name: 'Vacation survivor', text: 'Go away for a week and come back to a healthy tank.', icon: 'sun', funds: 120, rep: 60, test: (s) => s.vacationsSurvived >= 1 },
  { id: 'automation', name: 'Set and forget', text: 'Write your first automation rule.', icon: 'cpu', funds: 30, rep: 25, test: (s) => s.rulesWritten >= 1 },
  { id: 'rain-maker', name: 'Rain maker', text: 'Program a rain shower.', icon: 'rain', funds: 30, rep: 20, test: (s) => s.rainPrograms >= 1 },
  { id: 'photographer', name: 'Photographer', text: 'Take a photograph in photo mode.', icon: 'camera', funds: 10, rep: 10, test: (s) => s.photos >= 1 },
  { id: 'scholar', name: 'Scholar', text: 'Read twelve field-guide entries.', icon: 'book', funds: 30, rep: 30, test: (s) => s.pagesRead >= 12 },
  { id: 'curator-a', name: "Curator's eye", text: 'Earn an A from the Curator.', icon: 'trophy', funds: 150, rep: 80, test: (s) => s.bestGrade >= 4 },
  { id: 'curator-s', name: 'Perfect scape', text: 'Earn an S from the Curator.', icon: 'trophy', funds: 300, rep: 150, test: (s) => s.bestGrade >= 5 },
  { id: 'grand', name: 'Go big', text: 'Build in the grand display tank.', icon: 'home', funds: 200, rep: 100, test: (s) => s.grandBuilt >= 1 },
  { id: 'wet-season', name: 'Wet season', text: 'Trigger breeding with a rain program.', icon: 'rain', funds: 60, rep: 40, test: (s) => s.rainBreedings >= 1 },
  { id: 'heatwave', name: 'Kept my cool', text: 'Get through a heatwave with no deaths.', icon: 'snow', funds: 80, rep: 50, test: (s) => s.heatwavesSurvived >= 1 },
  { id: 'commissions-5', name: 'In demand', text: 'Finish five commissions.', icon: 'clipboard', funds: 60, rep: 40, test: (s) => s.commissionsDone >= 5 },
  { id: 'commissions-15', name: 'Trusted name', text: 'Finish fifteen commissions.', icon: 'clipboard', funds: 200, rep: 100, test: (s) => s.commissionsDone >= 15 },
  { id: 'axolotl', name: 'Cold blooded', text: 'Keep an axolotl healthy for 30 days.', icon: 'snow', funds: 100, rep: 60, test: (s) => s.axolotlDays >= 30 },
  { id: 'symmetry', name: 'Symmetry', text: 'Build something with Mirror on: both sides at once.', icon: 'swap', funds: 15, rep: 10, test: (s) => s.mirrorUsed >= 1 },
  { id: 'kit-builder', name: 'Kit builder', text: 'Place three aquascape kits.', icon: 'layers', funds: 40, rep: 25, test: (s) => s.kitsPlaced >= 3 },
  { id: 'patience', name: 'Patient eye', text: 'Watch a time-lapse of your tank grow.', icon: 'clock', funds: 15, rep: 10, test: (s) => s.timelapses >= 1 },
  { id: 'wall-garden', name: 'Living wall', text: 'Grow twelve plants on the background.', icon: 'leaf', funds: 50, rep: 30, test: (s, c) => (c?.wall?.plants ?? 0) >= 12 },
];

export const GRADES = { D: 1, C: 2, B: 3, A: 4, S: 5 };

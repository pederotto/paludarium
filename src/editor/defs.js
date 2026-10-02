// The tool palette. `group` orders the rail; hints show at the bottom.

export const TOOLS = [
  { id: 'view', group: 0, icon: 'hand', name: 'Look', key: '1', hint: 'Drag to orbit, right-drag to pan, scroll to zoom toward the pointer. Double-click anything to fly to it.' },
  { id: 'inspect', group: 0, icon: 'search', name: 'Inspect', key: '2', hint: 'Click an animal, plant or pool to see how it is doing and what it needs.' },
  { id: 'sculpt', group: 1, icon: 'mountain', name: 'Sculpt', key: '3', hint: 'Drag on the ground or the background to shape it. Right-drag orbits, middle-drag pans. Ctrl+Z undoes, M mirrors across the middle.' },
  { id: 'paint', group: 1, icon: 'brush', name: 'Paint', key: '4', hint: 'Paint soil, sand, gravel, rock, moss or stone. Moss grows and spreads where the air and soil are damp. M mirrors.' },
  { id: 'rock', group: 1, icon: 'rock', name: 'Hardscape', key: '5', hint: 'Click the ground to place a piece; click on top of one to stack. Click a piece to select it, then drag its handles. Or pick a kit: a whole composition in one click. M mirrors.' },
  { id: 'water', group: 1, icon: 'drop', name: 'Water', key: '6', hint: 'Dig channels and pools, build banks, place pump outlets. The water flows live as you shape the ground. M mirrors.' },
  { id: 'plant', group: 2, icon: 'leaf', name: 'Plants', key: '7', hint: 'Pick a plant, then click where it should grow. Check its light, humidity and soil needs first. M mirrors.' },
  { id: 'animal', group: 2, icon: 'frog', name: 'Animals', key: '8', hint: 'Pick a species, then click to release it. Read its needs in the Field Guide first.' },
  { id: 'gear', group: 2, icon: 'cog', name: 'Equipment', key: '9', hint: 'Place your fogger and basking lamp, and set up the rain system and controller.' },
  { id: 'erase', group: 3, icon: 'eraser', name: 'Remove', key: '0', hint: 'Click a plant, animal, rock or outlet to remove it, or a pool to drain it.' },
];

// The rail shows five groups; each owns some of the tool ids above (the ids, keys 1-9,0 and the controller are unchanged).
// `tabs` are the sub-tool tabs of the options card (the Add group's Kits tab is the Hardscape tool with a kit armed).
export const GROUPS = [
  { id: 'look', name: 'Look', icon: 'eye', tools: ['view', 'inspect'], tip: 'Look around and inspect', tabs: [] },
  { id: 'shape', name: 'Shape', icon: 'mountain', tools: ['sculpt', 'paint', 'water'], tip: 'Sculpt, paint and water', tabs: [['sculpt', 'Sculpt'], ['paint', 'Paint'], ['water', 'Water']] },
  { id: 'add', name: 'Add', icon: 'plus', tools: ['rock', 'plant', 'animal'], tip: 'Rocks, plants, animals and kits', tabs: [['rock', 'Rocks'], ['plant', 'Plants'], ['animal', 'Animals'], ['kits', 'Kits']] },
  { id: 'gear', name: 'Equipment', icon: 'cog', tools: ['gear'], tip: 'Fogger, lamp and settings', tabs: [] },
  { id: 'erase', name: 'Remove', icon: 'eraser', tools: ['erase'], tip: 'Take things out', tabs: [] },
];
export const groupOf = (toolId) => GROUPS.find((g) => g.tools.includes(toolId)) ?? GROUPS[0];

export const WATER_TOOLS = [
  ['channel', 'Channel', 'Drag a path: a stream bed is dug along it, always running downhill from where you started.'],
  ['basin', 'Pool', 'Click to dig a round pool with a raised lip. Brush size is its radius, strength its depth.'],
  ['bank', 'Bank', 'Drag a path to raise a bank: hold water in or steer a stream.'],
  ['outlet', 'Outlet', 'Click the ground, a rock or the background to place a pump outlet. The blue line shows where its water will go.'],
  ['fill', 'Fill', 'Click a hollow to fill it now with water from the main pool.'],
  ['pump', 'Pump', 'Click in the main pool to move the pump.'],
];

// The Water tool's modes the Mirror toggle (key M) applies to.
export const MIRROR_WATER = ['channel', 'basin', 'bank', 'outlet'];

export const SCULPT_OPS = [['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']];

export const BATCH = { neon: 6, cardinal: 6, ember: 8, cory: 3, loach: 2, guppy: 3, shrimp: 5, isopod: 10, springtail: 20, fly: 10 };

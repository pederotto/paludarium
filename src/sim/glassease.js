// Easing a body back inside the glass (Animals.inGlass). A correction is a shift that brings the whole drawn body inside the panes; when the body's drawn box GROWS while it stands
// (its model arrives: a skink placed 8 cm off the side glass with a stand-in body the size of a circle gets its 12 cm tail the moment the real mesh is measured) the shift can be
// 3 cm at once, which showed as a 3 cm pop in one frame (the Test Lab's 'teleport' at 2 s into a run). A walker is eased in instead: at most `cap` cm a call, a smaller shift exactly as before.
export const GLASS_EASE = 0.3;
export const easePush = (v, cap = GLASS_EASE) => (Math.abs(v) <= cap ? v : Math.sign(v) * cap);

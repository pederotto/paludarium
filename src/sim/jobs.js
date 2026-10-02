// Background work, shared out in small pieces.
//
// A job is a generator: it does one piece of work and `yield`s. The owner calls pump(budgetMs) once a frame, which resumes
// jobs (oldest first) until the budget is spent, and always at least one piece, so a job finishes however small the budget.
// For slow processes that do not need to happen in real time (erosion and its commit): they cost a fraction of a
// millisecond in every frame instead of one frame in thirty taking ten. No scene, no DOM: Node tests run it too.

export class Jobs {
  constructor() { this.list = []; }

  get busy() { return this.list.length > 0; }

  // `gen` is an already-created generator (call the generator function, do not pass the function).
  add(gen) { this.list.push(gen); return gen; }

  clear() { this.list.length = 0; }

  // Runs pieces until `budgetMs` milliseconds have passed. A budget of zero or less runs nothing (the frame is already late).
  pump(budgetMs) {
    if (budgetMs <= 0) return;
    const t0 = performance.now();
    while (this.list.length) {
      const r = this.list[0].next();
      if (r.done) this.list.shift();
      if (performance.now() - t0 >= budgetMs) return;
    }
  }
}

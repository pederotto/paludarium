// Small pieces of the genetics UI, shared by the info banner, the Animals tool, the Lab and the field guide:
// morph dots and stars, Punnett squares, and the odds of every colour in the babies of two animals.

import { punnett, describe, outcomeList, suggestPair, lociOf } from '../sim/genetics.js';
import { morphInfo, morphName, morphRarity, swatch } from '../content/morphs.js';
import './genetics.css';

export const pc = (p) => (p >= 0.995 ? '100%' : p < 0.01 ? '<1%' : Math.round(p * 100) + '%');

export function MorphDot({ sp, morph, size = 12 }) {
  return <i class="gdot" style={{ background: swatch(sp, morph), width: size, height: size }} />;
}

export function Stars({ r }) {
  return <span class="gstars" title={`Rarity ${r} of 5`} aria-label={`Rarity ${r} of 5`}>{'★'.repeat(r)}<i>{'★'.repeat(5 - r)}</i></span>;
}

// One locus of a cross as a 2 x 2 Punnett square: parent A's alleles down the side, parent B's across the top.
export function PunnettSquare({ sp, locus, a, b }) {
  const p = punnett(sp, locus, a, b);
  const st = (g) => describe(sp, a.map((x, j) => (j === locus ? g : x)))[locus];
  return (
    <div class="psq">
      <div class="psq-title">{p.name}</div>
      <table>
        <tbody>
          <tr><th />{p.cols.map((c, i) => <th key={i}>{c}</th>)}</tr>
          {p.rows.map((r, i) => (
            <tr key={i}><th>{r}</th>{p.cols.map((_, j) => { const d = st(p.grid[i][j]); return <td key={j} class={'s-' + d.state}>{p.grid[i][j]}<small>{d.label}</small></td>; })}</tr>
          ))}
        </tbody>
      </table>
      <div class="psq-tot">{Object.entries(p.totals).map(([g, pr]) => <div key={g}><b>{pc(pr)}</b> {g}: {st(g).label}</div>)}</div>
    </div>
  );
}

// The exact chance of every colour in the babies of two animals.
export function Outcomes({ sp, a, b }) {
  const list = outcomeList(sp, a, b);
  return (
    <div class="gbars">
      {list.map((o) => (
        <div class="gbar" key={o.morph} title={morphInfo(sp, o.morph)?.blurb}>
          <div class="nm"><MorphDot sp={sp} morph={o.morph} /><span>{morphName(sp, o.morph)}</span><Stars r={morphRarity(sp, o.morph)} /></div>
          <div class="track"><i style={{ width: Math.max(2, o.p * 100) + '%' }} /></div>
          <div class="pc">{pc(o.p)}</div>
        </div>
      ))}
    </div>
  );
}

// Squares for every gene, the odds for every colour and a suggestion, for two genotypes of species `sp`.
export function BreedingView({ sp, a, b }) {
  const sug = suggestPair(sp, a, b);
  return (
    <div class="gen">
      <div class="psq-row">{lociOf(sp).map((_, i) => <PunnettSquare key={i} sp={sp} locus={i} a={a} b={b} />)}</div>
      <div class="h3" style={{ fontWeight: 650, fontSize: 13, margin: '6px 0 0' }}>What the babies could look like</div>
      <Outcomes sp={sp} a={a} b={b} />
      <div class="gsuggest">{sug.text}</div>
      <div class="gen-hint">Each gene is shuffled separately. About 1 baby gene in 100 flips by surprise: that is a mutation, and it can make a colour nobody in the family has.</div>
    </div>
  );
}


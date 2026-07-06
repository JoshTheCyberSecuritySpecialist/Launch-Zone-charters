import { DINOFLAGELLATE_VS_COMB_JELLY } from '../../content/bioluminescence/comparison';

export default function BioComparisonTable() {
  return (
    <div
      className="my-8 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/50"
      role="region"
      aria-labelledby="bio-comparison-heading"
    >
      <h3 id="bio-comparison-heading" className="sr-only">
        Dinoflagellates versus comb jellies comparison
      </h3>
      <table className="min-w-full border-collapse text-left text-sm">
        <caption className="px-4 py-3 text-left text-base font-semibold text-white">
          Dinoflagellates vs. Comb Jellies
        </caption>
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th scope="col" className="px-4 py-3 font-semibold text-cyan-200">
              Feature
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-cyan-200">
              Dinoflagellates
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-cyan-200">
              Comb Jellies
            </th>
          </tr>
        </thead>
        <tbody>
          {DINOFLAGELLATE_VS_COMB_JELLY.map((row, index) => (
            <tr
              key={row.feature}
              className={index % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}
            >
              <th scope="row" className="px-4 py-3 font-medium text-slate-200">
                {row.feature}
              </th>
              <td className="px-4 py-3 text-slate-300">{row.dinoflagellates}</td>
              <td className="px-4 py-3 text-slate-300">{row.combJellies}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

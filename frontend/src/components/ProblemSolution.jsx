import React from 'react';
import { ClipboardList, ReceiptText, EyeOff, FolderSearch, ArrowRight, Check } from 'lucide-react';
import PageBackground from './PageBackground';
import SectionHeading from './SectionHeading';
import Reveal from './Reveal';

/**
 * Problem -> solution narrative. Every "solution" line maps to a capability the
 * product already models (PC registry, session control, time-based billing,
 * customer records, branch-level management) — nothing aspirational.
 */
const pairs = [
  {
    icon: <ClipboardList className="w-5 h-5" />,
    problem: 'Sessions tracked by hand',
    detail: 'Start times on paper or memory, with staff doing the maths at checkout.',
    solution: 'Sessions start, run and stop under software control, timed automatically.'
  },
  {
    icon: <ReceiptText className="w-5 h-5" />,
    problem: 'Billing arguments at the counter',
    detail: 'Disputed minutes and manual totals slow the desk down and cost money.',
    solution: 'Charges follow the recorded session time, so the total is consistent.'
  },
  {
    icon: <EyeOff className="w-5 h-5" />,
    problem: 'No view of the floor',
    detail: 'Which machines are busy, idle or down means walking the room to find out.',
    solution: 'Every PC is registered and reports its state back to one dashboard.'
  },
  {
    icon: <FolderSearch className="w-5 h-5" />,
    problem: 'Numbers scattered everywhere',
    detail: 'Takings in one book, customers in another, nothing that lines up.',
    solution: 'Sessions, customers and branches live in one system you can report on.'
  }
];

const ProblemSolution = () => {
  return (
    <section className="section-seam relative bg-black overflow-hidden antialiased font-sans text-white">
      <PageBackground streakTop="top-1/3" streakBottom="bottom-1/3" />

      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-6 section-y">
        <SectionHeading
          eyebrow="The Operating Problem"
          title="Running a cafe on notebooks"
          highlight="does not scale."
          description="The day-to-day friction is rarely the games — it is the admin around them. Here is what ManagerXP takes off the counter."
          className="mb-14 sm:mb-12 sm:mb-14"
        />

        <div className="space-y-4">
          {pairs.map((pair, index) => (
            <Reveal key={pair.problem} delay={index * 80}>
              <div className="group grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-4 md:gap-6">

                {/* Problem */}
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 sm:p-6 transition-colors duration-300 group-hover:border-white/20">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="p-2 rounded-lg border border-white/10 bg-white/5 text-neutral-400 shrink-0">
                      {pair.icon}
                    </span>
                    <h3 className="text-base font-semibold text-neutral-200">{pair.problem}</h3>
                  </div>
                  <p className="text-sm text-neutral-500 leading-relaxed">{pair.detail}</p>
                </div>

                {/* Connector */}
                <div className="hidden md:flex items-center justify-center" aria-hidden="true">
                  <ArrowRight className="w-5 h-5 text-red-500/60 transition-transform duration-300 group-hover:translate-x-1" />
                </div>

                {/* Solution */}
                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-5 sm:p-6 transition-colors duration-300 group-hover:border-red-500/40">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="p-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 shrink-0">
                      <Check className="w-5 h-5" />
                    </span>
                    <h3 className="text-base font-semibold text-white">With ManagerXP</h3>
                  </div>
                  <p className="text-sm text-neutral-300 leading-relaxed">{pair.solution}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProblemSolution;

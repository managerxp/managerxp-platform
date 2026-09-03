import React, { useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import PageBackground from './PageBackground';
import SectionHeading from './SectionHeading';
import Reveal from './Reveal';
import { EASE_MOTION } from '../lib/motion';

/**
 * Answers are limited to what the product actually models: CafeXP's packages,
 * branch-aware plans, PC limits per plan, time-based sessions and the free-trial
 * plan. RaceXP is described only as Phase 2. Trial length / PC counts are
 * deliberately not hard-coded because they come from the subscription plan
 * shown in the trial banner.
 */
const faqs = [
  {
    q: 'What does ManagerXP actually do?',
    a: 'It is management software for gaming and internet cafes. You register each PC in the system, control and time customer sessions, bill from those sessions, and see the state of the floor from one dashboard.'
  },
  {
    q: 'How do ManagerXP, CafeXP and RaceXP relate?',
    a: 'ManagerXP is the platform. CafeXP is the product you can run today for gaming and internet cafes, and it comes in three packages — Basic, Pro and Elite. RaceXP is a Phase 2 expansion into sim racing that is still in development.'
  },
  {
    q: 'Which CafeXP package should I pick?',
    a: 'Basic covers the fundamentals for a small floor. Pro adds a higher PC allowance, multiple branches, live monitoring and hardware telemetry. Elite is for high-volume and multi-location operators. Pricing is not published, so talk to us and we will match a package to your floor.'
  },
  {
    q: 'Can I buy RaceXP now?',
    a: 'No. RaceXP is Phase 2 and still in development. The plan is for it to work both as an add-on to CafeXP for cafes adding racing simulators, and eventually as a standalone product for dedicated sim-racing centres.'
  },
  {
    q: 'Can I manage more than one branch?',
    a: 'Yes. A cafe can have multiple branches, and each PC belongs to a branch, so you can look at one location or the whole business. How many branches you can add depends on your plan.'
  },
  {
    q: 'How is billing worked out?',
    a: 'Billing follows the recorded session time rather than a manual tally at the counter, which is what removes most disputes over minutes.'
  },
  {
    q: 'How many PCs can I connect?',
    a: 'Each subscription plan sets a maximum number of PCs. You pick the plan that matches your floor size, and it can be changed as you grow.'
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes, there is a free trial plan. The exact length and PC limit are shown on the trial banner on this page, since they come from the current plan.'
  },
  {
    q: 'Can you build something specific for my setup?',
    a: 'We take on custom development and AI integration work alongside the core products. The contact form is the fastest way to describe what you need.'
  }
];

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="section-seam relative bg-black overflow-hidden antialiased font-sans text-white">
      <PageBackground streakTop="top-1/4" streakBottom="bottom-1/3" />

      <div className="relative z-10 max-w-3xl mx-auto px-5 sm:px-6 section-y">
        <SectionHeading
          eyebrow="Questions"
          title="Before you"
          highlight="get started."
          className="mb-12"
        />

        <div className="space-y-3">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;

            return (
              <Reveal key={faq.q} delay={index * 50}>
                <div
                  className={`rounded-xl border bg-white/[0.02] backdrop-blur-sm transition-colors duration-300 ${
                    isOpen ? 'border-red-500/30' : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <h3>
                    <button
                      type="button"
                      id={buttonId}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenIndex(isOpen ? -1 : index)}
                      className="flex w-full items-center justify-between gap-4 p-5 text-left"
                    >
                      <span className={`text-sm sm:text-base font-medium transition-colors ${isOpen ? 'text-white' : 'text-neutral-300'}`}>
                        {faq.q}
                      </span>
                      <Motion.span
                        aria-hidden="true"
                        animate={{ rotate: isOpen ? 45 : 0 }}
                        transition={{ duration: 0.3, ease: EASE_MOTION }}
                        className={`shrink-0 ${isOpen ? 'text-red-500' : 'text-neutral-500'}`}
                      >
                        <Plus className="w-4 h-4" />
                      </Motion.span>
                    </button>
                  </h3>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <Motion.div
                        id={panelId}
                        role="region"
                        aria-labelledby={buttonId}
                        key="panel"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.32, ease: EASE_MOTION }}
                        className="overflow-hidden"
                      >
                        <p className="px-5 pb-5 -mt-1 text-sm text-neutral-400 leading-relaxed text-pretty">
                          {faq.a}
                        </p>
                      </Motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FAQ;

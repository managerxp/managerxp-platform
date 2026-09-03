import React from 'react';
import Reveal from './Reveal';

/**
 * The shared "HUD eyebrow + big title + description" header used at the top of
 * every page and major section. Keeps typography scale and the red gradient
 * accent identical site-wide.
 */
const SectionHeading = ({
  eyebrow,
  icon,
  title,
  highlight,
  description,
  as = 'h2',
  className = ''
}) => {
  const titleSize =
    as === 'h1'
      ? 'text-3xl sm:text-5xl md:text-6xl'
      : 'text-2xl sm:text-3xl md:text-4xl';

  const heading = React.createElement(
    as,
    { className: `${titleSize} font-semibold tracking-tight text-white leading-[1.1] text-balance` },
    title,
    highlight ? ' ' : null,
    highlight ? (
      <span key="highlight" className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-red-700">
        {highlight}
      </span>
    ) : null
  );

  return (
    <div className={`text-center ${className}`}>
      {eyebrow && (
        <Reveal className="flex justify-center mb-4">
          <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs text-neutral-500 font-mono tracking-[0.15em] sm:tracking-[0.2em] uppercase">
            <span className="w-6 sm:w-10 h-[1px] shrink-0 bg-gradient-to-r from-transparent to-neutral-700" />
            <span className="text-red-500 flex items-center gap-2">
              {icon}
              {eyebrow}
            </span>
            <span className="w-6 sm:w-10 h-[1px] shrink-0 bg-gradient-to-l from-transparent to-neutral-700" />
          </div>
        </Reveal>
      )}

      <Reveal delay={80}>{heading}</Reveal>

      {description && (
        <Reveal delay={160}>
          <p className="text-neutral-400 text-base sm:text-lg font-light mt-4 sm:mt-6 max-w-3xl mx-auto text-pretty">
            {description}
          </p>
        </Reveal>
      )}
    </div>
  );
};

export default SectionHeading;

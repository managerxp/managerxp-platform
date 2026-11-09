import React from 'react';

/**
 * Page / section heading in the Swiss poster style: heavy, tight, left
 * aligned, ending on the red full stop. `highlight` continues the sentence
 * for older call sites; `eyebrow`/`icon` are accepted and ignored.
 */
const SectionHeading = ({ title, highlight, description, as = 'h2', align = 'left', tone = 'light', className = '' }) => {
  const dark = tone === 'dark';
  const Tag = as;
  const size = as === 'h1' ? 'text-[clamp(3rem,8vw,8rem)]' : 'text-[clamp(2.25rem,5vw,4.5rem)]';
  const centered = align === 'center';
  const text = `${title}${highlight ? ` ${highlight}` : ''}`.replace(/[.]$/, '');

  return (
    <div className={`${centered ? 'mx-auto text-center' : ''} ${className}`}>
      <Tag className={`poster-h max-w-[16ch] ${dark ? 'text-sheet' : 'text-carbon'} ${centered ? 'mx-auto' : ''} ${size}`}>
        {text}<span className="text-signal">.</span>
      </Tag>
      {description && (
        <p className={`mt-6 max-w-[52ch] text-lg leading-snug ${dark ? 'text-sheet/65' : 'text-graphite'} ${centered ? 'mx-auto' : ''}`}>{description}</p>
      )}
    </div>
  );
};

export default SectionHeading;

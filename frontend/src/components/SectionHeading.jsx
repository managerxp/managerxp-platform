import React from 'react';

/**
 * Page and section heading in the Network Map voice: Archivo display, left
 * aligned, no eyebrow label and no gradient. `highlight` is kept for older
 * call sites and simply continues the sentence; `eyebrow`/`icon` are
 * accepted and ignored.
 */
const SectionHeading = ({
  title,
  highlight,
  description,
  as = 'h2',
  align = 'left',
  className = '',
}) => {
  const Tag = as;
  const size =
    as === 'h1'
      ? 'text-[clamp(2.6rem,5.4vw,4.75rem)] leading-[1.04]'
      : 'text-[clamp(2rem,4vw,3.25rem)] leading-[1.08]';
  const centered = align === 'center';

  return (
    <div className={`${centered ? 'mx-auto text-center' : ''} max-w-3xl ${className}`}>
      <Tag className={`font-display font-semibold text-paper text-balance ${size}`}>
        {title}
        {highlight ? ` ${highlight}` : null}
      </Tag>
      {description && (
        <p className={`mt-5 max-w-[60ch] text-[17px] leading-relaxed text-mute text-pretty ${centered ? 'mx-auto' : ''}`}>
          {description}
        </p>
      )}
    </div>
  );
};

export default SectionHeading;

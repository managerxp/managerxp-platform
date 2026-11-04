import React from 'react';

/** A product's mark: its icon on a small raised tile. */
const ProductMark = ({ product, size = 'md' }) => {
  const Icon = product.Icon;
  const box = size === 'sm' ? 'h-7 w-7 rounded-lg' : size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-9 w-9 rounded-lg';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center border border-white/10 bg-white/[0.06] text-paper ${box}`}>
      <Icon className={icon} strokeWidth={1.75} />
    </span>
  );
};

export default ProductMark;

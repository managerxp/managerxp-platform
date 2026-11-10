import React from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { PRODUCTS } from '../../lib/products';
import ProductLink from './ProductLink';

/**
 * The products as poster rows: a huge name, what it is, and where it goes.
 * The whole row is the link; hovering turns the name red. FlowXP leaves for
 * its own site in a new tab (ProductLink handles that).
 */
const ProductRows = ({ headingLevel = 'h3' }) => {
  const H = headingLevel;
  return (
    <ul className="border-b border-carbon">
      {PRODUCTS.map((p) => (
        <li key={p.id} className="border-t border-carbon">
          <ProductLink product={p} className="group grid items-baseline gap-x-6 gap-y-2 py-7 sm:py-9 md:grid-cols-12">
            <H className="poster-h text-[clamp(2.5rem,5vw,4.5rem)] transition-colors duration-200 group-hover:text-signal md:col-span-5 lg:col-span-4">
              {p.name}
            </H>
            <span className="text-lg leading-snug md:col-span-6 lg:col-span-7">
              <span className="font-semibold">{p.category}</span>
              {p.status === 'development' && <span className="text-graphite"> · in development</span>}
              {p.external && <span className="text-graphite"> · flowxp.in</span>}
              <span className="mt-2 hidden max-w-[60ch] text-[16px] text-graphite lg:block">{p.description}</span>
            </span>
            <span aria-hidden="true" className="hidden justify-end md:col-span-1 md:flex">
              {p.external ? (
                <ArrowUpRight className="h-9 w-9 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" strokeWidth={1.75} />
              ) : (
                <ArrowRight className="h-9 w-9 transition-transform group-hover:translate-x-1.5" strokeWidth={1.75} />
              )}
            </span>
          </ProductLink>
        </li>
      ))}
    </ul>
  );
};

export default ProductRows;

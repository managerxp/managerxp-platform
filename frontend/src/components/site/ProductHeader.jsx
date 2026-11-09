import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Product page hero. Product pages are the gaming side of ManagerXP, so this
 * is dark: the pitch on the left, the product's live visual on the right
 * (CafeXP's station floor, RaceXP's start lights).
 */
const ProductHeader = ({ product, title, lead, actions, visual }) => (
  <header className="bg-carbon text-sheet">
    <div className="wrap pb-16 pt-8 sm:pb-20 sm:pt-12">
      <nav aria-label="Breadcrumb" className="text-[15px] text-sheet/55">
        <ol className="flex items-center gap-2">
          <li><Link to="/products" className="hover:text-sheet">Products</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-sheet">{product.name}</li>
        </ol>
      </nav>

      <div className="mt-10 grid gap-14 lg:grid-cols-12 lg:items-center lg:gap-10">
        <div className="lg:col-span-6">
          <p className="text-lg text-sheet/70">
            {product.name} · {product.category}
            {product.status === 'development' && <span className="text-sheet/50"> · in development</span>}
          </p>
          <h1 className="poster-h mt-4 text-[clamp(2.9rem,6vw,5.75rem)]">
            {title}<span className="text-signal">.</span>
          </h1>
          <p className="mt-8 max-w-[48ch] text-lg leading-snug text-sheet/70">{lead}</p>
          {actions && <div className="mt-8 flex flex-wrap items-center gap-4">{actions}</div>}
        </div>
        {visual && <div className="lg:col-span-6">{visual}</div>}
      </div>

      <p className="mt-16 border-t border-sheet/15 pt-6 text-lg text-sheet/60">
        {product.stations.join(' · ')}
      </p>
    </div>
  </header>
);

export default ProductHeader;

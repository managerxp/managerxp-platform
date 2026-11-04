import React from 'react';
import { Link } from 'react-router-dom';
import ProductMark from './ProductMark';
import { StatusPill, ModuleChips } from './ProductCards';

/** Top of a product page: breadcrumb, identity, the pitch, and its real modules. */
const ProductHeader = ({ product, title, lead, actions }) => (
  <header className="wrap pb-16 pt-10 sm:pt-14">
    <nav aria-label="Breadcrumb" className="text-[13px] text-mute">
      <ol className="flex items-center gap-2">
        <li><Link to="/products" className="hover:text-paper">Products</Link></li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="text-paper">{product.name}</li>
      </ol>
    </nav>

    <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:items-end">
      <div className="lg:col-span-7">
        <div className="flex flex-wrap items-center gap-3">
          <ProductMark product={product} />
          <span className="text-[17px] font-semibold text-paper">{product.name}</span>
          <span className="text-[15px] text-mute">{product.category}</span>
          <StatusPill product={product} />
        </div>
        <h1 className="mt-6 text-[clamp(2.5rem,5vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-paper text-balance">
          {title}
        </h1>
      </div>
      <div className="lg:col-span-5">
        <p className="max-w-[52ch] text-[17px] leading-relaxed text-mute text-pretty">{lead}</p>
        {actions && <div className="mt-7 flex flex-col gap-3 sm:flex-row">{actions}</div>}
      </div>
    </div>

    <div className="mt-12 border-t border-white/[0.06] pt-8">
      <ModuleChips product={product} />
    </div>
  </header>
);

export default ProductHeader;

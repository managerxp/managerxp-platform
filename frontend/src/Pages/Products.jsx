import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import SectionHeading from '../components/SectionHeading';
import ProductRows from '../components/site/ProductRows';

/** The product hub: every ManagerXP product, and the way to a custom one. */
const Products = () => (
  <div className="bg-sheet font-display text-carbon antialiased">
    <Seo
      title="Products | CafeXP, RaceXP and FlowXP by ManagerXP"
      description="ManagerXP's software products: CafeXP for gaming café management, RaceXP for sim racing technology (in development), and FlowXP for AI-powered business management and billing."
      path="/products"
    />

    <div className="wrap pb-20 pt-10 sm:pb-20 sm:pt-16">
      <SectionHeading
        as="h1"
        title="Three products, one team"
        description="CafeXP and FlowXP are available today. RaceXP is in development. FlowXP lives on its own site."
      />

      <div className="mt-16">
        <ProductRows headingLevel="h2" />
      </div>

      <div className="mt-16 grid gap-6 sm:mt-24 md:grid-cols-12 md:items-end">
        <p className="poster-h text-[clamp(2rem,4vw,3.75rem)] leading-[0.98] md:col-span-8">
          Need a product that does not exist yet? We build those too<span className="text-signal">.</span>
        </p>
        <div className="md:col-span-4 md:text-right">
          <Link to="/solutions#custom" className="link-arrow text-lg">
            Custom development <ArrowRight aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </div>
  </div>
);

export default Products;

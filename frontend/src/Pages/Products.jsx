import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import SectionHeading from '../components/SectionHeading';
import ProductCards from '../components/site/ProductCards';

/** The product hub: every ManagerXP product line, and the way to a custom one. */
const Products = () => (
  <div className="bg-ink font-sans text-paper antialiased">
    <Seo
      title="Products | CafeXP, RaceXP and FlowXP by ManagerXP"
      description="ManagerXP's software products: CafeXP for gaming café management, RaceXP for sim racing technology (in development), and FlowXP for AI-powered business management and billing."
      path="/products"
    />

    <div className="wrap pb-20 pt-12 sm:pb-28 sm:pt-16">
      <SectionHeading
        as="h1"
        title="Products built on one engineering core."
        description="Each line solves a hard operational problem for one kind of business. CafeXP and FlowXP are available today, RaceXP is in development, and FlowXP runs on its own site."
      />

      <div className="mt-14">
        <ProductCards headingLevel="h2" />
      </div>

      <div className="mt-16 grid gap-6 sm:mt-20 lg:grid-cols-12 lg:items-end">
        <h2 className="text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-paper text-balance lg:col-span-7">
          Need a product that does not exist yet? We build those too.
        </h2>
        <div className="lg:col-span-5 lg:text-right">
          <Link to="/solutions#custom" className="btn-secondary">
            See custom development
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  </div>
);

export default Products;

import React, { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import ProductHeader from '../components/site/ProductHeader';
import { PRODUCTS } from '../lib/products';

// Anime.js-driven telemetry visuals stay in their own chunk.
const RaceXPPreview = lazy(() => import('../components/RaceXPPreview'));

const product = PRODUCTS.find((p) => p.id === 'racexp');

const RaceXP = () => (
  <div className="bg-ink font-sans text-paper antialiased">
    <Seo
      title="RaceXP | Sim Racing Technology by ManagerXP (In Development)"
      description="RaceXP is ManagerXP's sim racing platform in development: telemetry insights, race session control, lap timing and venue operations for sim racing centres."
      path="/products/racexp"
    />

    <ProductHeader
      product={product}
      title="Racing centre operations, measured to the millisecond."
      lead={`${product.description} RaceXP is in development: everything on this page describes the planned product, not features available today.`}
      actions={
        <Link to="/contact" className="btn-primary">
          Register your interest
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      }
    />

    <div className="wrap pb-20 sm:pb-28">
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-rule border-t-paper" />
          </div>
        }
      >
        <RaceXPPreview intro={false} />
      </Suspense>
    </div>
  </div>
);

export default RaceXP;

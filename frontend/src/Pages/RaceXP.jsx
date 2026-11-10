import React, { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';
import ProductHeader from '../components/site/ProductHeader';
import StartLights from '../components/site/StartLights';
import { PRODUCTS } from '../lib/products';

// Anime.js-driven telemetry visuals stay in their own chunk.
const RaceXPPreview = lazy(() => import('../components/RaceXPPreview'));

const product = PRODUCTS.find((p) => p.id === 'racexp');

const RaceXP = () => (
  <div className="tone-dark bg-carbon font-display text-sheet antialiased">
    <Seo
      title="RaceXP | Sim Racing Technology by ManagerXP (In Development)"
      description="RaceXP is ManagerXP's sim racing platform in development: telemetry insights, race session control, lap timing and venue operations for sim racing centres."
      path="/products/racexp"
    />

    <ProductHeader
      product={product}
      title="Racing centre operations, measured to the millisecond"
      lead={`${product.description} RaceXP is in development: everything on this page describes the planned product, not features available today.`}
      actions={
        <Link to="/contact" className="btn-light">
          Register your interest
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      }
      visual={<StartLights />}
    />

    {/* Planned product UI is dark, so it sits on a black band. */}
    <div className="border-t border-sheet/15">
    <div className="wrap py-16 sm:py-24">
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-sheet/20 border-t-sheet" />
          </div>
        }
      >
        <RaceXPPreview intro={false} />
      </Suspense>
    </div>
    </div>
  </div>
);

export default RaceXP;

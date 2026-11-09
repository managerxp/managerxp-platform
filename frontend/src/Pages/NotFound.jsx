import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Seo from '../components/site/Seo';

/** Any address the router does not know lands here instead of an empty page. */
const NotFound = () => {
  const { pathname } = useLocation();
  return (
    <div className="bg-sheet font-display text-carbon antialiased">
      <Seo title="Page not found | ManagerXP" description="This page does not exist on managerxp.com." path={pathname} />
      <div className="wrap pb-24 pt-16 sm:pb-32 sm:pt-24">
        <p className="text-[15px] text-graphite">404</p>
        <h1 className="poster-h mt-4 text-[clamp(3rem,9vw,7.5rem)]">
          Nothing here<span className="text-signal">.</span>
        </h1>
        <p className="mt-6 max-w-[48ch] text-[18px] leading-relaxed text-graphite">
          The address <span className="break-all text-carbon">{pathname}</span> does not match a page. It may have moved, or the link had a typo.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link to="/" className="btn-primary">
            Go to the homepage <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <Link to="/products" className="link-quiet text-[16px]">See the products</Link>
          <Link to="/contact" className="link-quiet text-[16px]">Contact us</Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;

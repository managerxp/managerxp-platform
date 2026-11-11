import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { FaLinkedin, FaInstagram } from 'react-icons/fa6';
import logo from '../assets/whitelogo-sm.webp';
import startupIndiaBadge from '../assets/startupIndiaBadge.webp';
import { PRODUCTS } from '../lib/products';
import ProductLink from './site/ProductLink';
import { openConsentSettings } from '../lib/consent';

const company = [
  { label: 'About ManagerXP', to: '/about' },
  { label: 'Custom Solutions', to: '/solutions#custom' },
  { label: 'Contact', to: '/contact' },
];

// No separate Cookie Policy: with only session cookies it would repeat the
// Privacy Policy's own cookies section.
const resources = [
  { label: 'Privacy Policy', to: '/privacy-policy' },
  { label: 'Terms & Conditions', to: '/terms-of-service' },
];

const socials = [
  { label: 'ManagerXP on LinkedIn', href: 'https://linkedin.com/company/managerxp', Icon: FaLinkedin },
  { label: 'ManagerXP on Instagram', href: 'https://www.instagram.com/manager.xp', Icon: FaInstagram },
];

const Heading = ({ children }) => <h2 className="mb-4 text-[15px] text-sheet/50">{children}</h2>;
const linkClass = 'text-[17px] text-sheet hover:text-signal';

const Footer = () => (
  <footer className="bg-carbon font-display text-sheet antialiased">
    <div className="wrap border-t border-sheet/15 py-16 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Link to="/" aria-label="ManagerXP home" className="inline-block hover:opacity-80">
            <img src={logo} alt="ManagerXP" width="294" height="56" className="h-7 w-auto" />
          </Link>
          <p className="mt-5 max-w-xs text-[17px] leading-snug text-sheet/70">
            Software for businesses that never stop<span className="text-signal">.</span>
          </p>
          <div className="mt-8 flex items-center gap-3">
            {/* The badge artwork is black, so it sits on its own white chip. */}
            <span className="inline-flex shrink-0 items-center bg-white px-2.5 py-1.5">
              <img src={startupIndiaBadge} alt="Startup India, recognised by DPIIT, Government of India" width="303" height="128" loading="lazy" decoding="async" className="h-8 w-auto" />
            </span>
            <span className="max-w-[9rem] text-[13px] leading-snug text-sheet/60">Startup India recognised</span>
          </div>
        </div>

        <nav aria-label="Footer" className="grid gap-10 sm:grid-cols-3 lg:col-span-5">
          <div>
            <Heading>Company</Heading>
            <ul className="space-y-2.5">
              {company.map((l) => (
                <li key={l.to}><Link to={l.to} className={linkClass}>{l.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <Heading>Products</Heading>
            <ul className="space-y-2.5">
              {PRODUCTS.map((p) => (
                <li key={p.id}>
                  <ProductLink product={p} className={`${linkClass} inline-flex items-center gap-1.5`}>
                    {p.name}
                    {p.external && <ArrowUpRight aria-hidden="true" className="h-4 w-4" />}
                  </ProductLink>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Heading>Resources</Heading>
            <ul className="space-y-2.5">
              {resources.map((l) => (
                <li key={l.to}><Link to={l.to} className={linkClass}>{l.label}</Link></li>
              ))}
              <li>
                <button type="button" onClick={openConsentSettings} className={`${linkClass} text-left`}>
                  Cookie &amp; data choices
                </button>
              </li>
            </ul>
          </div>
        </nav>

        <div className="lg:col-span-3">
          <Heading>Contact</Heading>
          <address className="space-y-2.5 not-italic">
            <a href="mailto:managerxp2026@gmail.com" className={`${linkClass} block break-all`}>managerxp2026@gmail.com</a>
            <a href="tel:+919679549136" className={`${linkClass} block`}>+91 96795 49136</a>
            <p className="text-[15px] leading-snug text-sheet/60">
              8-2-644/1/205 F205, Hiline Complex, Road No. 12, Banjara Hills, Hyderabad 500034
            </p>
          </address>
          <div className="mt-5 flex gap-2">
            {socials.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${social.label} (opens in a new tab)`}
                className="flex h-10 w-10 items-center justify-center border border-sheet/25 text-sheet hover:border-signal hover:bg-signal"
              >
                <social.Icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-16 border-t border-sheet/15 pt-8 text-[14px] text-sheet/50">
        &copy; {new Date().getFullYear()} ManagerXP Private Limited. All rights reserved.
      </p>
    </div>
  </footer>
);

export default Footer;

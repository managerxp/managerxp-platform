import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { FaLinkedin, FaInstagram } from 'react-icons/fa6';
import logo from '../assets/whitelogo-sm.png';
import startupIndiaBadge from '../assets/startupIndiaBadge.png';
import { PRODUCTS } from '../lib/products';
import ProductLink from './site/ProductLink';
import ProductMark from './site/ProductMark';

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

const Heading = ({ children }) => (
  <h2 className="mb-5 text-[13px] font-semibold text-paper">{children}</h2>
);

const linkClass = 'text-[14px] text-mute hover:text-paper';

const Footer = () => (
  <footer className="border-t border-white/[0.06] bg-ink font-sans text-paper antialiased">
    <div className="wrap py-16 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Link to="/" aria-label="ManagerXP home" className="inline-block hover:opacity-80">
            <img src={logo} alt="ManagerXP" width="294" height="56" className="h-7 w-auto" />
          </Link>
          <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-mute">
            Intelligent software products and custom technology for complex business operations.
          </p>
          <div className="mt-6 flex items-center gap-3">
            {/* The badge artwork is black, so it sits on its own white chip. */}
            <span className="inline-flex shrink-0 items-center rounded-lg bg-white px-2.5 py-1.5">
              <img src={startupIndiaBadge} alt="Startup India, recognised by DPIIT, Government of India" className="h-8 w-auto" />
            </span>
            <span className="max-w-[9rem] text-[12px] leading-snug text-mute">Startup India recognised</span>
          </div>
        </div>

        <nav aria-label="Footer" className="grid gap-10 sm:grid-cols-3 lg:col-span-5">
          <div>
            <Heading>Company</Heading>
            <ul className="space-y-3">
              {company.map((l) => (
                <li key={l.to}><Link to={l.to} className={linkClass}>{l.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <Heading>Products</Heading>
            <ul className="space-y-3">
              {PRODUCTS.map((p) => (
                <li key={p.id}>
                  <ProductLink product={p} className={`${linkClass} inline-flex items-center gap-2.5`}>
                    <ProductMark product={p} size="sm" />
                    {p.name}
                    {p.external && <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />}
                  </ProductLink>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Heading>Resources</Heading>
            <ul className="space-y-3">
              {resources.map((l) => (
                <li key={l.to}><Link to={l.to} className={linkClass}>{l.label}</Link></li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="lg:col-span-3">
          <Heading>Contact</Heading>
          <address className="space-y-3 not-italic">
            <a href="mailto:managerxp2026@gmail.com" className={`${linkClass} block break-all`}>managerxp2026@gmail.com</a>
            <a href="tel:+919679549136" className={`${linkClass} block`}>+91 96795 49136</a>
            <p className="text-[14px] leading-relaxed text-mute">
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
                className="flex h-10 w-10 items-center justify-center rounded-full border border-rule text-mute hover:border-paper hover:text-paper"
              >
                <social.Icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-16 flex flex-col gap-3 border-t border-white/[0.06] pt-8 text-[13px] text-mute sm:flex-row sm:items-center sm:justify-between">
        <p>&copy; {new Date().getFullYear()} ManagerXP Private Limited. All rights reserved.</p>
      </div>
    </div>
  </footer>
);

export default Footer;

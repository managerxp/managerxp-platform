import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import { Mail, Phone, MapPin } from 'lucide-react';
import { FaXTwitter, FaLinkedin, FaInstagram } from 'react-icons/fa6';

// Explicit paths: deriving them from the label produced dead routes (/ourproducts).
const navLinks = [
  { label: 'Home', to: '/' },
  { label: 'Our Products', to: '/products' },
  { label: 'About Us', to: '/about' },
  { label: 'Contact Us', to: '/contact' },
  { label: 'Book a Demo', to: '/demo' },
];

// No separate Cookie Policy — with only session cookies and no analytics or
// ad trackers, it would just duplicate the Privacy Policy's own "Cookies and
// Similar Technologies" section rather than say anything new.
const legalLinks = [
  { label: 'Privacy_Policy', to: '/privacy-policy' },
  { label: 'Terms_of_Service', to: '/terms-of-service' },
];

const socialLinks = [
  { label: 'ManagerXP on X', href: 'https://twitter.com/managerxp', Icon: FaXTwitter },
  { label: 'ManagerXP on LinkedIn', href: 'https://linkedin.com/company/managerxp', Icon: FaLinkedin },
  { label: 'ManagerXP on Instagram', href: 'https://www.instagram.com/manager.xp', Icon: FaInstagram },
];

const Footer = () => {
  // The primary logo is dark artwork, so it is inverted to sit on the black footer.
  const logoStyle = {
    filter: 'brightness(0) invert(1)',
  };

  return (
    <footer className="relative bg-black text-white overflow-hidden border-t border-white/10">

      {/* --- Background Layers --- */}

      {/* 1. Tech Grid Pattern */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 opacity-[0.03]
                   bg-[length:40px_40px]
                   [background-image:linear-gradient(to_right,rgba(255,255,255,0.1)_1px,transparent_1px),
                                      linear-gradient(to_top,rgba(255,255,255,0.1)_1px,transparent_1px)]"
      />

      {/* 2. Ambient Red Glow - Top Center */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-64 z-0
                   bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.15),transparent_70%)]"
      />

      {/* 3. Racer Light Streaks (slower drift than page sections) */}
      <div aria-hidden="true" className="absolute top-0 left-0 w-full h-[1px] z-[2] overflow-hidden">
        <div className="w-1/3 h-full bg-gradient-to-r from-transparent via-red-600/40 to-transparent absolute animate-racer-drift blur-[1px]" />
      </div>
      <div aria-hidden="true" className="absolute bottom-0 left-0 w-full h-[1px] z-[2] overflow-hidden">
        <div className="w-1/4 h-full bg-gradient-to-r from-transparent via-red-500/20 to-transparent absolute animate-racer-drift-slow blur-[1px]" />
      </div>

      {/* --- Main Content --- */}
      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-16 sm:py-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-10 lg:gap-16">

          {/* Company Info */}
          <div className="space-y-6 sm:col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center w-fit hover:opacity-80 transition-opacity">
              <img
                src={logo}
                alt="ManagerXP"
                className="h-8 w-auto object-contain"
                style={logoStyle}
              />
            </Link>
            <p className="text-neutral-400 text-sm leading-relaxed font-light max-w-sm">
              Empowering businesses with innovative management solutions for the modern workplace.
            </p>
            <div className="flex space-x-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="p-2.5 rounded-full border border-white/10 bg-white/5 text-neutral-400
                             hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500
                             transition-all duration-300 backdrop-blur-sm"
                >
                  <social.Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <nav aria-label="Footer navigation">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-red-500 mb-6 sm:mb-8 flex items-center gap-3">
              <span aria-hidden="true" className="w-8 h-[1px] bg-gradient-to-r from-red-500 to-transparent"></span>
              Navigation
            </h2>
            <ul className="space-y-4">
              {navLinks.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="group flex items-center gap-2 text-neutral-300 hover:text-white transition-colors duration-300 text-sm w-fit"
                  >
                    <span aria-hidden="true" className="w-0 h-[1px] bg-red-500 group-hover:w-3 transition-all duration-300"></span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Contact Info */}
          <div>
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-red-500 mb-6 sm:mb-8 flex items-center gap-3">
              <span aria-hidden="true" className="w-8 h-[1px] bg-gradient-to-r from-red-500 to-transparent"></span>
              System Support
            </h2>
            <ul className="space-y-5 text-sm">
              <li>
                <a href="mailto:managerxp2026@gmail.com" className="flex items-start gap-4 text-neutral-300 hover:text-white transition-colors group">
                  <Mail className="w-4 h-4 mt-0.5 shrink-0 text-red-500/70 group-hover:text-red-500 transition-colors" />
                  <span className="break-all">managerxp2026@gmail.com</span>
                </a>
              </li>
              <li>
                <a href="tel:+919679549136" className="flex items-start gap-4 text-neutral-300 hover:text-white transition-colors group">
                  <Phone className="w-4 h-4 mt-0.5 shrink-0 text-red-500/70 group-hover:text-red-500 transition-colors" />
                  <span>+91 9679549136</span>
                </a>
              </li>
              <li className="flex items-start gap-4 text-neutral-300">
                <MapPin className="w-4 h-4 mt-0.5 text-red-500/70 shrink-0" />
                <span>8-2-644/1/205 F205, Hiline Complex, Road No.12, Banjara Hills, Hyderabad- 500034.</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-14 sm:mt-14 sm:mt-16 pt-8 border-t border-white/5">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-neutral-600 text-xs font-mono tracking-wider flex items-center gap-2 text-center md:text-left">
              <span aria-hidden="true" className="w-1.5 h-1.5 shrink-0 rounded-full bg-red-500 animate-pulse"></span>
              &copy; {new Date().getFullYear()} MANAGERXP PRIVATE LIMITED. All rights reserved.
            </p>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 sm:gap-x-8">
              {legalLinks.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="text-neutral-600 hover:text-red-500 text-xs font-mono transition-colors duration-300 uppercase tracking-wide"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

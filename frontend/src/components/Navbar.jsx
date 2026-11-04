import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { Menu, X, ChevronDown, ArrowUpRight, ArrowRight } from 'lucide-react';
import logo from '../assets/whitelogo-sm.png';
import { useAuth } from '../context/AuthContext';
import { PRODUCTS } from '../lib/products';
import ProductLink from './site/ProductLink';
import ProductMark from './site/ProductMark';

// `match` decides the active state; Solutions and Custom Development share a
// page, so the hash tells them apart.
const navItems = [
  { label: 'Home', to: '/', match: (p) => p.pathname === '/' },
  { label: 'Solutions', to: '/solutions', match: (p) => p.pathname === '/solutions' && p.hash !== '#custom' },
  { label: 'Products', products: true, match: (p) => p.pathname.startsWith('/products') },
  { label: 'Custom Development', to: '/solutions#custom', match: (p) => p.pathname === '/solutions' && p.hash === '#custom' },
  { label: 'About', to: '/about', match: (p) => p.pathname === '/about' },
  { label: 'Contact', to: '/contact', match: (p) => p.pathname === '/contact' },
];

const linkBase = 'relative py-1 text-[14px] font-medium transition-colors';
const activeBar = '';

/* ---------------------------------------------------------------- dropdown */

const ProductsMenu = ({ active }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const closeTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Hover opens it for mouse users; a short close delay forgives the gap
  // between the trigger and the panel.
  const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const onEnter = () => {
    if (!canHover()) return;
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const onLeave = () => {
    if (!canHover()) return;
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  const focusItem = (index) => {
    const items = wrapRef.current?.querySelectorAll('[data-menu-item]');
    if (!items?.length) return;
    items[(index + items.length) % items.length].focus();
  };

  const onButtonKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => focusItem(0));
    }
  };

  const onPanelKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(wrapRef.current.querySelectorAll('[data-menu-item]'));
    const i = items.indexOf(document.activeElement);
    focusItem(e.key === 'ArrowDown' ? i + 1 : i - 1);
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onBlur={(e) => {
        if (!wrapRef.current.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="products-menu"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKey}
        className={`${linkBase} inline-flex items-center gap-1 ${active ? `text-paper ${activeBar}` : 'text-mute hover:text-paper'}`}
      >
        Products
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <Motion.div
            id="products-menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onKeyDown={onPanelKey}
            className="absolute left-1/2 top-full z-50 mt-[22px] w-[28rem] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-ink-2/95 p-2 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          >
            <ul>
              {PRODUCTS.map((p) => (
                <li key={p.id}>
                  <ProductLink
                    product={p}
                    data-menu-item
                    onClick={() => setOpen(false)}
                    className="group grid grid-cols-[2.25rem_1fr_auto] items-center gap-4 rounded-xl px-3 py-3 outline-offset-[-2px] hover:bg-white/[0.05] focus-visible:bg-white/[0.05]"
                  >
                    <ProductMark product={p} />
                    <span>
                      <span className="flex items-baseline gap-2">
                        <span className="text-[15px] font-semibold text-paper">{p.name}</span>
                        {p.status === 'development' && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-mute">{p.statusLabel}</span>}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-mute">{p.category}</span>
                    </span>
                    {p.external ? (
                      <ArrowUpRight aria-hidden="true" className="h-4 w-4 text-mute group-hover:text-paper" />
                    ) : (
                      <ArrowRight aria-hidden="true" className="h-4 w-4 text-mute transition-transform group-hover:translate-x-0.5 group-hover:text-paper" />
                    )}
                  </ProductLink>
                </li>
              ))}
            </ul>
            <Link
              to="/products"
              data-menu-item
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center justify-between rounded-xl border-t border-white/[0.06] px-3 py-3 text-[13px] text-mute outline-offset-[-2px] hover:text-paper"
            >
              View all products
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ------------------------------------------------------------------ navbar */

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const profileRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const menuButtonRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Dismiss the profile dropdown on outside click or Escape.
  useEffect(() => {
    if (!isProfileOpen) return;
    const onPointerDown = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) setIsProfileOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setIsProfileOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isProfileOpen]);

  // Mobile menu: lock the page behind it, trap Tab inside it, Escape closes
  // and hands focus back to the toggle.
  useEffect(() => {
    if (!isMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = mobileMenuRef.current
      ? Array.from(mobileMenuRef.current.querySelectorAll('a[href], button:not([disabled])'))
      : [];
    focusables[0]?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isMenuOpen]);

  const avatarLabel = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  const accountLink = user?.role === 'admin' ? { to: '/admin', label: 'Admin console' } : { to: '/dashboard', label: 'Dashboard' };

  return (
    <nav
      aria-label="Main"
      className={`fixed inset-x-0 top-0 z-50 border-b font-sans antialiased transition-colors duration-300 ${
        isScrolled || isMenuOpen ? 'border-white/[0.06] bg-ink/80 backdrop-blur-xl backdrop-saturate-150' : 'border-transparent bg-transparent'
      }`}
    >
      <div className="wrap flex h-16 items-center justify-between gap-6">
        <Link to="/" className="shrink-0 hover:opacity-80" aria-label="ManagerXP home">
          <img src={logo} alt="ManagerXP" width="294" height="56" className="h-6 w-auto" />
        </Link>

        <ul className="hidden items-center gap-7 lg:flex">
          {navItems.map((item) => {
            const active = item.match(location);
            return (
              <li key={item.label}>
                {item.products ? (
                  <ProductsMenu active={active} />
                ) : (
                  <Link
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={`${linkBase} ${active ? `text-paper ${activeBar}` : 'text-mute hover:text-paper'}`}
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        <div className="hidden items-center gap-5 lg:flex">
          {isAuthenticated ? (
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setIsProfileOpen((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-sm font-semibold text-ink hover:bg-white"
                aria-expanded={isProfileOpen}
                aria-haspopup="menu"
                aria-label="Account menu"
              >
                {avatarLabel}
              </button>
              {isProfileOpen && (
                <div role="menu" className="absolute right-0 mt-3 w-48 rounded-xl border border-white/10 bg-ink-2 p-1.5 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.7)]">
                  <Link to={accountLink.to} role="menuitem" onClick={() => setIsProfileOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-paper hover:bg-white/5">
                    {accountLink.label}
                  </Link>
                  <button type="button" role="menuitem" onClick={logout} className="w-full rounded-lg px-3 py-2 text-left text-sm text-paper hover:bg-white/5">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="text-[14px] font-medium text-mute hover:text-paper">
              Sign in
            </Link>
          )}
          <Link to="/contact" className="btn-primary !min-h-10 !px-5 !text-[14px]">
            Let's Build Together
          </Link>
        </div>

        <button
          ref={menuButtonRef}
          onClick={() => setIsMenuOpen((prev) => !prev)}
          type="button"
          className="-mr-2 inline-flex h-11 w-11 items-center justify-center text-paper lg:hidden"
          aria-controls="mobile-menu"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'Close main menu' : 'Open main menu'}
        >
          {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu: a full-height sheet under the bar. Products are listed
          inline rather than behind a second toggle — three items do not need
          a disclosure on a phone. */}
      <div
        id="mobile-menu"
        ref={mobileMenuRef}
        inert={!isMenuOpen}
        // Any link chosen inside the sheet closes it.
        onClick={(e) => e.target.closest('a') && setIsMenuOpen(false)}
        className={`overflow-y-auto border-t border-rule bg-ink transition-[max-height,opacity] duration-300 lg:hidden ${
          isMenuOpen ? 'max-h-[calc(100dvh-4rem)] opacity-100' : 'max-h-0 border-transparent opacity-0'
        }`}
      >
        <div className="wrap pb-8 pt-2">
          <ul>
            {navItems.map((item) =>
              item.products ? (
                <li key={item.label} className="border-b border-rule py-4">
                  <p className="pb-2 text-[15px] font-medium text-paper">Products</p>
                  <ul>
                    {PRODUCTS.map((p) => (
                      <li key={p.id}>
                        <ProductLink product={p} className="flex items-center gap-4 py-2.5">
                          <ProductMark product={p} />
                          <span className="flex-1">
                            <span className="block text-[15px] font-semibold text-paper">{p.name}</span>
                            <span className="block text-[13px] text-mute">{p.category} · {p.statusLabel}</span>
                          </span>
                          {p.external && <ArrowUpRight aria-hidden="true" className="h-4 w-4 text-mute" />}
                        </ProductLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={item.label} className="border-b border-rule">
                  <Link
                    to={item.to}
                    aria-current={item.match(location) ? 'page' : undefined}
                    className={`flex items-center justify-between py-4 text-[15px] font-medium ${item.match(location) ? 'text-paper' : 'text-mute'}`}
                  >
                    {item.label}
                    {item.match(location) && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-signal" />}
                  </Link>
                </li>
              )
            )}
          </ul>

          <div className="mt-6 grid gap-3">
            <Link to="/contact" className="btn-primary w-full">Let's Build Together</Link>
            {isAuthenticated ? (
              <>
                <Link to={accountLink.to} className="btn-secondary w-full">{accountLink.label}</Link>
                <button type="button" onClick={logout} className="py-2 text-sm text-mute hover:text-paper">Sign out</button>
              </>
            ) : (
              <Link to="/login" className="btn-secondary w-full">Sign in</Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

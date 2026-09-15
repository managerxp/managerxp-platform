import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import logo from '../assets/whitelogo-sm.png';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { label: 'Home', to: '/' },
  { label: 'Products', to: '/products' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const profileRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const menuButtonRef = useRef(null);

  // Detect scroll position
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;

      ticking = true;
      window.requestAnimationFrame(() => {
        const next = window.scrollY > 24;
        setIsScrolled((prev) => (prev === next ? prev : next));
        ticking = false;
      });
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Dismiss the profile dropdown on outside click or Escape.
  useEffect(() => {
    if (!isProfileOpen) return;

    const onPointerDown = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setIsProfileOpen(false);
      }
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

  /*
   * Mobile menu: lock the page behind it, trap Tab inside it, and give
   * Escape the same job it already does for the profile dropdown. Focus
   * moves to the first link on open and back to the toggle button on close,
   * so a keyboard user never loses their place.
   */
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

  const isActive = (path) => location.pathname === path;
  const avatarLabel = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  const closeMenus = () => {
    setIsMenuOpen(false);
    setIsProfileOpen(false);
  };

  return (
    /*
     * A floating glass pill, inset from the edge, rather than a full-width
     * bar — the same iOS-control-centre pattern FlowXP's nav uses: the page
     * stays visible behind and around it instead of the nav reading as one
     * more flat stripe stacked on top of the page. The outer <nav> carries
     * no background of its own — only the pill inside it does — so the
     * inset margin actually shows page content through.
     */
    <nav className="fixed inset-x-0 top-0 z-50 px-3 pt-3 antialiased font-sans sm:px-5 sm:pt-4">
      <div
        className={`mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-full border pl-4 pr-2 backdrop-saturate-150 transition-all duration-300 sm:pr-3 ${
          isScrolled
            ? 'h-14 border-white/15 bg-black/70 backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_12px_32px_-12px_rgba(0,0,0,0.6)]'
            : 'h-16 border-white/10 bg-black/45 backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_8px_24px_-12px_rgba(0,0,0,0.45)]'
        }`}
      >

        {/* Left Side: Logo */}
        <div className="shrink-0">
          <Link
            to="/"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center hover:opacity-80 transition-opacity duration-300"
          >
            <img
              src={logo}
              alt="ManagerXP"
              width="294"
              height="56"
              className={`w-auto transition-all duration-300 ${isScrolled ? 'h-6' : 'h-7'}`}
            />
          </Link>
        </div>

        {/* Center: Desktop Navigation Links */}
        <div className="hidden md:flex md:items-center md:space-x-7">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive(item.to) ? 'page' : undefined}
              className={`relative py-1 text-[13px] font-medium tracking-[0.01em] transition-colors duration-200 group ${
                isActive(item.to) ? 'text-white' : 'text-neutral-300 hover:text-white'
              }`}
            >
              {item.label}
              <span
                aria-hidden="true"
                className={`absolute -bottom-0.5 left-0 h-0.5 rounded-full bg-red-500 transition-all duration-300 ${
                  isActive(item.to)
                    ? 'w-full shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                    : 'w-0 group-hover:w-full'
                }`}
              />
            </Link>
          ))}
        </div>

        {/* Right Side: CTA Button */}
        <div className="hidden md:flex md:items-center md:gap-2.5">
          {!isAuthenticated && (
            <>
              <Link
                to="/login"
                className="inline-flex items-center justify-center px-4 py-2 text-[13px] font-medium text-neutral-300 hover:text-red-400 transition-colors"
              >
                Login
              </Link>
              {/* Signing up and starting a trial are the same act now, so
                  there is one button for it rather than two links racing to
                  the same page. */}
              <Link
                to="/signup"
                className="inline-flex items-center justify-center px-4 py-2 text-[13px] font-semibold text-black bg-white rounded-full border border-white/90 hover:bg-neutral-100 active:scale-[0.98] transition-all duration-200"
              >
                Start free trial
              </Link>
            </>
          )}

          {isAuthenticated && (
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setIsProfileOpen((prev) => !prev)}
                className="h-9 w-9 rounded-full bg-white text-black text-sm font-semibold flex items-center justify-center border border-white/90 hover:bg-neutral-100 transition"
                aria-expanded={isProfileOpen}
                aria-haspopup="menu"
                aria-label="Account menu"
              >
                {avatarLabel}
              </button>

              {isProfileOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-48 rounded-xl border border-neutral-800 bg-neutral-950/95 backdrop-blur-xl shadow-2xl p-1.5"
                >
                  {user?.role !== 'admin' && (
                    <Link
                      to="/dashboard"
                      role="menuitem"
                      onClick={closeMenus}
                      className="block px-3 py-2 text-sm text-neutral-200 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                    >
                      Dashboard
                    </Link>
                  )}
                  {user?.role === 'admin' && (
                    <Link
                      to="/admin"
                      role="menuitem"
                      onClick={closeMenus}
                      className="block px-3 py-2 text-sm text-neutral-200 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                    >
                      Admin Dashboard
                    </Link>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={logout}
                    className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden flex items-center">
          <button
            ref={menuButtonRef}
            onClick={() => setIsMenuOpen((prev) => !prev)}
            type="button"
            className="inline-flex items-center justify-center p-2 rounded-full text-neutral-300 hover:text-red-400 hover:bg-white/10 transition duration-200"
            aria-controls="mobile-menu"
            aria-expanded={isMenuOpen}
            aria-label={isMenuOpen ? 'Close main menu' : 'Open main menu'}
          >
            {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay — its own floating glass panel under the pill,
          not a full-bleed bar, so it keeps the same inset language. */}
      <div
        id="mobile-menu"
        ref={mobileMenuRef}
        inert={!isMenuOpen}
        className={`mx-auto max-w-6xl overflow-hidden transition-all duration-300 ease-in-out md:hidden ${
          isMenuOpen ? 'mt-2 max-h-[32rem] opacity-100' : 'mt-0 max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-1 rounded-2xl border border-white/10 bg-black/80 backdrop-blur-2xl backdrop-saturate-150 px-4 pt-3 pb-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_12px_32px_-12px_rgba(0,0,0,0.6)]">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive(item.to) ? 'page' : undefined}
              className={`block px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive(item.to)
                  ? 'text-white bg-red-500/15 border border-red-500/30'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-900 border border-transparent'
              }`}
              onClick={closeMenus}
            >
              {item.label}
            </Link>
          ))}

          {!isAuthenticated && (
            <div className="pt-2 space-y-2">
              <Link
                to="/signup"
                onClick={closeMenus}
                className="block w-full text-center px-4 py-2.5 text-sm font-semibold text-black bg-white rounded-full border border-white/90 hover:bg-neutral-100 transition-all duration-200"
              >
                Start free trial
              </Link>
              <div>
                <Link
                  to="/login"
                  onClick={closeMenus}
                  className="block w-full text-center px-4 py-2.5 text-sm font-medium text-white rounded-full border border-neutral-700 hover:bg-neutral-900 transition-all duration-200"
                >
                  Login
                </Link>

              </div>
            </div>
          )}

          {isAuthenticated && (
            <div className="pt-2 space-y-2">
              {user?.role !== 'admin' && (
                <Link
                  to="/dashboard"
                  onClick={closeMenus}
                  className="block w-full text-center px-4 py-2.5 text-sm font-medium text-white rounded-full border border-red-600/70 bg-red-900/20 hover:bg-red-900/35 transition-all duration-200"
                >
                  Dashboard
                </Link>
              )}
              {user?.role === 'admin' && (
                <Link
                  to="/admin"
                  onClick={closeMenus}
                  className="block w-full text-center px-4 py-2.5 text-sm font-medium text-white rounded-full border border-neutral-700 hover:bg-neutral-900 transition-all duration-200"
                >
                  Admin Dashboard
                </Link>
              )}
              <button
                type="button"
                onClick={logout}
                className="block w-full text-center px-4 py-2.5 text-sm font-semibold text-black bg-white rounded-full border border-white/90 hover:bg-neutral-100 transition-all duration-200"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

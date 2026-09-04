import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import logo from '../assets/whitelogo.png';
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

  const isActive = (path) => location.pathname === path;
  const avatarLabel = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  const closeMenus = () => {
    setIsMenuOpen(false);
    setIsProfileOpen(false);
  };

  return (
    <nav
      className={`fixed z-50 top-0 left-0 right-0 antialiased font-sans border-b transition-all duration-300 ${
        isScrolled
          ? 'bg-black/80 backdrop-blur-xl border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.38)]'
          : 'bg-black border-white/5'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex items-center justify-between transition-[height] duration-300 ${isScrolled ? 'h-14' : 'h-16'}`}>

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
              onClick={() => setIsMenuOpen((prev) => !prev)}
              type="button"
              className="inline-flex items-center justify-center p-2 rounded-md text-neutral-300 hover:text-red-400 hover:bg-neutral-900 transition duration-200"
              aria-controls="mobile-menu"
              aria-expanded={isMenuOpen}
              aria-label={isMenuOpen ? 'Close main menu' : 'Open main menu'}
            >
              {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      <div
        id="mobile-menu"
        className={`md:hidden transition-all duration-300 ease-in-out overflow-hidden ${
          isMenuOpen ? 'max-h-[32rem] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pt-2 pb-4 space-y-1 bg-black/95 backdrop-blur-xl border-t border-white/10">
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

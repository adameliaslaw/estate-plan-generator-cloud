import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Scale, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FIRM_DEFAULTS } from '@/config/constants';

export function PublicHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', href: '/' },
    { name: 'Tools', href: '/tools' },
    { name: 'News', href: '/news' },
    { name: 'Blog', href: '/blog' },
    { name: 'About', href: '/about' },
    { name: 'Contact', href: '/contact' },
  ];

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-4 sm:px-6 lg:px-8',
        isScrolled 
          ? 'bg-white/90 backdrop-blur-md shadow-md py-3' 
          : 'bg-transparent py-5'
      )}
    >
      <div className="mx-auto max-w-7xl flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a365d] shadow-lg group-hover:scale-105 transition-transform duration-200">
            <Scale className="h-6 w-6 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight text-[#1a365d]">
              {FIRM_DEFAULTS.firmName.split(',')[0]}
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-gray-500 line-height-1">
              Law Offices
            </span>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              to={link.href}
              className={cn(
                'text-sm font-semibold transition-colors duration-200 hover:text-[#2b6cb0]',
                location.pathname === link.href ? 'text-[#1a365d]' : 'text-gray-600'
              )}
            >
              {link.name}
            </Link>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-4">
          <Button 
            asChild
            className="bg-[#1a365d] hover:bg-[#1e407a] text-white rounded-full px-6 shadow-indigo-100 shadow-xl hover:shadow-2xl transition-all duration-300"
          >
            <Link to="/assessment" className="flex items-center gap-2">
              Free Self Assessment
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      <div
        className={cn(
          'fixed inset-0 top-[64px] z-40 bg-white md:hidden transition-transform duration-300 ease-in-out',
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="flex flex-col p-6 gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              to={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="text-lg font-bold text-[#1a365d] border-b border-gray-100 pb-2"
            >
              {link.name}
            </Link>
          ))}
          <Button 
            asChild
            className="w-full bg-[#1a365d] py-6 text-lg"
            onClick={() => setMobileMenuOpen(false)}
          >
            <Link to="/assessment">Free Self Assessment</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

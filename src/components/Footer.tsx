import { Link } from 'react-router-dom';
import { Phone, MapPin } from 'lucide-react';
import Logo from './ui/Logo';
import { wrapNavigateClick } from '../lib/clickPerf';

interface FooterProps {
  onNavigate: (page: string) => void;
}

const footerMiniLinks = [
  { label: 'View Experiences', path: 'experiences' as const },
  { label: 'Bioluminescence Tours', path: 'bioluminescent-tours' as const },
  { label: 'Rocket Launch Charters', path: 'launches' as const },
  { label: 'Sunset & Wildlife', path: 'sunset-wildlife' as const },
  { label: 'Daytona Rentals', path: 'fleet-daytona' as const },
  { label: 'Titusville Rentals', path: 'fleet-titusville' as const },
  { label: 'Rental Pricing', path: 'pricing' as const },
  { label: 'Bioluminescence Guide', path: 'bioluminescence' as const },
  { label: 'Observation Bottle', path: 'observation-bottle' as const },
  { label: "Captain's Log", path: 'captains-log' as const },
  { label: 'About', path: 'about' as const },
  { label: 'Contact', path: 'contact' as const },
  { label: 'FAQs', path: 'faqs' as const },
];

export default function Footer({ onNavigate }: FooterProps) {
  return (
    <footer className="border-t border-cyan-500/15 bg-lz-elevated text-slate-300 shadow-[inset_0_1px_0_rgba(0,207,255,0.06)] transition-colors duration-300">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="flex flex-col items-center text-center">
            <Logo variant="footer" className="mx-auto mb-4 justify-center" />
            <p className="text-lg font-semibold text-white">Launch Zone Charters</p>
            <p className="mt-1 text-sm text-slate-300">Daytona Beach, FL</p>
            <p className="mt-2 text-sm text-slate-400">Licensed & Insured</p>
            <nav
              className="mt-6 flex max-w-md flex-wrap justify-center gap-x-3 gap-y-2 border-t border-white/10 pt-6 text-xs"
              aria-label="Footer shortcuts"
            >
              {footerMiniLinks.map(({ label, path }) => (
                <button
                  key={path}
                  type="button"
                  onClick={wrapNavigateClick('footer', path, onNavigate)}
                  className="text-slate-400 transition-colors hover:text-amber-400"
                >
                  {label}
                </button>
              ))}
              <Link
                to="/booking/groupon"
                className="text-slate-400 transition-colors hover:text-amber-400"
              >
                Redeem Groupon Voucher
              </Link>
            </nav>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-white">Experiences</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'experiences', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  View Experiences
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'bioluminescent-tours', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Bioluminescence Tours
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'launches', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Rocket Launch Charters
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'sunset-wildlife', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Sunset and Wildlife Cruise
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-white">Rentals &amp; legal</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'fleet-daytona', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Daytona and Port Orange Rentals
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'fleet-titusville', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Titusville Rentals
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'pricing', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Rental Pricing
                </button>
              </li>
              <li>
                <Link to="/booking/groupon" className="transition-colors hover:text-amber-400">
                  Redeem Groupon Voucher
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'terms', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Terms &amp; Conditions
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'refund-policy', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  Refund Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={wrapNavigateClick('footer', 'faqs', onNavigate)}
                  className="transition-colors hover:text-amber-400"
                >
                  FAQs
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-white">Contact Us</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center space-x-2">
                <Phone className="h-4 w-4 shrink-0 text-amber-400" />
                <a href="tel:803-542-1761" className="transition-colors hover:text-amber-400">
                  803-542-1761
                </a>
              </li>
              <li className="flex items-start space-x-2">
                <MapPin className="mt-1 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <div>Port Orange, FL</div>
                  <div>Daytona Beach, FL</div>
                  <div>Titusville, FL</div>
                  <div>Orlando, FL</div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-700 pt-8 text-center text-sm">
          <p>&copy; {new Date().getFullYear()} Launch Zone Charters. All rights reserved.</p>
          <p className="mt-2">Licensed & Insured | Open 7 Days a Week</p>
          <p className="mt-4">
            <Link
              to="/admin"
              className="text-xs font-semibold text-slate-500 underline-offset-2 transition-colors hover:text-amber-400 hover:underline"
            >
              Staff Login
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

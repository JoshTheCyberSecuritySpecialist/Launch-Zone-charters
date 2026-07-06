import { lazy, Suspense, useCallback } from 'react';
import FullPageLoader from './components/FullPageLoader';
import { Helmet } from 'react-helmet-async';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './pages/Home';
import BoatRentalsLocation from './pages/BoatRentalsLocation';
import Pricing from './pages/Pricing';
import About from './pages/About';
import Contact from './pages/Contact';
import FAQs from './pages/FAQs';
import Terms from './pages/Terms';
import RefundPolicy from './pages/RefundPolicy';
import Launches from './pages/Launches';
import Conditions from './pages/Conditions';
import BookNow from './pages/BookNow';
import BookingReceived from './pages/BookingReceived';
import BookingSuccess from './pages/BookingSuccess';
import InsuranceRequired from './pages/InsuranceRequired';
import WaiversInsurance from './pages/WaiversInsurance';
import BookingDepositCancel from './pages/BookingDepositCancel';
import VerifyBooking from './pages/VerifyBooking';
import Admin from './pages/Admin';
import AdminOperationsDashboard from './pages/AdminOperationsDashboard';
import AdminBoats from './pages/AdminBoats';
import AdminStaffBooking from './pages/AdminStaffBooking';
import AdminCalendar from './pages/AdminCalendar';
import AdminBookingDetails from './pages/AdminBookingDetails';
import AdminOutbox from './pages/AdminOutbox';
import AdminLogin from './pages/AdminLogin';
import CaptainsLog from './pages/CaptainsLog';
import LogArticle from './pages/LogArticle';
import BioluminescentTours from './pages/BioluminescentTours';
import ObservationBottle from './pages/ObservationBottle';
import { pageKeyFromPath, pathFromPageKey } from './navigation';
import ScrollToTop from './components/ScrollToTop';
import { SITE_FAVICON_PATH } from './constants/branding';

const BioGuidePage = lazy(() => import('./pages/BioGuidePage'));

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPage = pageKeyFromPath(location.pathname);

  const onNavigate = useCallback(
    (page: string) => {
      navigate(pathFromPageKey(page));
    },
    [navigate]
  );

  const showHeaderFooter = currentPage !== 'admin-login';

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <link rel="icon" type="image/png" href={SITE_FAVICON_PATH} />
        <link rel="apple-touch-icon" href={SITE_FAVICON_PATH} />
        <link rel="shortcut icon" href={SITE_FAVICON_PATH} />
      </Helmet>
      <ScrollToTop />
      {showHeaderFooter && <Header onNavigate={onNavigate} currentPage={currentPage} />}
      <main
        className={`relative z-0 flex flex-1 flex-col${showHeaderFooter ? ' lz-main-with-header' : ''}`}
      >
        <Routes>
          <Route path="/" element={<Home onNavigate={onNavigate} />} />
          <Route
            path="/boat-rentals/daytona"
            element={<BoatRentalsLocation variant="daytona" onNavigate={onNavigate} />}
          />
          <Route
            path="/boat-rentals/titusville"
            element={<BoatRentalsLocation variant="titusville" onNavigate={onNavigate} />}
          />
          <Route path="/boat-rentals" element={<Navigate to="/boat-rentals/daytona" replace />} />
          <Route path="/boat-rentals-daytona-beach" element={<Navigate to="/boat-rentals/daytona" replace />} />
          <Route path="/boats" element={<Navigate to="/boat-rentals/daytona" replace />} />
          <Route path="/booking" element={<BookNow onNavigate={onNavigate} />} />
          <Route path="/booking-received" element={<BookingReceived onNavigate={onNavigate} />} />
          <Route path="/booking-success" element={<BookingSuccess onNavigate={onNavigate} />} />
          <Route path="/success" element={<BookingSuccess onNavigate={onNavigate} />} />
          <Route path="/insurance-required" element={<InsuranceRequired onNavigate={onNavigate} />} />
          <Route path="/waivers-insurance" element={<WaiversInsurance onNavigate={onNavigate} />} />
          <Route path="/booking-deposit-cancel" element={<BookingDepositCancel onNavigate={onNavigate} />} />
          <Route path="/verify" element={<VerifyBooking onNavigate={onNavigate} />} />
          <Route path="/pricing" element={<Pricing onNavigate={onNavigate} />} />
          <Route path="/launches" element={<Launches onNavigate={onNavigate} />} />
          <Route
            path="/bioluminescence"
            element={
              <Suspense fallback={<FullPageLoader variant="dark" message="Loading guide…" />}>
                <BioGuidePage onNavigate={onNavigate} />
              </Suspense>
            }
          />
          <Route path="/bioluminescent-tours" element={<BioluminescentTours onNavigate={onNavigate} />} />
          <Route path="/shop/observation-bottle" element={<ObservationBottle onNavigate={onNavigate} />} />
          <Route path="/conditions" element={<Conditions onNavigate={onNavigate} />} />
          <Route path="/faqs" element={<FAQs onNavigate={onNavigate} />} />
          <Route path="/about" element={<About onNavigate={onNavigate} />} />
          <Route path="/contact" element={<Contact onNavigate={onNavigate} />} />
          <Route path="/captains-log" element={<CaptainsLog onNavigate={onNavigate} />} />
          <Route path="/log/:slug" element={<LogArticle onNavigate={onNavigate} />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/refund-policy" element={<RefundPolicy />} />
          <Route path="/admin-login" element={<AdminLogin onNavigate={onNavigate} />} />
          <Route path="/admin" element={<AdminOperationsDashboard />} />
          <Route path="/admin/bookings" element={<Admin onNavigate={onNavigate} />} />
          <Route path="/admin/staff-booking" element={<AdminStaffBooking />} />
          <Route path="/admin/calendar" element={<AdminCalendar />} />
          <Route path="/admin/bookings/:id" element={<AdminBookingDetails />} />
          <Route path="/admin/outbox" element={<AdminOutbox />} />
          <Route path="/admin/boats" element={<AdminBoats onNavigate={onNavigate} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {showHeaderFooter && <Footer onNavigate={onNavigate} />}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;

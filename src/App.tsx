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
import AdminBookingsHub from './pages/AdminBookingsHub';
import AdminApprovals from './pages/AdminApprovals';
import AdminMessages from './pages/AdminMessages';
import AdminPreTrip from './pages/AdminPreTrip';
import AdminPreTripDetail from './pages/AdminPreTripDetail';
import AdminPromoCodes from './pages/AdminPromoCodes';
import AdminCaptainsLog from './pages/AdminCaptainsLog';
import AdminMoreTools from './pages/AdminMoreTools';
import AdminBoats from './pages/AdminBoats';
import AdminStaffBooking from './pages/AdminStaffBooking';
import AdminCalendar from './pages/AdminCalendar';
import AdminBookingDetails from './pages/AdminBookingDetails';
import AdminBookingEdit from './pages/AdminBookingEdit';
import AdminOutbox from './pages/AdminOutbox';
import AdminDisputes from './pages/AdminDisputes';
import AdminLogin from './pages/AdminLogin';
import AdminEntryGate from './components/admin/AdminEntryGate';
import AdminDocumentHead from './components/admin/AdminDocumentHead';
import CaptainsLog from './pages/CaptainsLog';
import LogArticle from './pages/LogArticle';
import BioluminescentTours from './pages/BioluminescentTours';
import ObservationBottle from './pages/ObservationBottle';
import ShopOrderSuccess from './pages/ShopOrderSuccess';
import AdminShopOrders from './pages/AdminShopOrders';
import { pageKeyFromPath, pathFromPageKey } from './navigation';
import ScrollToTop from './components/ScrollToTop';
import { SITE_APPLE_TOUCH_ICON_PATH, SITE_FAVICON_PATH } from './constants/branding';
import { isAdminAreaPath } from './components/admin/adminNav';

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

  // Admin area uses AdminShell; keep marketing chrome off /admin* and /admin-login
  const showHeaderFooter = !isAdminAreaPath(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href={SITE_FAVICON_PATH} />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href={SITE_APPLE_TOUCH_ICON_PATH} />
        <link rel="shortcut icon" href="/favicon.ico" />
      </Helmet>
      {!showHeaderFooter ? <AdminDocumentHead /> : null}
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
          <Route path="/shop/order-success" element={<ShopOrderSuccess onNavigate={onNavigate} />} />
          <Route path="/conditions" element={<Conditions onNavigate={onNavigate} />} />
          <Route path="/faqs" element={<FAQs onNavigate={onNavigate} />} />
          <Route path="/about" element={<About onNavigate={onNavigate} />} />
          <Route path="/contact" element={<Contact onNavigate={onNavigate} />} />
          <Route path="/captains-log" element={<CaptainsLog onNavigate={onNavigate} />} />
          <Route path="/log/:slug" element={<LogArticle onNavigate={onNavigate} />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/refund-policy" element={<RefundPolicy />} />
          <Route path="/admin-login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminEntryGate />} />
          <Route path="/admin/more" element={<AdminMoreTools />} />
          <Route path="/admin/bookings" element={<AdminBookingsHub />} />
          <Route path="/admin/bookings/list" element={<Admin onNavigate={onNavigate} />} />
          <Route path="/admin/bookings/:id/edit" element={<AdminBookingEdit />} />
          <Route path="/admin/bookings/:id" element={<AdminBookingDetails />} />
          <Route path="/admin/staff-booking" element={<AdminStaffBooking />} />
          <Route path="/admin/calendar" element={<AdminCalendar />} />
          <Route path="/admin/approvals" element={<AdminApprovals />} />
          <Route path="/admin/messages" element={<AdminMessages />} />
          <Route path="/admin/pre-trip" element={<AdminPreTrip />} />
          <Route path="/admin/pre-trip/:id" element={<AdminPreTripDetail />} />
          <Route path="/admin/promo-codes" element={<AdminPromoCodes />} />
          <Route path="/admin/captains-log" element={<AdminCaptainsLog />} />
          <Route path="/admin/outbox" element={<AdminOutbox />} />
          <Route path="/admin/disputes" element={<AdminDisputes />} />
          <Route path="/admin/shop-orders" element={<AdminShopOrders />} />
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

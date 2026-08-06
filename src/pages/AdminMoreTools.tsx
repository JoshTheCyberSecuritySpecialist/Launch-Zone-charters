import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  BarChart3,
  ClipboardList,
  Inbox,
  LayoutGrid,
  Ship,
  ShoppingBag,
  Tag,
  Anchor,
  UserRound,
  Ticket,
  Headphones,
} from 'lucide-react';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminDashboardCard from '../components/admin/AdminDashboardCard';

const TOOLS = [
  {
    to: '/admin/analytics',
    title: 'Analytics',
    description: 'Lifetime bookings, revenue, and customer totals.',
    icon: <BarChart3 className="h-6 w-6" />,
  },
  {
    to: '/admin/outbox',
    title: 'Communications Outbox',
    description: 'Sent email and SMS history.',
    icon: <Inbox className="h-6 w-6" />,
  },
  {
    to: '/admin/disputes',
    title: 'Disputes',
    description: 'Stripe disputes and evidence.',
    icon: <AlertTriangle className="h-6 w-6" />,
  },
  {
    to: '/admin/shop-orders',
    title: 'Shop Orders',
    description: 'Observation bottle and shop fulfillment.',
    icon: <ShoppingBag className="h-6 w-6" />,
  },
  {
    to: '/admin/pre-trip',
    title: 'Pre-Trip Submissions',
    description: 'Match and approve waiver packets.',
    icon: <ClipboardList className="h-6 w-6" />,
  },
  {
    to: '/admin/promo-codes',
    title: 'Promo Codes',
    description: 'Checkout discounts.',
    icon: <Tag className="h-6 w-6" />,
  },
  {
    to: '/admin/groupon',
    title: 'Groupon Vouchers',
    description: 'Import Groupon CSV reports and manage deal mappings.',
    icon: <Ticket className="h-6 w-6" />,
  },
  {
    to: '/admin/support',
    title: 'Customer Support',
    description: 'Lookup bookings, Groupon exceptions, and nightly operations.',
    icon: <Headphones className="h-6 w-6" />,
  },
  {
    to: '/admin/captains-log',
    title: "Captain's Log",
    description: 'Articles and alert tools.',
    icon: <BookOpen className="h-6 w-6" />,
  },
  {
    to: '/admin/boats',
    title: 'Boats',
    description: 'Fleet listings and USCG capacity plate settings.',
    icon: <Anchor className="h-6 w-6" />,
  },
  {
    to: '/admin/captains',
    title: 'Captains',
    description: 'Crew portal access and charter assignments.',
    icon: <UserRound className="h-6 w-6" />,
  },
  {
    to: '/admin/bookings',
    title: 'Booking Tools',
    description: 'Promo, payment recovery, and hub counts.',
    icon: <LayoutGrid className="h-6 w-6" />,
  },
  {
    to: '/admin/bookings/list#payment-recovery',
    title: 'Payment Recovery',
    description: 'Unmatched payments and failed jobs.',
    icon: <Ship className="h-6 w-6" />,
  },
];

export default function AdminMoreTools() {
  const { user, isAdmin, loading: authLoading } = useAuth();

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) return <AdminAccessDenied signedIn={Boolean(user)} />;

  return (
    <AdminShell
      title="More Tools"
      mobileTitle="More"
      subtitle="Less-used admin pages"
      hideSubtitleOnMobile
    >
      <p className="mb-4 text-base text-slate-600">
        <Link to="/admin" className="font-bold text-amber-800 underline">
          Back to Operations
        </Link>
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TOOLS.map((tool) => (
          <AdminDashboardCard
            key={tool.to}
            to={tool.to}
            title={tool.title}
            description={tool.description}
            icon={tool.icon}
          />
        ))}
      </div>
    </AdminShell>
  );
}

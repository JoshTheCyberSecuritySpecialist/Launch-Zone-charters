import type { CaptainVerificationItem } from '../../lib/captainApi';

type CaptainVerificationSummaryProps = {
  items?: CaptainVerificationItem[];
  compact?: boolean;
  paymentDisplay?: 'Ready' | 'Action Required';
};

export default function CaptainVerificationSummary({
  items = [],
  compact = false,
  paymentDisplay,
}: CaptainVerificationSummaryProps) {
  if (!items.length && !paymentDisplay) return null;

  if (compact) {
    const missing = items.filter((item) => !item.done).length;
    const payment = paymentDisplay || items.find((i) => i.key === 'payment')?.note;
    return (
      <p className="text-sm text-slate-600">
        {missing > 0 ? `${missing} item${missing === 1 ? '' : 's'} pending` : 'Verification complete'}
        {payment ? ` · Payment ${payment}` : ''}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.key}
          className={`rounded-xl px-3 py-2 text-base ${
            item.done ? 'bg-green-50 text-green-950' : 'bg-amber-50 text-amber-950'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{item.label}</span>
            <span className="text-sm font-bold uppercase">{item.done ? 'Done' : 'Pending'}</span>
          </div>
          {item.note ? <p className="mt-1 text-sm opacity-90">{item.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

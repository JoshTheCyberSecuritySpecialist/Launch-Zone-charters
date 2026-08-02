const STEPS = [
  {
    title: 'Choose Your Experience',
    body: 'Bioluminescence night tour, rocket launch charter, sunset and wildlife cruise, or self-drive boat rental.',
  },
  {
    title: 'Select Your Preferred Date',
    body: 'Choose the date and time that works best for your group.',
  },
  {
    title: 'Receive Booking Confirmation',
    body: 'After checkout you receive reservation details by email. Our booking team monitors the schedule and will contact you if weather or operations require a change.',
  },
  {
    title: 'Complete Payment and Prepare',
    body: 'Pay securely online through Stripe during checkout, then review trip details and complete any required waivers before your trip.',
  },
] as const;

export default function DirectBookingSteps() {
  return (
    <div className="mt-12">
      <h3 className="text-center font-display text-xl font-bold uppercase tracking-[0.12em] text-white md:text-2xl">
        How Direct Booking Works
      </h3>
      <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="lz-card-glass relative p-5 md:p-6">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/35 bg-cyan-950/40 text-sm font-bold text-cyan-100"
              aria-hidden
            >
              {index + 1}
            </span>
            <p className="mt-3 text-sm font-bold uppercase tracking-wide text-white">{step.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

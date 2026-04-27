import { Clock, DollarSign, CloudRain, Rocket, AlertCircle } from 'lucide-react';
import { CANCELLATION_REFUND_POLICY_SUBSECTIONS } from '../content/cancellationRefundPolicy';

export default function RefundPolicy() {
  const [sub48, sub24, subLt24, subNoShow, subWeather] = CANCELLATION_REFUND_POLICY_SUBSECTIONS;
  return (
    <div className="min-h-screen bg-slate-50">
      <section className="lz-page-hero py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <DollarSign className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-5xl font-bold mb-6">Refund & Cancellation Policy</h1>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
            Clear and fair policies to protect both you and our business
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
            <h2 className="text-3xl font-bold text-slate-900 mb-6">Cancellation Timeframes</h2>

            <div className="space-y-6">
              <div className="border-l-4 border-green-500 bg-green-50 p-6 rounded-r-lg">
                <div className="flex items-start space-x-4">
                  <Clock className="h-8 w-8 text-green-600 flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-green-900 mb-2">{sub48.heading}</h3>
                    <p className="text-green-800 mb-3">
                      <strong>Full refund</strong>
                    </p>
                    <p className="text-green-700">{sub48.body}</p>
                  </div>
                </div>
              </div>

              <div className="border-l-4 border-amber-500 bg-amber-50 p-6 rounded-r-lg">
                <div className="flex items-start space-x-4">
                  <Clock className="h-8 w-8 text-amber-600 flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-amber-900 mb-2">{sub24.heading}</h3>
                    <p className="text-amber-800 mb-3">
                      <strong>No refund; credit at discretion</strong>
                    </p>
                    <p className="text-amber-700">{sub24.body}</p>
                  </div>
                </div>
              </div>

              <div className="border-l-4 border-red-500 bg-red-50 p-6 rounded-r-lg">
                <div className="flex items-start space-x-4">
                  <Clock className="h-8 w-8 text-red-600 flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-red-900 mb-2">{subLt24.heading}</h3>
                    <p className="text-red-800 mb-3">
                      <strong>No refund or credit</strong>
                    </p>
                    <p className="text-red-700">{subLt24.body}</p>
                  </div>
                </div>
              </div>

              <div className="border-l-4 border-slate-700 bg-slate-100 p-6 rounded-r-lg">
                <div className="flex items-start space-x-4">
                  <AlertCircle className="h-8 w-8 text-slate-700 flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">{subNoShow.heading}</h3>
                    <p className="text-slate-800 mb-3">
                      <strong>Charged in full</strong>
                    </p>
                    <p className="text-slate-700">{subNoShow.body}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
            <div className="flex items-start space-x-4 mb-6">
              <CloudRain className="h-10 w-10 text-blue-600 flex-shrink-0" />
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-4">{subWeather.heading}</h2>
                <div className="space-y-4 text-slate-600 leading-relaxed">
                  <p>{subWeather.body}</p>
                  <p>
                    We continuously monitor marine forecasts and will proactively contact you when conditions warrant.
                    Your safety is our priority.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
            <div className="flex items-start space-x-4 mb-6">
              <Rocket className="h-10 w-10 text-purple-600 flex-shrink-0" />
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-4">Rocket Launch Tour Policy</h2>
                <div className="space-y-4 text-slate-600 leading-relaxed">
                  <p>
                    Rocket launch tours are specialty rentals scheduled around anticipated SpaceX and NASA launches.
                    Due to the unique nature of these events, special policies apply.
                  </p>

                  <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
                    <h3 className="font-semibold text-red-900 mb-2">Important: No Launch Guarantee</h3>
                    <p className="text-red-800">
                      <strong>Launch timing is NEVER guaranteed.</strong> Rocket launches are frequently delayed or scrubbed
                      due to technical issues, weather, or other factors beyond our control.
                    </p>
                  </div>

                  <div className="bg-slate-100 border border-slate-300 rounded-lg p-4">
                    <h3 className="font-semibold text-slate-900 mb-2">If a Launch is Delayed or Scrubbed</h3>
                    <p className="text-slate-700">
                      If a launch is delayed or cancelled:
                    </p>
                    <ul className="mt-2 space-y-1 text-slate-700 list-disc list-inside ml-4">
                      <li><strong>No refunds will be provided</strong></li>
                      <li>Your tour will proceed as a regular sightseeing cruise</li>
                      <li>All standard terms and full pricing remain in effect</li>
                      <li>The experience remains valuable with beautiful waterway views</li>
                    </ul>
                  </div>

                  <p>
                    By booking a rocket launch tour, you acknowledge and accept that launch timing is not under our
                    control and that the tour may proceed without a launch occurring.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Refund Processing</h2>
            <div className="space-y-4 text-slate-600 leading-relaxed">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Processing Time</h3>
                  <p>Approved refunds are processed within 5-7 business days. Depending on your financial institution,
                  it may take an additional 3-5 business days for funds to appear in your account.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Refund Method</h3>
                  <p>Refunds are issued to the original payment method used for booking. We cannot issue refunds
                  to different accounts or payment methods.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Credits</h3>
                  <p>Credits are valid for one year from the date of issue and can be applied to any rental.
                  Credits are non-transferable and cannot be redeemed for cash.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Security deposits</h3>
                  <p>
                    A refundable $300 security deposit is charged at booking and held by Stripe. It is refunded after the
                    vessel is returned and inspected (not governed by the cancellation timeframes above). Refunds are issued to
                    the original payment method; banks typically process in 5–10 business days. The deposit may be partially or
                    fully retained for damage, excessive cleaning, fuel discrepancies, or late return, limited to actual costs.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">How to Cancel</h2>
            <div className="space-y-4 text-slate-600 leading-relaxed">
              <p>
                To cancel your booking, please contact us as soon as possible:
              </p>
              <div className="bg-slate-50 rounded-lg p-6">
                <div className="space-y-3">
                  <div>
                    <strong className="text-slate-900">Phone:</strong>
                    <a href="tel:803-542-1761" className="ml-2 text-amber-600 hover:text-amber-700 font-semibold">
                      803-542-1761
                    </a>
                  </div>
                  <div>
                    <strong className="text-slate-900">Hours:</strong> 8 AM - 8 PM, 7 days a week
                  </div>
                </div>
              </div>
              <p>
                Please have your booking confirmation number ready when you contact us. Cancellation requests are
                processed immediately, and you will receive confirmation via email.
              </p>
            </div>
          </div>

          <div className="bg-slate-900 text-white rounded-xl p-6 mt-8">
            <div className="flex items-start space-x-3">
              <AlertCircle className="h-6 w-6 text-amber-400 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-bold mb-2">Policy Changes</h3>
                <p className="text-slate-300 text-sm">
                  Launch Zone Charters reserves the right to modify this refund policy at any time. Changes will
                  not affect existing bookings made prior to the policy change.
                </p>
              </div>
            </div>
          </div>

          <p className="text-center text-sm text-slate-500 mt-8">
            Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </section>
    </div>
  );
}

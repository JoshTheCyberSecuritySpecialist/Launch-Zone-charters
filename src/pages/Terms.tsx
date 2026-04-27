import { Shield, FileText, AlertTriangle } from 'lucide-react';
import {
  CANCELLATION_REFUND_POLICY_SUBSECTIONS,
  CANCELLATION_REFUND_POLICY_TITLE,
} from '../content/cancellationRefundPolicy';

export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50">
      <section className="lz-page-hero py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <FileText className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-5xl font-bold mb-6">Terms & Conditions</h1>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
            Please read these terms carefully before booking with Launch Zone Charters
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-amber-50 border-l-4 border-amber-600 p-6 mb-8">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-bold text-amber-900 mb-2">Important Notice</h3>
                <p className="text-amber-800">
                  By booking a rental with Launch Zone Charters, you agree to be bound by these Terms and Conditions.
                  Please read them carefully and contact us if you have any questions.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-8 space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">1. Acceptance of Terms</h2>
              <p className="text-slate-600 leading-relaxed">
                These Terms and Conditions constitute a legally binding agreement between you and Launch Zone Charters.
                By making a reservation, you acknowledge that you have read, understood, and agree to be bound by these terms.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">2. Eligibility and Requirements</h2>
              <ul className="space-y-2 text-slate-600 list-disc list-inside leading-relaxed">
                <li>Renters must be at least 25 years of age</li>
                <li>Valid government-issued photo identification is required</li>
                <li>A valid boating license is required for self-operated rentals</li>
                <li>All renters must sign a liability waiver before taking possession of the vessel</li>
                <li>Renters must be physically capable of operating the vessel safely</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">3. Reservations and Bookings</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  <strong>Booking Confirmation:</strong> All reservations are subject to availability. Your booking is confirmed
                  only upon receipt of payment and acceptance by Launch Zone Charters.
                </p>
                <p>
                  <strong>Minimum Notice:</strong> We prefer 24 hours advance notice for all bookings. Same-day bookings are
                  accepted based on availability.
                </p>
                <p>
                  <strong>Night Tours:</strong> Night tours require advance reservation and may require additional approval.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">4. Payment Terms</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  <strong>Deposit:</strong> A deposit is required at the time of booking. The remaining balance may be collected
                  before or after your rental.
                </p>
                <p>
                  <strong>Security deposit ($300):</strong>{' '}
                  A refundable security deposit is charged at booking and held by our payment processor (Stripe). It is
                  refunded after the vessel is returned and inspected. The deposit may be partially or fully retained for
                  damage, excessive cleaning, fuel discrepancies, or late return. Any deductions are limited to the actual
                  cost of repair, replacement, or related service or labor. Pre-existing conditions are documented before
                  departure and are not charged to you. Photos and inspection notes may be used to assess charges. Refunds are
                  issued to the original payment method; banks typically process refunds in 5–10 business days.
                </p>
                <p>
                  <strong>Authorization:</strong> By completing your booking, you authorize applicable charges to be deducted
                  from the security deposit if necessary.
                </p>
                <p>
                  <strong>Peak Pricing:</strong> Additional surcharges of 10-20% may apply during holidays, special events, and
                  major rocket launches. All pricing including surcharges will be clearly displayed before booking completion.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">{CANCELLATION_REFUND_POLICY_TITLE}</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                {CANCELLATION_REFUND_POLICY_SUBSECTIONS.map(({ heading, body }) => (
                  <p key={heading}>
                    <strong>{heading}:</strong> {body}
                  </p>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">6. Late Return & Non-Return Policy</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>A 15-minute grace period is allowed.</p>
                <p>
                  After 15 minutes without communication, a $75 late fee is applied.
                </p>
                <p>
                  After 30 minutes, the booking is charged at 1.5x the hourly rental rate.
                </p>
                <p>
                  After 60 minutes, the booking is charged at 2x the hourly rental rate and additional recovery or retrieval
                  fees may apply.
                </p>
                <p>
                  Failure to return the vessel or communicate within a reasonable timeframe may be considered unauthorized use,
                  and Launch Zone Charters reserves the right to take further action, including contacting local authorities.
                </p>
                <p>
                  Renter remains fully responsible for the vessel until it is returned and inspected.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">7. Assumption of Risk</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  Renter acknowledges that boating involves inherent risks, including but not limited to water hazards, weather
                  conditions, vessel operation, collisions, slips and falls, equipment failure, and personal injury or death.
                </p>
                <p>Renter voluntarily assumes all risks associated with the use of the vessel.</p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">8. Vessel Operation and Safety</h2>
              <ul className="space-y-2 text-slate-600 list-disc list-inside leading-relaxed">
                <li>Operators must follow all applicable maritime laws and regulations</li>
                <li>Maximum passenger capacity must never be exceeded</li>
                <li>Life jackets must be worn by all children under 6 at all times</li>
                <li>No glass containers are permitted on board</li>
                <li>Alcohol consumption must be responsible and within legal limits</li>
                <li>Operation under the influence of drugs or alcohol is strictly prohibited</li>
                <li>Vessels must remain within designated operating areas</li>
              </ul>
              <div className="mt-4 space-y-2 text-slate-600 leading-relaxed">
                <p className="font-semibold text-slate-800">Operator Responsibility</p>
                <p>
                  The renter is the sole operator and is fully responsible for safe operation of the vessel, all passengers on
                  board, and compliance with all applicable laws and regulations.
                </p>
                <p>Operator must not be under the influence of drugs or alcohol.</p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">9. Damage and Liability</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  Renters are responsible for any damage to the vessel beyond normal wear and tear. The security deposit may be
                  applied toward repair costs. If damage exceeds the security deposit amount, the renter is responsible for the
                  full cost of repairs.
                </p>
                <p>
                  Renters are liable for any fines, citations, or penalties incurred during the rental period due to violations
                  of maritime law, regulations, or these terms.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">10. Indemnification</h2>
              <p className="text-slate-600 leading-relaxed">
                Renter agrees to indemnify, defend, and hold harmless Launch Zone Charters from any and all claims, damages,
                losses, liabilities, or expenses arising out of the renter&apos;s use of the vessel, including but not limited to
                injury to persons, damage to property, or violations of law.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">11. Cleaning & Fuel Policy</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  Excessive cleaning (including trash, spills, sand, or bodily fluids) may result in a cleaning fee of $50-$150
                  depending on severity.
                </p>
                <p>
                  The vessel must be returned with the same fuel level as provided. If not, fuel will be charged at a premium
                  rate plus service fee.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">12. Estimated Damage Fee Schedule</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  The following amounts are estimates only and may increase based on actual repair invoices, parts, labor,
                  towing, haul-out, inspection, and vessel downtime:
                </p>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Prop strike / propeller damage: $250-$800+</li>
                  <li>Lower unit / skeg damage: $500-$3,500+</li>
                  <li>Grounding / sandbar impact inspection fee: $250+</li>
                  <li>Hull / fiberglass / gelcoat damage: $300-$2,500+</li>
                  <li>Docking collision damage: based on actual repair cost</li>
                  <li>Lost life jacket: $40-$75 each</li>
                  <li>Lost anchor: $75-$200</li>
                  <li>Lost dock line / rope: $25-$75</li>
                  <li>Lost key / key replacement / service call: $75-$200</li>
                  <li>Excessive cleaning: $50-$150+</li>
                  <li>Vomit / biohazard cleaning: $150-$300+</li>
                  <li>Towing / retrieval / recovery: actual cost plus coordination fee</li>
                  <li>Unauthorized late return requiring recovery action: actual cost plus additional late fees</li>
                  <li>Refueling service charge: fuel cost plus service fee</li>
                </ul>
                <p>
                  These amounts are estimates for customer notice only and do not limit Launch Zone Charters from charging the
                  actual full cost of damage or loss.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">13. Insurance</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  Launch Zone Charters maintains commercial marine insurance. However, this insurance does not eliminate renter
                  responsibility. Renters are responsible for their actions and passengers. Certain damages, violations, or
                  incidents may not be covered by our insurance policy.
                </p>
                <p>
                  Renters may wish to obtain personal liability coverage through their own insurance provider.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">14. Rocket Launch Tours</h2>
              <div className="space-y-3 text-slate-600 leading-relaxed">
                <p>
                  Rocket launch tours are scheduled around anticipated SpaceX and NASA launches. Launch timing is never guaranteed
                  and is subject to delays, scrubs, and cancellations by the launch provider.
                </p>
                <p>
                  <strong>No refunds are provided for launch delays or cancellations.</strong> If a launch is scrubbed or delayed,
                  your tour will proceed as a regular sightseeing cruise. All other terms and pricing remain in effect.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">15. Force Majeure</h2>
              <p className="text-slate-600 leading-relaxed">
                Launch Zone Charters is not liable for failure to perform obligations due to circumstances beyond our control,
                including but not limited to: severe weather, natural disasters, government actions, equipment failure, or other
                force majeure events.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">16. Privacy and Data</h2>
              <p className="text-slate-600 leading-relaxed">
                We collect and store customer information necessary to process bookings and provide services. Your information
                will not be shared with third parties except as required for payment processing or as required by law.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">17. Modifications to Terms</h2>
              <p className="text-slate-600 leading-relaxed">
                Launch Zone Charters reserves the right to modify these Terms and Conditions at any time. Changes will be effective
                immediately upon posting. Your continued use of our services after changes are posted constitutes acceptance of the
                modified terms.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">18. Governing Law</h2>
              <p className="text-slate-600 leading-relaxed">
                These Terms and Conditions are governed by the laws of the State of Florida. Any disputes arising from these terms
                or your rental shall be resolved in the courts of Florida.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">19. Contact Information</h2>
              <p className="text-slate-600 leading-relaxed">
                For questions about these Terms and Conditions, please contact Launch Zone Charters at 803-542-1761.
              </p>
            </div>

            <div className="bg-slate-900 text-white p-6 rounded-lg">
              <div className="flex items-start space-x-3">
                <Shield className="h-6 w-6 text-amber-400 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-bold mb-2">Agreement</h3>
                  <p className="text-slate-300 text-sm">
                    By proceeding with a booking, you acknowledge that you have read, understood, and agree to these
                    Terms and Conditions. If you do not agree with any part of these terms, please do not make a reservation.
                  </p>
                </div>
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

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const damageFeeAcknowledgment = require('../lib/damageFeeAcknowledgment');

const LOGO_CANDIDATES = [
  'rocket-launch-boat-rentals-titusville-florida-launch-zone-charters-logo-indian-river-lagoon.png',
  'launchzone-new-logo-boat-rentals-boat-tours.png',
];

const DEFAULT_WAIVER_CONTENT =
  'Florida Boating Liability Waiver — customer accepted assumption of risk, release of liability, indemnification, and related boating terms as presented at sign time. Full waiver text may not have been stored with older records.';

function resolveLogoPath() {
  const base = path.join(__dirname, '../../public/images');
  for (const name of LOGO_CANDIDATES) {
    const candidate = path.join(base, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function safeFileName(value, fallback = 'waiver') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function formatWhen(value) {
  if (!value) return 'Not recorded';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return 'Not recorded';
  return d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
}

function inferBookingSource(waiverContent) {
  const content = String(waiverContent || '').toLowerCase();
  if (content.includes('pre-trip')) return 'Off-platform pre-trip form';
  if (content.includes('checkout') || content.includes('stripe')) return 'Website checkout';
  if (content) return 'Waivers & insurance page';
  return 'Booking record';
}

function tripTypeLabel(tripType) {
  switch (String(tripType || '').trim()) {
    case 'pontoon_rental':
      return 'Pontoon Rental';
    case 'center_console_rental':
      return 'Center Console Rental';
    case 'captain_charter':
      return 'Captain-Led Charter';
    default:
      return tripType || 'Trip';
  }
}

function writeSection(doc, title, lines) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(title);
  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(10).fillColor('#1e293b');
  for (const line of lines) {
    doc.text(String(line || ''), { lineGap: 2 });
  }
  doc.moveDown(0.6);
}

function writeAcknowledgements(doc, pkg) {
  const lines = [
    `${pkg.termsAccepted ? '[x]' : '[ ]'} Terms & Conditions accepted`,
    `${pkg.waiverAccepted ? '[x]' : '[ ]'} Liability waiver accepted`,
  ];
  if (
    damageFeeAcknowledgment.requiresDamageFeeAcknowledgment({
      bookingType: pkg.bookingType,
      tripType: pkg.tripType,
    })
  ) {
    lines.push(
      `${pkg.damageFeeAcknowledged ? '[x]' : '[ ]'} Damage / financial responsibility policy acknowledged`
    );
  }
  writeSection(doc, 'Acknowledgements captured at sign time', lines);
}

async function loadBookingWaiverPackage(supabase, bookingId) {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, waiver_signed, waiver_signed_at, terms_accepted, damage_fee_acknowledged, booking_type, customers(full_name, email), waivers(electronic_signature, signature_date, ip_address, waiver_content, waiver_version, waiver_version_effective_at, accepted)'
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  const customer = Array.isArray(data.customers) ? data.customers[0] : data.customers;
  const waiver = Array.isArray(data.waivers) ? data.waivers[0] : data.waivers;
  const signed = Boolean(data.waiver_signed || waiver?.electronic_signature);
  if (!signed) {
    const err = new Error('No signed waiver on file for this booking.');
    err.statusCode = 404;
    throw err;
  }

  const signatureText = String(waiver?.electronic_signature || '').trim();
  if (!signatureText) {
    const err = new Error('Waiver signature text is missing on this booking.');
    err.statusCode = 404;
    throw err;
  }

  return {
    context: 'booking',
    recordId: bookingId,
    customerName: customer?.full_name || signatureText,
    customerEmail: customer?.email || null,
    signatureText,
    signedAt: waiver?.signature_date || data.waiver_signed_at,
    ipAddress: waiver?.ip_address || null,
    waiverContent: waiver?.waiver_content || DEFAULT_WAIVER_CONTENT,
    waiverVersion: waiver?.waiver_version || null,
    waiverVersionEffectiveAt: waiver?.waiver_version_effective_at || null,
    termsAccepted: Boolean(data.terms_accepted),
    damageFeeAcknowledged: Boolean(data.damage_fee_acknowledged),
    waiverAccepted: waiver?.accepted !== false,
    source: inferBookingSource(waiver?.waiver_content),
    tripType: null,
    bookingType: data.booking_type || null,
  };
}

async function loadPreTripWaiverPackage(supabase, submissionId) {
  const { data, error } = await supabase
    .from('pre_trip_submissions')
    .select('id, customer_name, email, trip_type, waiver_signed, waiver_signature, waiver_signed_at, created_at')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    const err = new Error('Submission not found.');
    err.statusCode = 404;
    throw err;
  }
  if (!data.waiver_signed) {
    const err = new Error('No signed waiver on file for this submission.');
    err.statusCode = 404;
    throw err;
  }

  const signatureText = String(data.waiver_signature || '').trim();
  if (!signatureText) {
    const err = new Error('Waiver signature text is missing on this submission.');
    err.statusCode = 404;
    throw err;
  }

  return {
    context: 'pre_trip',
    recordId: submissionId,
    customerName: data.customer_name || signatureText,
    customerEmail: data.email || null,
    signatureText,
    signedAt: data.waiver_signed_at || data.created_at,
    ipAddress: null,
    waiverContent: DEFAULT_WAIVER_CONTENT,
    waiverVersion: null,
    waiverVersionEffectiveAt: null,
    termsAccepted: true,
    damageFeeAcknowledged: damageFeeAcknowledgment.storedDamageFeeAcknowledged({
      damageFeeAcknowledged: true,
      tripType: data.trip_type,
    }),
    waiverAccepted: true,
    source: 'Off-platform pre-trip form',
    tripType: data.trip_type,
  };
}

function buildSignedWaiverPdf(pkg) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const logoPath = resolveLogoPath();
    if (logoPath) {
      try {
        doc.image(logoPath, { fit: [180, 70], align: 'center' });
        doc.moveDown(0.5);
      } catch (err) {
        console.warn('[waiver-pdf] logo render failed:', err.message || err);
      }
    }

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Launch Zone Charters', { align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor('#475569')
      .text('Electronic Waiver Signature Record', { align: 'center' });
    doc.moveDown(0.35);
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#64748b')
      .text('Typed name signature — not a drawn signature image', { align: 'center' });
    doc.moveDown(1);

    writeSection(doc, 'Record', [
      `Record type: ${pkg.context === 'pre_trip' ? 'Pre-trip submission' : 'Booking'}`,
      `Record ID: ${pkg.recordId}`,
      `Sign source: ${pkg.source}`,
      pkg.tripType ? `Trip type: ${tripTypeLabel(pkg.tripType)}` : null,
      pkg.waiverVersion ? `Waiver version: ${pkg.waiverVersion}` : null,
      pkg.waiverVersionEffectiveAt ? `Waiver version effective: ${formatWhen(pkg.waiverVersionEffectiveAt)}` : null,
      `Generated: ${formatWhen(new Date().toISOString())}`,
    ].filter(Boolean));

    writeSection(doc, 'Customer', [
      pkg.customerName ? `Name: ${pkg.customerName}` : null,
      pkg.customerEmail ? `Email: ${pkg.customerEmail}` : null,
    ].filter(Boolean));

    writeAcknowledgements(doc, pkg);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Electronic signature (typed legal name)');
    doc.moveDown(0.35);
    const boxY = doc.y;
    const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.roundedRect(doc.page.margins.left, boxY, boxWidth, 48, 6).fillAndStroke('#f8fafc', '#cbd5e1');
    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(pkg.signatureText, doc.page.margins.left + 14, boxY + 14, { width: boxWidth - 28 });
    doc.y = boxY + 48;
    doc.moveDown(0.8);

    writeSection(doc, 'Signature metadata', [
      `Signed at: ${formatWhen(pkg.signedAt)}`,
      pkg.ipAddress ? `IP address: ${pkg.ipAddress}` : 'IP address: Not recorded for this record',
    ]);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Waiver content on file');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text(String(pkg.waiverContent || DEFAULT_WAIVER_CONTENT), {
      lineGap: 2,
    });
    doc.moveDown(0.8);

    doc
      .font('Helvetica-Oblique')
      .fontSize(8.5)
      .fillColor('#64748b')
      .text(
        'This PDF is generated from data stored in Launch Zone Charters systems. It documents a typed electronic signature only. No pen-and-ink or drawn signature image is stored or reproduced.',
        { lineGap: 2 }
      );

    const range = doc.bufferedPageRange();
    for (let i = range.start; i <= range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#94a3b8')
        .text(`Page ${i + 1} of ${range.count + 1}`, doc.page.margins.left, doc.page.height - 36, {
          align: 'center',
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        });
    }

    doc.end();
  });
}

function waiverPdfFileName(pkg) {
  const slug = safeFileName(pkg.customerName || pkg.recordId.slice(0, 8));
  return `signed-waiver-${pkg.context}-${slug}.pdf`;
}

module.exports = {
  loadBookingWaiverPackage,
  loadPreTripWaiverPackage,
  buildSignedWaiverPdf,
  waiverPdfFileName,
  safeFileName,
  safeContentDispositionFilename: safeFileName,
  formatWhen,
};

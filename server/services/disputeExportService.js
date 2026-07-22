const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const fetch = require('node-fetch');
const documentUrlValidation = require('./documentUrlValidation');
const disputeEvidenceService = require('./disputeEvidenceService');
const waiverPdfService = require('./waiverPdfService');

const LOGO_CANDIDATES = [
  'rocket-launch-boat-rentals-titusville-florida-launch-zone-charters-logo-indian-river-lagoon.png',
  'launchzone-new-logo-boat-rentals-boat-tours.png',
];

function resolveLogoPath() {
  const base = path.join(__dirname, '../../public/images');
  for (const name of LOGO_CANDIDATES) {
    const candidate = path.join(base, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function safeFileName(value, fallback = 'file') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function buildEvidencePackageFileName(customerName, referenceDate) {
  const slug = safeFileName(customerName || 'Customer', 'Customer');
  const datePart = referenceDate ? String(referenceDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `LaunchZone-Booking-${slug}-${datePart}.zip`;
}

function buildEvidencePdfFileName(customerName, referenceDate) {
  const slug = safeFileName(customerName || 'Customer', 'Customer');
  const datePart = referenceDate ? String(referenceDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `LaunchZone-Booking-${slug}-${datePart}.pdf`;
}

function documentZipName(label, extension) {
  switch (label) {
    case 'license':
      return `Driver_License.${extension}`;
    case 'insurance':
      return `Insurance.${extension}`;
    case 'buoy-insurance-proof':
      return `Buoy_Insurance_Proof.${extension}`;
    default:
      return `documents/${safeFileName(label)}.${extension}`;
  }
}
function extensionFromPath(objectPath, fallback = 'bin') {
  const ext = path.extname(String(objectPath || '')).replace(/^\./, '').toLowerCase();
  return ext || fallback;
}

async function recordEvidenceExport(supabase, { disputeId, bookingId, adminId, format, stripeSubmitted = false }) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('evidence_exports')
    .insert({
      dispute_id: disputeId || null,
      booking_id: bookingId || null,
      admin_id: adminId || null,
      format,
      stripe_submitted: Boolean(stripeSubmitted),
    })
    .select('id, created_at')
    .single();
  if (error) {
    console.warn('[dispute-export] audit log failed:', error.message || error);
    return null;
  }
  return data;
}

async function loadEvidencePackage(supabase, stripe, { disputeId, bookingId }) {
  return disputeEvidenceService.buildEvidenceSummary(supabase, stripe, { disputeId, bookingId });
}

function collectDocumentSources(booking, customer) {
  const verification = Array.isArray(booking.user_verifications)
    ? booking.user_verifications[0]
    : booking.user_verifications;
  const waiver = Array.isArray(booking.waivers) ? booking.waivers[0] : booking.waivers;
  const items = [];

  const pushUrl = (label, url) => {
    const trimmed = String(url || '').trim();
    if (!trimmed) return;
    items.push({ label, url: trimmed });
  };

  pushUrl('license', booking.license_url || customer?.id_document_url);
  pushUrl('insurance', booking.insurance_url || customer?.insurance_proof_url);
  pushUrl('buoy-insurance-proof', verification?.buoy_proof_url);

  return { items, waiver };
}

async function downloadStorageFile(supabase, url, bookingId) {
  const check = documentUrlValidation.validateCustomerDocumentUrl(url, { bookingId });
  if (!check.ok) return null;
  const { data, error } = await supabase.storage.from(check.bucket).download(check.objectPath);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return {
    buffer,
    bucket: check.bucket,
    objectPath: check.objectPath,
    extension: extensionFromPath(check.objectPath),
  };
}

async function downloadReceipt(receiptUrl) {
  const url = String(receiptUrl || '').trim();
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return null;
    const extension = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'html';
    return { buffer, extension, contentType };
  } catch (err) {
    console.warn('[dispute-export] receipt download failed:', err.message || err);
    return null;
  }
}

async function collectExportFiles(supabase, pkg) {
  const booking = await disputeEvidenceService.loadBookingEvidenceContext(supabase, pkg.bookingId);
  if (!booking) {
    return {
      documents: [],
      waiverText: null,
      receiptFile: null,
      receiptUrl: pkg.receiptUrl || null,
    };
  }

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const { items, waiver } = collectDocumentSources(booking, customer);
  const documents = [];

  for (const item of items) {
    const downloaded = await downloadStorageFile(supabase, item.url, pkg.bookingId);
    if (!downloaded) continue;
    documents.push({
      label: item.label,
      zipName: documentZipName(item.label, downloaded.extension),
      buffer: downloaded.buffer,
    });
  }

  const receiptFile = pkg.receiptUrl ? await downloadReceipt(pkg.receiptUrl) : null;

  let signedWaiverPdf = null;
  try {
    const waiverPkg = await waiverPdfService.loadBookingWaiverPackage(supabase, pkg.bookingId);
    if (waiverPkg?.signatureText && waiverPkg.signatureText !== '—') {
      signedWaiverPdf = await waiverPdfService.buildSignedWaiverPdf(waiverPkg);
    }
  } catch (err) {
    console.warn('[dispute-export] signed waiver pdf failed:', err.message || err);
  }

  return {
    documents,
    waiverText: waiver?.waiver_content ? String(waiver.waiver_content) : null,
    signedWaiverPdf,
    receiptFile,
    receiptUrl: pkg.receiptUrl || null,
    customerName: customer?.full_name || null,
    bookingCreatedAt: booking.created_at || null,
  };
}

function writePdfSection(doc, title, lines) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text(title, { underline: true });
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#1e293b');
  for (const line of lines) {
    doc.text(String(line || ''), { lineGap: 2 });
  }
  doc.moveDown(0.8);
}

async function buildEvidencePdf(pkg) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
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
        console.warn('[dispute-export] logo render failed:', err.message || err);
      }
    }

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Launch Zone Charters', { align: 'center' });
    doc.font('Helvetica').fontSize(12).fillColor('#475569').text('Legal Evidence Package — Booking Summary', { align: 'center' });
    doc.moveDown(1);

    writePdfSection(doc, 'Summary Header', pkg.sections.header);
    writePdfSection(doc, 'Service Purchased', pkg.sections.servicePurchased);
    writePdfSection(doc, 'Booking Timeline', pkg.sections.bookingTimeline);
    writePdfSection(doc, 'Payment', pkg.sections.payment);
    writePdfSection(doc, 'Customer Agreement', pkg.sections.customerAgreement);
    writePdfSection(doc, 'Communication Timeline', pkg.sections.communicationTimeline);
    writePdfSection(doc, 'Uploaded Documents', pkg.sections.uploadedDocuments);
    writePdfSection(doc, 'Refund Policy', pkg.sections.refundPolicy);
    writePdfSection(doc, 'Reason Charge Is Valid', pkg.sections.reasonChargeIsValid);
    writePdfSection(doc, 'Admin Notes', pkg.sections.adminNotes);
    writePdfSection(doc, 'Requested Outcome', pkg.sections.requestedOutcome);

    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748b').text(
      'This document was generated from records stored in Launch Zone Charters systems. No information was fabricated.',
      { align: 'left' }
    );

    doc.end();
  });
}

async function buildActivityTimelinePdf(pkg) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text('Launch Zone Charters — Activity Timeline');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10).fillColor('#475569').text(`Booking ID: ${pkg.bookingId}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown(1);

    const timelineLines = Array.isArray(pkg.sections?.communicationTimeline)
      ? pkg.sections.communicationTimeline
      : [];
    const bookingLines = Array.isArray(pkg.sections?.bookingTimeline) ? pkg.sections.bookingTimeline : [];
    const merged = [...bookingLines, ...timelineLines].filter(Boolean);

    if (merged.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text('No timeline entries recorded.');
    } else {
      doc.font('Helvetica').fontSize(10).fillColor('#1e293b');
      for (const line of merged) {
        doc.text(String(line), { lineGap: 2 });
        doc.moveDown(0.25);
      }
    }

    doc.end();
  });
}

async function buildEvidenceZip(supabase, pkg) {
  const files = await collectExportFiles(supabase, pkg);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.append(pkg.summary, { name: 'evidence-summary.txt' });

    buildEvidencePdf(pkg)
      .then(async (pdfBuffer) => {
        archive.append(pdfBuffer, { name: 'Booking_Summary.pdf' });
        archive.append(JSON.stringify({ timeline: pkg.timeline, generatedAt: new Date().toISOString() }, null, 2), {
          name: 'timeline.json',
        });
        archive.append(pkg.sections.communicationTimeline.join('\n'), { name: 'communications-timeline.txt' });
        archive.append(pkg.sections.refundPolicy.join('\n'), { name: 'refund-policy.txt' });

        if (files.waiverText) {
          archive.append(files.waiverText, { name: 'Original_Waiver_Text.txt' });
        }

        if (files.signedWaiverPdf) {
          archive.append(files.signedWaiverPdf, { name: 'Signed_Waiver.pdf' });
        }

        for (const docFile of files.documents) {
          archive.append(docFile.buffer, { name: docFile.zipName });
        }

        try {
          const timelinePdf = await buildActivityTimelinePdf(pkg);
          archive.append(timelinePdf, { name: 'Activity_Timeline.pdf' });
        } catch (err) {
          console.warn('[dispute-export] activity timeline pdf failed:', err.message || err);
        }

        if (files.receiptFile) {
          archive.append(files.receiptFile.buffer, {
            name: `receipt/receipt.${files.receiptFile.extension}`,
          });
        } else if (files.receiptUrl) {
          archive.append(`Receipt URL:\n${files.receiptUrl}\n`, { name: 'receipt/receipt-link.txt' });
        }

        archive.append(
          [
            `Booking ID: ${pkg.bookingId}`,
            `Dispute ID: ${pkg.disputeId || 'Not linked'}`,
            `Receipt URL: ${files.receiptUrl || 'Not available'}`,
          ].join('\n'),
          { name: 'appendix/metadata.txt' }
        );

        archive.finalize();
      })
      .catch(reject);
  });
}

async function submitEvidenceToStripe(stripe, supabase, { disputeId, adminId }) {
  if (!stripe) {
    const err = new Error('Stripe is not configured.');
    err.statusCode = 503;
    throw err;
  }

  const { data: dispute, error } = await supabase.from('stripe_disputes').select('*').eq('id', disputeId).maybeSingle();
  if (error) throw error;
  if (!dispute?.stripe_dispute_id) {
    const err = new Error('Dispute not found.');
    err.statusCode = 404;
    throw err;
  }

  const pkg = await loadEvidencePackage(supabase, stripe, { disputeId });
  const uncategorizedText = String(pkg.summary || '').slice(0, 150000);

  const updated = await stripe.disputes.update(dispute.stripe_dispute_id, {
    evidence: {
      uncategorized_text: uncategorizedText,
    },
  });

  await recordEvidenceExport(supabase, {
    disputeId,
    bookingId: pkg.bookingId,
    adminId,
    format: 'stripe_submit',
    stripeSubmitted: true,
  });

  if (pkg.bookingId) {
    const bookingReliability = require('./bookingReliability');
    await bookingReliability.insertActivity(supabase, {
      booking_id: pkg.bookingId,
      event_type: 'stripe_dispute_evidence_submitted',
      actor_type: 'admin',
      actor_id: adminId,
      message: 'Stripe dispute evidence submitted from admin dashboard.',
      payload: { dispute_id: disputeId, stripe_dispute_id: dispute.stripe_dispute_id },
    });
  }

  return {
    ok: true,
    stripeDisputeId: dispute.stripe_dispute_id,
    status: updated.status,
    evidenceDueBy: updated.evidence_details?.due_by || null,
  };
}

module.exports = {
  buildActivityTimelinePdf,
  buildEvidencePackageFileName,
  buildEvidencePdf,
  buildEvidencePdfFileName,
  buildEvidenceZip,
  collectExportFiles,
  loadEvidencePackage,
  recordEvidenceExport,
  resolveLogoPath,
  submitEvidenceToStripe,
};

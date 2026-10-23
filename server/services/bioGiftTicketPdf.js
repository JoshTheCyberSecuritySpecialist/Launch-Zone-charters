/**
 * Bioluminescence gift ticket PDF + email delivery.
 * Visual direction mirrors the browser boarding-pass ticket (Phase 6/7).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { getBioluminescencePackage } = require('../config/bioluminescencePackages');
const giftCertificateService = require('./giftCertificateService');

const BIO_GIFT_KIND = 'bio_gift';
const TAGLINE = 'YOUR NIGHT ON THE GLOWING WATER AWAITS';
const QR_HINT = 'Scan to choose your adventure date';
const COORDINATES = '28.612 N  /  80.807 W';

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

function getPublicBaseUrl() {
  return String(process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'https://launchzonecharters.com')
    .trim()
    .replace(/\/$/, '');
}

function formatValidSeasonLabel(payload) {
  const year = Number(payload?.seasonYear) || 2027;
  const start = String(payload?.seasonStart || `${year}-06-01`);
  const end = String(payload?.seasonEnd || `${year}-10-31`);
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });
    return `${fmt.format(new Date(`${start}T12:00:00`))} – ${fmt.format(new Date(`${end}T12:00:00`))}`;
  } catch {
    return `June 1 – October 31, ${year}`;
  }
}

function guestLabelForPackage(packageId) {
  try {
    const pkg = getBioluminescencePackage(packageId);
    if (String(pkg.id) === 'bio_private') {
      return `Up to ${Number(pkg.maxGuests) || 5} guests · private boat`;
    }
    const n = Number(pkg.guestCount) || 1;
    return n === 1 ? '1 guest' : `${n} guests`;
  } catch {
    return '1 guest';
  }
}

function redeemUrlForCode(giftCode) {
  const code = String(giftCode || '')
    .trim()
    .toUpperCase();
  return `${getPublicBaseUrl()}/redeem/${encodeURIComponent(code)}`;
}

function safeFileName(value, fallback = 'gift-ticket') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function normalizePaidTickets(payload) {
  const tickets = Array.isArray(payload?.tickets) ? payload.tickets : [];
  if (tickets.length) {
    return tickets
      .map((ticket, index) => ({
        index: ticket.index || index + 1,
        code: String(ticket.code || '').trim().toUpperCase(),
        recipientName: ticket.recipientName || payload.recipientName || 'Guest',
        fromName: ticket.fromName || payload.fromName || 'Launch Zone Charters',
        giftMessage: ticket.giftMessage || null,
      }))
      .filter((t) => t.code);
  }
  const codes = Array.isArray(payload?.ticketCodes) ? payload.ticketCodes : [];
  return codes
    .map((code, index) => ({
      index: index + 1,
      code: String(code || '').trim().toUpperCase(),
      recipientName: payload.recipientName || 'Guest',
      fromName: payload.fromName || 'Launch Zone Charters',
      giftMessage: payload.giftMessage || null,
    }))
    .filter((t) => t.code);
}

async function loadPaidGiftPayload(supabase, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) {
    const err = new Error('sessionId is required');
    err.statusCode = 400;
    throw err;
  }

  // Prefer gift_certificates (Phase 8) when the migration is applied.
  const fromTable = await giftCertificateService.loadGiftCertificatesBySession(supabase, sid);
  if (!fromTable.tableMissing && fromTable.rows.length) {
    const payload = giftCertificateService.payloadFromGiftCertificateRows(fromTable.rows, sid);
    if (payload) return { sessionId: sid, payload, source: 'gift_certificates' };
  }

  const { data, error } = await supabase
    .from('checkout_drafts')
    .select('stripe_session_id, payload')
    .eq('stripe_session_id', sid)
    .maybeSingle();
  if (error) {
    const err = new Error(error.message || 'Could not load gift purchase');
    err.statusCode = 500;
    throw err;
  }
  const payload = data?.payload && typeof data.payload === 'object' ? data.payload : null;
  if (!payload || payload.kind !== BIO_GIFT_KIND) {
    const err = new Error('Gift purchase not found.');
    err.statusCode = 404;
    throw err;
  }
  if (payload.status !== 'paid') {
    const err = new Error('Gift tickets are only available after payment is confirmed.');
    err.statusCode = 402;
    throw err;
  }

  // Backfill table rows from draft if migration just landed.
  if (!fromTable.tableMissing) {
    await giftCertificateService.persistGiftCertificatesFromPaidPayload(supabase, payload, sid);
  }

  return { sessionId: sid, payload, source: 'checkout_drafts' };
}

function drawTicketPage(doc, ticket, payload, qrPng, logoPath, ticketCount) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 36;
  const cardX = margin;
  const cardY = margin;
  const cardW = pageW - margin * 2;
  const cardH = pageH - margin * 2;
  const stubW = 150;
  const mainW = cardW - stubW;

  // Night lagoon card
  doc.save();
  doc.roundedRect(cardX, cardY, cardW, cardH, 12).fill('#071018');

  // Soft cyan wash at bottom (glowing water suggestion)
  doc
    .fillColor('#22d3ee')
    .opacity(0.12)
    .ellipse(cardX + mainW * 0.5, cardY + cardH + 20, mainW * 0.55, 90)
    .fill();
  doc.opacity(1);

  // Main panel
  let y = cardY + 28;
  const left = cardX + 28;
  const contentW = mainW - 48;

  if (logoPath) {
    try {
      doc.image(logoPath, left, y, { fit: [150, 52] });
    } catch {
      /* ignore */
    }
  }

  doc
    .fillColor('#94a3b8')
    .font('Helvetica')
    .fontSize(8)
    .text(COORDINATES, left, y, { width: contentW, align: 'right' });

  y += 58;
  doc
    .fillColor('#a5f3fc')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('LAUNCH ZONE CHARTERS', left, y, { characterSpacing: 1.5 });

  y += 18;
  doc
    .fillColor('#67e8f9')
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`${Number(payload.seasonYear) || 2027} BIOLUMINESCENCE ADVENTURE`, left, y);

  y += 20;
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(TAGLINE, left, y, { width: contentW });

  if (ticketCount > 1) {
    y += 28;
    doc
      .fillColor('#fb923c')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`Ticket ${ticket.index} of ${ticketCount}`, left, y);
  }

  y += ticketCount > 1 ? 22 : 30;

  const fields = [
    ['GIFTED TO', ticket.recipientName],
    ['FROM', ticket.fromName],
    ['EXPERIENCE', payload.packageName || 'Bioluminescence Adventure'],
    ['GUESTS', guestLabelForPackage(payload.packageId)],
    ['VALID SEASON', formatValidSeasonLabel(payload)],
    ['GIFT TICKET', ticket.code],
  ];

  const colW = contentW / 2 - 8;
  for (let i = 0; i < fields.length; i += 2) {
    const rowY = y;
    const leftField = fields[i];
    const rightField = fields[i + 1];
    doc.fillColor('#67e8f9').font('Helvetica-Bold').fontSize(7).text(leftField[0], left, rowY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(leftField[1], left, rowY + 11, {
      width: colW,
    });
    if (rightField) {
      doc
        .fillColor('#67e8f9')
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(rightField[0], left + colW + 16, rowY);
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(rightField[1], left + colW + 16, rowY + 11, { width: colW });
    }
    y += 42;
  }

  if (ticket.giftMessage) {
    doc
      .fillColor('#cbd5e1')
      .font('Helvetica-Oblique')
      .fontSize(10)
      .text(`"${ticket.giftMessage}"`, left, y, { width: contentW });
    y += 36;
  }

  doc
    .fillColor('#94a3b8')
    .font('Helvetica')
    .fontSize(8)
    .text('Titusville · Florida Space Coast', left, Math.max(y, cardY + cardH - 70), {
      width: contentW,
    });
  doc.text('Dates subject to availability and weather conditions.', left, doc.y + 2, {
    width: contentW,
  });
  doc.fillColor('#67e8f9').text('launchzonecharters.com', left, doc.y + 2, { width: contentW });

  // Perforation stub
  const stubX = cardX + mainW;
  doc.save();
  doc.rect(stubX, cardY, stubW, cardH).fill('#050d16');
  doc.restore();

  // Dashed perforation
  doc
    .strokeColor('#67e8f9')
    .opacity(0.45)
    .lineWidth(1)
    .dash(4, { space: 4 })
    .moveTo(stubX, cardY + 12)
    .lineTo(stubX, cardY + cardH - 12)
    .stroke()
    .undash()
    .opacity(1);

  const stubCenterX = stubX + stubW / 2;
  doc
    .fillColor('#a5f3fc')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('BOARDING STUB', stubX + 10, cardY + 28, { width: stubW - 20, align: 'center' });

  if (qrPng) {
    const qrSize = 110;
    const qrX = stubCenterX - qrSize / 2;
    const qrY = cardY + 70;
    doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 6).fill('#e8f7ff');
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  }

  doc
    .fillColor('#ffffff')
    .font('Courier-Bold')
    .fontSize(9)
    .text(ticket.code, stubX + 8, cardY + cardH - 90, { width: stubW - 16, align: 'center' });
  doc
    .fillColor('#94a3b8')
    .font('Helvetica')
    .fontSize(7)
    .text(QR_HINT, stubX + 10, cardY + cardH - 68, { width: stubW - 20, align: 'center' });
}

async function buildGiftTicketsPdfBuffer(payload, options = {}) {
  const allTickets = normalizePaidTickets(payload);
  if (!allTickets.length) {
    const err = new Error('No gift tickets are available for this purchase.');
    err.statusCode = 404;
    throw err;
  }

  let tickets = allTickets;
  const codeFilter = String(options.ticketCode || '')
    .trim()
    .toUpperCase();
  if (codeFilter) {
    tickets = allTickets.filter((t) => t.code === codeFilter);
    if (!tickets.length) {
      const err = new Error('That gift ticket was not found on this purchase.');
      err.statusCode = 404;
      throw err;
    }
  }

  const logoPath = resolveLogoPath();
  const qrBuffers = await Promise.all(
    tickets.map((ticket) =>
      QRCode.toBuffer(redeemUrlForCode(ticket.code), {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 280,
        color: { dark: '#0B1220', light: '#E8F7FF' },
      })
    )
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 0,
      info: {
        Title: 'Launch Zone Charters — Bioluminescence Gift Ticket',
        Author: 'Launch Zone Charters',
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    tickets.forEach((ticket, index) => {
      if (index > 0) doc.addPage();
      drawTicketPage(doc, ticket, payload, qrBuffers[index], logoPath, allTickets.length);
    });

    doc.end();
  });
}

async function emailGiftTickets({
  resend,
  resendFrom,
  supabase,
  sessionId,
  source = 'manual',
}) {
  if (!resend || !resendFrom) {
    const err = new Error('Email is not configured right now.');
    err.statusCode = 503;
    throw err;
  }

  const { payload } = await loadPaidGiftPayload(supabase, sessionId);
  const to = String(payload?.purchaser?.email || '').trim().toLowerCase();
  if (!to) {
    const err = new Error('Purchaser email was not found for this gift purchase.');
    err.statusCode = 400;
    throw err;
  }

  const pdfBuffer = await buildGiftTicketsPdfBuffer(payload);
  const tickets = normalizePaidTickets(payload);
  const purchaserName = String(payload?.purchaser?.fullName || 'there').trim();
  const year = Number(payload?.seasonYear) || 2027;
  const filename = safeFileName(
    `LZC-${year}-bioluminescence-gift-tickets`,
    'bioluminescence-gift-tickets'
  );

  const codeLines = tickets.map(
    (t) =>
      `Ticket ${t.index}: ${t.code} — To: ${t.recipientName}${t.fromName ? ` · From: ${t.fromName}` : ''}`
  );

  const subject = `Your ${year} Bioluminescence gift ticket${tickets.length > 1 ? 's' : ''} — Launch Zone Charters`;
  const text = [
    `Hi ${purchaserName},`,
    '',
    'Thank you for giving the glow.',
    '',
    'Your bioluminescence gift ticket PDF is attached. Each ticket has its own code — no date is reserved until the recipient redeems.',
    '',
    `Experience: ${payload.packageName || 'Bioluminescence Adventure'}`,
    `Valid season: ${formatValidSeasonLabel(payload)}`,
    '',
    ...codeLines,
    '',
    'Scan the QR code (or visit the redeem link on the ticket) when they are ready to choose a June–October night.',
    '',
    '— Launch Zone Charters',
    'Titusville · Florida Space Coast',
    getPublicBaseUrl(),
    '',
    `(Email source: ${source})`,
  ].join('\n');

  await resend.emails.send({
    from: resendFrom,
    to,
    subject,
    text,
    attachments: [
      {
        filename: `${filename}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  const sentAt = new Date().toISOString();
  await giftCertificateService.markGiftCertificateEmailSent(supabase, sessionId, sentAt);

  const nextPayload = {
    ...payload,
    ticketEmailSentAt: sentAt,
    ticketEmailSentTo: to,
    ticketEmailSource: source,
  };
  await supabase.from('checkout_drafts').upsert(
    {
      stripe_session_id: sessionId,
      payload: nextPayload,
    },
    { onConflict: 'stripe_session_id' }
  );

  return {
    emailed: true,
    to,
    ticketCount: tickets.length,
  };
}

module.exports = {
  TAGLINE,
  loadPaidGiftPayload,
  buildGiftTicketsPdfBuffer,
  emailGiftTickets,
  normalizePaidTickets,
  safeFileName,
  redeemUrlForCode,
  formatValidSeasonLabel,
};

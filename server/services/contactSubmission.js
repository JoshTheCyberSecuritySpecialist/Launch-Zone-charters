/**
 * Contact form pipeline: validate → Supabase insert → admin notify (Resend).
 * Inserts into `contact_messages` (same table as the browser form). Optional SMS/CRM hooks later.
 */

/**
 * @param {unknown} body
 * @returns {{ name: string; email: string; message: string }}
 */
function parseContactBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  return { name, email, message };
}

/**
 * @param {{ name: string; email: string; message: string }} fields
 * @returns {{ error: string } | null}
 */
function validateContact(fields) {
  const { name, email, message } = fields;
  if (!name || name.length > 200) return { error: 'Invalid name' };
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Invalid email' };
  }
  if (!message || message.length > 10000) return { error: 'Invalid message' };
  return null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ name: string; email: string; message: string }} row
 * @returns {Promise<{ id?: string; error?: import('@supabase/supabase-js').PostgrestError | Error }>}
 */
async function insertContact(supabaseAdmin, row) {
  /** Aligned with public contact form (`contact_messages`) — single inbox for ops. */
  const { data, error } = await supabaseAdmin
    .from('contact_messages')
    .insert({
      full_name: row.name,
      email: row.email,
      message: row.message,
    })
    .select('id')
    .single();

  if (error) return { error };
  if (!data?.id) return { error: new Error('Missing contact id after insert') };
  return { id: data.id };
}

/**
 * Admin notification only. Failures are logged; callers should not treat as submission failure.
 * @param {object} opts
 * @param {import('resend').Resend | null} opts.resend
 * @param {string} opts.resendFrom
 * @param {string} opts.adminEmail
 * @param {string} opts.businessName
 * @param {string} opts.name
 * @param {string} opts.email
 * @param {string} opts.message
 */
async function notifyAdminEmail(opts) {
  const { resend, resendFrom, adminEmail, businessName, name, email, message } = opts;

  if (!resend) {
    console.warn('[contactSubmission] RESEND_API_KEY not set; admin email skipped');
    return;
  }
  if (!resendFrom) {
    console.warn('[contactSubmission] RESEND_FROM_EMAIL not set; admin email skipped');
    return;
  }
  if (!adminEmail) {
    console.warn('[contactSubmission] ADMIN_EMAIL not set; admin email skipped');
    return;
  }

  const subject = businessName
    ? `New Inquiry - ${businessName}`
    : 'New Inquiry';

  const textBody = `New contact submission received:

Name: ${name}
Email: ${email}

Message:
${message}`;

  try {
    const result = await resend.emails.send({
      from: resendFrom,
      to: adminEmail,
      subject,
      text: textBody,
    });
    if (result.error) {
      console.error('[contactSubmission] Resend error:', result.error);
    }
  } catch (err) {
    console.error('[contactSubmission] notifyAdminEmail failed:', err);
  }
}

module.exports = {
  parseContactBody,
  validateContact,
  insertContact,
  notifyAdminEmail,
};

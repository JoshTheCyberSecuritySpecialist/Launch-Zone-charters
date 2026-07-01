import { supabase } from './supabase';
import { env } from '../config/env.js';
import { requestBookingUploadUrl } from './publicBooking';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export function safeFileSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function uploadViaSignedUrl(signedUrl: string, file: File): Promise<Error | null> {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!res.ok) {
    return new Error('Upload to storage failed.');
  }
  return null;
}

/**
 * Upload via server-minted signed URL when booking context is available; otherwise direct anon upload (legacy).
 */
export async function uploadBookingDocument(input: {
  file: File;
  folder: 'licenses' | 'insurance';
  bookingId: string;
  email: string;
  phone?: string;
  sessionKey?: string;
}): Promise<{ url: string | null; error: Error | null }> {
  const { file, folder, bookingId, email, phone, sessionKey } = input;

  if (!file.size || file.size > MAX_BYTES) {
    return { url: null, error: new Error('File must be under 10 MB.') };
  }
  if (!ALLOWED.has(file.type)) {
    return {
      url: null,
      error: new Error('Allowed types: JPEG, PNG, WebP, GIF, PDF.'),
    };
  }

  if (env.apiUrlConfigured && env.apiUrl && email) {
    const prep = await requestBookingUploadUrl({
      bookingId,
      email,
      phone,
      folder,
      fileName: file.name,
    });
    if (prep.ok) {
      const upErr = await uploadViaSignedUrl(prep.signedUrl, file);
      if (upErr) return { url: null, error: upErr };
      if (prep.publicUrl) return { url: prep.publicUrl, error: null };
      return { url: null, error: new Error('Upload succeeded but URL is unavailable.') };
    }
  }

  return uploadDocumentToDocumentsBucket(file, folder, sessionKey || bookingId);
}

/**
 * Upload a license or insurance file to the `documents` bucket (public URLs).
 * Paths are scoped by session key so concurrent bookings do not collide.
 */
export async function uploadDocumentToDocumentsBucket(
  file: File,
  folder: 'licenses' | 'insurance',
  sessionKey: string
): Promise<{ url: string | null; error: Error | null }> {
  if (!file.size || file.size > MAX_BYTES) {
    return { url: null, error: new Error('File must be under 10 MB.') };
  }
  if (!ALLOWED.has(file.type)) {
    return {
      url: null,
      error: new Error('Allowed types: JPEG, PNG, WebP, GIF, PDF.'),
    };
  }

  const path = `${folder}/${sessionKey}/${Date.now()}-${safeFileSegment(file.name)}`;

  const { error } = await supabase.storage.from('documents').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    console.error('Upload error:', error);
    return { url: null, error: new Error(error.message || 'Upload failed') };
  }

  const { data } = supabase.storage.from('documents').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

/** For a future private bucket: short-lived link for viewing in admin. */
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Upload a Captain's Log hero image to the `captains-log` bucket (public URL).
 * Requires storage migration + lz_is_admin() policies on the bucket.
 */
export async function uploadCaptainsLogHeroImage(
  file: File
): Promise<{ url: string | null; error: Error | null }> {
  if (!file.size || file.size > MAX_BYTES) {
    return { url: null, error: new Error('Image must be under 10 MB.') };
  }
  if (!IMAGE_MIME.has(file.type)) {
    return { url: null, error: new Error('Use JPEG, PNG, WebP, or GIF.') };
  }

  const path = `hero/${Date.now()}-${safeFileSegment(file.name)}`;

  const { error } = await supabase.storage.from('captains-log').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    console.error('[uploadCaptainsLogHeroImage]', error);
    return {
      url: null,
      error: new Error(
        error.message ||
          'Upload failed. Ensure the captains-log bucket exists and your admin session can upload.'
      ),
    };
  }

  const { data } = supabase.storage.from('captains-log').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export async function createSignedDocumentUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<{ url: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return { url: null, error: new Error(error?.message || 'Could not sign URL') };
  }
  return { url: data.signedUrl, error: null };
}

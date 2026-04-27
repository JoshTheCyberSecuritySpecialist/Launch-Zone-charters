/**
 * Hourly check: PERFECT bio / sandbar / rocket conditions → notify opted-in subscribers (SMS + email).
 * Cooldown: last_notified_at must be older than 24 hours before sending again.
 */

const supabase = require('../supabaseClient');
const {
  evaluateAlertConditions,
  evaluateBioAlertConditions,
  evaluateSandbarAlertConditions,
} = require('../services/alertEngine');
const { sendSMS, sendEmail } = require('../services/notificationService');

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function publicSiteUrl() {
  const u =
    (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').trim() ||
    'https://launchzonecharters.com';
  return u.replace(/\/+$/, '');
}

function shouldNotify(lastNotifiedAt) {
  if (!lastNotifiedAt) return true;
  const t = new Date(lastNotifiedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t >= COOLDOWN_MS;
}

async function notifyTopic(subscribedTo, subjectLine, buildText) {
  console.log('[conditionMonitor] CHECKING CONDITIONS...');
  const { data: rows, error } = await supabase
    .from('alert_subscribers')
    .select('id, email, phone, last_notified_at')
    .eq('subscribed_to', subscribedTo);

  if (error) {
    console.error('[conditionMonitor] subscribers select error:', error.message);
    return;
  }

  const list = Array.isArray(rows) ? rows : [];
  console.log(`[conditionMonitor] subscribers (${subscribedTo}):`, list.length);
  console.log('[conditionMonitor] NOTIFYING USERS:', list.length);

  const bookUrl = `${publicSiteUrl()}/booking`;

  let delivered = 0;
  for (const row of list) {
    if (!shouldNotify(row.last_notified_at)) {
      console.log('[conditionMonitor] cooldown skip:', row.email || row.id);
      continue;
    }

    const body = buildText(bookUrl);
    let anySent = false;
    console.log('[conditionMonitor] SENDING TO:', row.email || row.id);

    if (row.phone) {
      const ok = await sendSMS(row.phone, body);
      if (ok) anySent = true;
    }
    if (row.email) {
      const ok = await sendEmail(row.email, subjectLine, body);
      if (ok) anySent = true;
    }

    if (anySent) {
      delivered += 1;
      const { error: upErr } = await supabase
        .from('alert_subscribers')
        .update({ last_notified_at: new Date().toISOString() })
        .eq('id', row.id);
      if (upErr) {
        console.error('[conditionMonitor] last_notified_at update failed:', upErr.message);
      } else {
        console.log('[conditionMonitor] last_notified_at set for', row.email || row.id);
      }
    }
  }
  console.log(`[conditionMonitor] delivered (${subscribedTo}):`, delivered);
}

async function logAlertActivity({ type, message, score }) {
  try {
    await supabase.from('alerts_log').insert({
      type,
      message,
      score: Number.isFinite(Number(score)) ? Number(score) : null,
    });
    console.log('ALERT LOGGED:', {
      alertType: type,
      message,
      score: Number.isFinite(Number(score)) ? Number(score) : null,
    });
  } catch (err) {
    console.warn('[conditionMonitor] alerts_log insert failed:', err?.message || err);
  }
}

async function runMonitor() {
  console.log('ALERT ENGINE STARTED');
  console.log('⏰ Running condition monitor…');

  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.warn('[conditionMonitor] Supabase not configured — abort');
    return;
  }

  try {
    const bio = await evaluateBioAlertConditions();
    console.log('CONDITIONS:', { alertType: 'bio', data: bio });
    if (!bio.ok) {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] bio alert engine skip:', bio.reason || 'unknown');
    } else if (bio.reason === 'no-new-data') {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] bio alert engine skip: no new data');
    } else if (bio.shouldAlert) {
      console.log('ALERT TRIGGERED:', 'bio');
      console.log('🔥 PERFECT BIO CONDITIONS — notifying subscribers');
      const { waterTemp, wind, cloudCover, moonPhase } = bio.unified || {};
      const bioMessage = `🌌 Bioluminescence conditions are perfect tonight.\nWater temp: ${waterTemp ?? 'n/a'}°F\nWind: ${wind ?? 'n/a'} mph\nCloud cover: ${cloudCover ?? 'n/a'}%\nMoon phase: ${moonPhase ?? 'n/a'}`;
      await logAlertActivity({
        type: 'bio',
        message: bioMessage,
        score: bio.score ?? null,
      });
      console.log('ALERT LOGGED SUCCESSFULLY');
      await notifyTopic(
        'bio',
        '🔥 Perfect night for bioluminescence — Launch Zone',
        (book) =>
          `${bioMessage}\n\nBook: ${book}\n\nLaunch Zone Charters — ${publicSiteUrl()}`
      );
    } else {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] bio alert threshold not met');
    }

    const sandbar = await evaluateSandbarAlertConditions();
    console.log('CONDITIONS:', { alertType: 'sandbar', data: sandbar });
    if (!sandbar.ok) {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] sandbar alert engine skip:', sandbar.reason || 'unknown');
    } else if (sandbar.reason === 'no-new-data') {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] sandbar alert engine skip: no new data');
    } else if (sandbar.shouldAlert) {
      console.log('ALERT TRIGGERED:', 'sandbar');
      const { wind, cloudCover, tideLevel, tidePhase, bestSandbarWindow } = sandbar.unified || {};
      const sandbarMessage = `🏝️ Ideal sandbar conditions today.\nTide level: ${tideLevel != null ? `${Math.round(tideLevel * 100) / 100} ft` : 'n/a'}\nTide phase: ${tidePhase ?? 'n/a'}\nWind: ${wind ?? 'n/a'} mph\nCloud cover: ${cloudCover ?? 'n/a'}%${
        bestSandbarWindow?.text ? `\nBest time to go: ${bestSandbarWindow.text}` : ''
      }`;
      await logAlertActivity({
        type: 'sandbar',
        message: sandbarMessage,
        score: sandbar.score ?? null,
      });
      console.log('ALERT LOGGED SUCCESSFULLY');
      await notifyTopic(
        'bio',
        '☀️ Perfect weekend sandbar day conditions — Launch Zone',
        (book) =>
          `${sandbarMessage}\n\nBook: ${book}\n\nLaunch Zone Charters — ${publicSiteUrl()}`
      );
    } else {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] sandbar alert threshold not met');
    }

    const alertEval = await evaluateAlertConditions();
    console.log('CONDITIONS:', { alertType: 'rocket', data: alertEval });
    if (!alertEval.ok) {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] alert engine skip:', alertEval.reason || 'unknown');
      return;
    }

    if (alertEval.reason === 'no-new-data') {
      console.log('NO ALERT: conditions not met');
      console.log('[conditionMonitor] alert engine skip: no new data');
      return;
    }

    if (alertEval.shouldAlert) {
      console.log('ALERT TRIGGERED:', 'rocket');
      const { wind, cloudCover, visibility, launchTonight } = alertEval.unified || {};
      const rocketMessage = `🚀 Rocket launch + perfect water conditions tonight.\nWind: ${wind ?? 'n/a'} mph\nCloud cover: ${cloudCover ?? 'n/a'}%\nVisibility: ${visibility ?? 'n/a'} mi\nLaunch tonight: ${launchTonight ? 'yes' : 'no'}`;
      await logAlertActivity({
        type: 'rocket',
        message: rocketMessage,
        score: alertEval.score ?? null,
      });
      console.log('ALERT LOGGED SUCCESSFULLY');
      console.log(
        '[conditionMonitor] alert threshold met:',
        `score=${alertEval.score}/${alertEval.threshold}`,
        `wind=${wind}`,
        `cloudCover=${cloudCover}`,
        `visibility=${visibility}`,
        `launchTonight=${launchTonight}`
      );
      await notifyTopic(
        'rocket',
        '🔥 Prime rocket viewing conditions — Launch Zone',
        (book) =>
          `${rocketMessage}\n\nBook: ${book}\n\nLaunch Zone Charters — ${publicSiteUrl()}`
      );
    } else {
      console.log('NO ALERT: conditions not met');
      console.log(
        '[conditionMonitor] alert threshold not met:',
        `score=${alertEval.score}/${alertEval.threshold}`
      );
    }
  } catch (err) {
    console.error('❌ conditionMonitor:', err?.message || err);
    if (err?.stack) console.error(err.stack);
  }
}

module.exports = {
  runMonitor,
  shouldNotify,
  COOLDOWN_MS,
};

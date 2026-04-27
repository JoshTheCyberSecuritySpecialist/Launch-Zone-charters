/**
 * Rocket launch viewing: weather scoring + Launch Library schedule + Ollama (advisory only).
 */

const { getWeather } = require('./weatherService');
const { runAI } = require('./aiService');
const { getLaunches } = require('./rocketScheduleService');

function scoreRocketViewing(wind, clouds) {
  let score = 0;
  if (wind < 5) score += 2;
  else if (wind < 12) score += 1;
  if (clouds < 30) score += 2;
  else if (clouds < 55) score += 1;
  if (wind < 10 && clouds < 40) score += 2;

  let status = 'poor';
  if (score >= 6) status = 'perfect';
  else if (score >= 4) status = 'good';

  return { score, status };
}

function buildRocketCopy(status, wind, clouds) {
  if (status === 'perfect') {
    return {
      message: 'Favorable conditions',
      explanation:
        'Calm wind and clearer skies — generally better for visibility from the water (still weather-dependent).',
    };
  }
  if (status === 'good') {
    return {
      message: 'Fair conditions',
      explanation:
        'Viewing may be workable; monitor wind and clouds as launch time approaches — forecasts change.',
    };
  }
  return {
    message: 'Challenging conditions',
    explanation: `Higher wind (${Math.round(wind * 10) / 10} mph) or cloud cover (${Math.round(clouds)}%) may limit visibility and comfort on deck.`,
  };
}

/**
 * Weather scoring only — no Launch Library or Ollama (for cron monitors).
 */
async function evaluateRocketViewing() {
  try {
    const data = await getWeather();
    const wind = typeof data.wind?.speed === 'number' ? data.wind.speed : 0;
    const clouds = typeof data.clouds?.all === 'number' ? data.clouds.all : 0;
    const { score, status } = scoreRocketViewing(wind, clouds);
    const { message, explanation } = buildRocketCopy(status, wind, clouds);
    return {
      success: true,
      score,
      status,
      message,
      explanation,
      wind,
      clouds,
    };
  } catch (err) {
    console.error('❌ evaluateRocketViewing:', err?.message || err);
    return {
      success: false,
      status: 'unknown',
      score: 0,
      message: 'Weather unavailable',
    };
  }
}

async function getRocketConditions() {
  let launches = [];
  try {
    launches = await getLaunches();
  } catch (e) {
    console.error('[rocketService] getLaunches unexpected:', e?.message || e);
    launches = [];
  }

  try {
    const evaluated = await evaluateRocketViewing();
    if (!evaluated.success) {
      return {
        success: false,
        score: 0,
        status: 'unknown',
        message: evaluated.message || 'Weather unavailable',
        explanation: 'Could not load OpenWeather data — check WEATHER_API_KEY.',
        data: {
          wind: undefined,
          clouds: undefined,
          launches,
        },
        aiSummary: 'Unable to analyze launch conditions',
        launches,
      };
    }

    const { wind, clouds, score, status, message, explanation } = evaluated;

    const launchLines = launches
      .slice(0, 5)
      .map((L, i) => {
        const name = L?.name || L?.mission || 'Mission';
        const net = L?.net || L?.window_start || 'TBD';
        return `${i + 1}. ${name} — ${net}`;
      })
      .join('\n');

    const aiSummary = await runAI(`
You are a rocket launch viewing expert.

Conditions:
Wind: ${wind} mph
Clouds: ${clouds}%
Score: ${score}/6
Status: ${status}

Upcoming launches (public schedule):
${launchLines || '(none returned)'}

Determine if this is a good day to watch a rocket launch from a boat.

Give:
1. GO or NO-GO
2. Visibility explanation
3. Safety warning
`);

    console.log('[rocketService] score=', score, 'status=', status, 'launches=', launches.length);

    return {
      success: true,
      score,
      status,
      message,
      explanation,
      data: {
        wind,
        clouds,
        launches,
      },
      aiSummary,
      wind,
      clouds,
      launches,
    };
  } catch (err) {
    console.error('❌ Rocket conditions error:', err?.message || err);
    if (err?.stack) console.error(err.stack);

    return {
      success: false,
      score: 0,
      status: 'unknown',
      message: 'Weather unavailable',
      explanation: 'Could not load OpenWeather data — check WEATHER_API_KEY.',
      data: {
        wind: undefined,
        clouds: undefined,
        launches,
      },
      aiSummary: 'Unable to analyze launch conditions',
      launches,
    };
  }
}

module.exports = {
  evaluateRocketViewing,
  getRocketConditions,
};

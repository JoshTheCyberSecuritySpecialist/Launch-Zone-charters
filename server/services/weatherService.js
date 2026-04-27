/**
 * Centralized OpenWeatherMap fetch for Titusville, FL (Indian River Lagoon).
 * Requires WEATHER_API_KEY in server/.env — never call from the frontend.
 */

const fetch = require('node-fetch');

/** Space Coast reference point (Titusville area). */
const DEFAULT_LAT = 28.6122;
const DEFAULT_LON = -80.8076;

/**
 * Current weather JSON from OpenWeatherMap One Call API 2.5 /weather.
 * @throws {Error} When API key missing, HTTP error, or invalid payload
 */
async function getWeather() {
  const apiKey = (process.env.WEATHER_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('WEATHER_API_KEY is not set');
    console.error('❌ weatherService:', err.message);
    throw err;
  }

  try {
    console.log('🌦 Fetching weather data...');

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${DEFAULT_LAT}&lon=${DEFAULT_LON}&appid=${apiKey}&units=imperial`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.error('❌ OpenWeather HTTP', res.status, data?.message || data);
      throw new Error(data?.message || `OpenWeather HTTP ${res.status}`);
    }

    if (data.cod != null && Number(data.cod) !== 200) {
      console.error('❌ OpenWeather API cod:', data.cod, data.message);
      throw new Error(data.message || `OpenWeather error cod=${data.cod}`);
    }

    console.log('✅ Weather data received');
    return data;
  } catch (err) {
    console.error('❌ Weather fetch error:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    throw err;
  }
}

/**
 * 5-day / 3-hour forecast (same coordinates). One call — use for weekly glow aggregation.
 * @throws {Error} When API key missing, HTTP error, or invalid payload
 */
async function getForecast5Day() {
  const apiKey = (process.env.WEATHER_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('WEATHER_API_KEY is not set');
    console.error('❌ weatherService getForecast5Day:', err.message);
    throw err;
  }

  try {
    console.log('🌦 Fetching 5-day forecast…');

    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${DEFAULT_LAT}&lon=${DEFAULT_LON}&appid=${apiKey}&units=imperial`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.error('❌ OpenWeather forecast HTTP', res.status, data?.message || data);
      throw new Error(data?.message || `OpenWeather forecast HTTP ${res.status}`);
    }

    if (data.cod != null && String(data.cod) !== '200') {
      console.error('❌ OpenWeather forecast cod:', data.cod, data.message);
      throw new Error(data.message || `OpenWeather forecast error cod=${data.cod}`);
    }

    if (!Array.isArray(data.list)) {
      throw new Error('OpenWeather forecast: missing list');
    }

    console.log('✅ Forecast list length=', data.list.length);
    return data;
  } catch (err) {
    console.error('❌ Forecast fetch error:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    throw err;
  }
}

module.exports = {
  getWeather,
  getForecast5Day,
  DEFAULT_LAT,
  DEFAULT_LON,
};

declare module 'suncalc' {
  const SunCalc: {
    getPosition(date: Date, latitude: number, longitude: number): { azimuth: number; altitude: number };
  };
  export default SunCalc;
}

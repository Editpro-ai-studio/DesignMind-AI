// Fashion season from the real clock. Never hardcode the year or season.
// Northern retail calendar: Spring/Summer = Feb–Jul, Autumn/Winter = Aug–Jan (January belongs to the previous AW).
const SOUTHERN = new Set([]); // add slugs of southern-hemisphere markets here

function seasonInfo(date = new Date(), south = false) {
  const m = date.getMonth(), y = date.getFullYear();
  const climN = ['Winter','Winter','Spring','Spring','Spring','Summer','Summer','Summer','Autumn','Autumn','Autumn','Winter'];
  const flip = { Winter: 'Summer', Summer: 'Winter', Spring: 'Autumn', Autumn: 'Spring' };
  const climate = south ? flip[climN[m]] : climN[m];
  let cur, curY, next, nextY;
  if (!south) {
    if (m >= 1 && m <= 6) { cur = 'SS'; curY = y; next = 'AW'; nextY = y; }
    else { cur = 'AW'; curY = m === 0 ? y - 1 : y; next = 'SS'; nextY = curY + 1; }
  } else {
    if (m >= 7 || m === 0) { cur = 'SS'; curY = m === 0 ? y - 1 : y; next = 'AW'; nextY = curY + 1; }
    else { cur = 'AW'; curY = y; next = 'SS'; nextY = y; }
  }
  const long = (s, yr) => `${s === 'SS' ? 'Spring/Summer' : 'Autumn/Winter'} ${yr}`;
  const yy = n => String(n).slice(-2);
  return {
    date: date.toISOString().slice(0, 10),
    climate,
    current: `${cur}${yy(curY)}`, currentLong: long(cur, curY),
    next: `${next}${yy(nextY)}`, nextLong: long(next, nextY),
  };
}

const forCountry = (slug, date) => seasonInfo(date, SOUTHERN.has(slug));

module.exports = { seasonInfo, forCountry };

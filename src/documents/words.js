// Amounts in words for receipts (Armenian and English).

const HY_ONES = ['', 'մեկ', 'երկու', 'երեք', 'չորս', 'հինգ', 'վեց', 'յոթ', 'ութ', 'ինը'];
const HY_TEENS = ['տասը', 'տասնմեկ', 'տասներկու', 'տասներեք', 'տասնչորս', 'տասնհինգ', 'տասնվեց', 'տասնյոթ', 'տասնութ', 'տասնինը'];
const HY_TENS = ['', '', 'քսան', 'երեսուն', 'քառասուն', 'հիսուն', 'վաթսուն', 'յոթանասուն', 'ութսուն', 'իննսուն'];

function hyBelow1000(n) {
  const out = [];
  const h = Math.floor(n / 100); const r = n % 100;
  if (h) out.push(h === 1 ? 'հարյուր' : `${HY_ONES[h]} հարյուր`);
  if (r >= 20) out.push(HY_TENS[Math.floor(r / 10)] + HY_ONES[r % 10]);
  else if (r >= 10) out.push(HY_TEENS[r - 10]);
  else if (r > 0) out.push(HY_ONES[r]);
  return out.join(' ');
}

export function numberHy(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'զրո';
  const parts = [];
  const bil = Math.floor(n / 1e9); const mil = Math.floor((n % 1e9) / 1e6);
  const th = Math.floor((n % 1e6) / 1000); const rest = n % 1000;
  if (bil) parts.push(`${hyBelow1000(bil)} միլիարդ`);
  if (mil) parts.push(`${hyBelow1000(mil)} միլիոն`);
  if (th) parts.push(th === 1 ? 'հազար' : `${hyBelow1000(th)} հազար`);
  if (rest) parts.push(hyBelow1000(rest));
  return parts.join(' ');
}

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enBelow1000(n) {
  const out = [];
  const h = Math.floor(n / 100); const r = n % 100;
  if (h) out.push(`${EN_ONES[h]} hundred`);
  if (r >= 20) out.push(EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ''));
  else if (r > 0) out.push(EN_ONES[r]);
  return out.join(' ');
}

export function numberEn(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zero';
  const parts = [];
  for (const [size, word] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    const g = Math.floor(n / size) % 1000;
    if (g) parts.push(`${enBelow1000(g)} ${word}`);
  }
  if (n % 1000) parts.push(enBelow1000(n % 1000));
  return parts.join(' ');
}

const cap = (s) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** 95000 -> "Իննսունհինգ հազար դրամ" */
export function amountInWords(amount, lang = 'hy') {
  const v = Math.round(amount || 0);
  if (lang === 'en') return cap(`${v < 0 ? 'minus ' : ''}${numberEn(v)} drams`);
  return cap(`${v < 0 ? 'մինուս ' : ''}${numberHy(v)} դրամ`);
}

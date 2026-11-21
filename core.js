// StudyDoc core - pure logic (no DOM). JS port of studydoc/local_engine.py, verify.py and the
// manual-prompt parts of engine.py. Shared test vectors (tests/vectors.json) are run against both.
import { TEXT_SYSTEM_PROMPT, NOT_FOUND } from './prompt.js';

export { NOT_FOUND };
export const MANUAL_BUDGET_TOKENS = 25000;
const CHARS_PER_TOKEN = 3.5;

// ----------------------------------------------------------------------------- text helpers
const AR_MARKS = /[\u064B-\u065F\u0670\u0640]/g;
const DIGIT_MAP = {};
[...'٠١٢٣٤٥٦٧٨٩'].forEach((c, i) => (DIGIT_MAP[c] = String(i)));
[...'۰۱۲۳۴۵۶۷۸۹'].forEach((c, i) => (DIGIT_MAP[c] = String(i)));
const TOKEN = /\d+(?:\.\d+)?|[\p{L}\p{N}]+/gu;
const NEG = /\b(?:not|no|never|cannot|without|neither|nor|none)\b|n't\b/g;
const NEG_STEM = /\b(?:not|except|false|incorrect|least)\b/i;

export const STOP = new Set(
  `a an and are as at be been being but by can could did do does done for from had has have having how
  i if in into is it its of on or our so such than that the their them then there these they this those to
  was were what when where which who whom whose why will with would you your he she his her we us me my
  about above after again all also am any because before below between both each few further here more most
  other over own same should some than too very just may might must shall upon via per
  true false yes no not one following statement choose select correct answer option options according document
  text pdf many much question questions given below above
  describe explain list define name summarize summarise state give identify compare outline
  في من على الى عن ما هو هي هذا هذه ذلك التي الذي ان كان كانت لا هل كل مع او ثم قد كم ماذا متى اين كيف لماذا`
    .split(/\s+/)
    .filter(Boolean)
);
const ABBR = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'no', 'fig', 'vs', 'etc', 'inc', 'ltd', 'corp', 'co', 'st',
  'approx', 'eq', 'sec', 'vol', 'al', 'e.g', 'i.e']);
const BOUNDARY = new RegExp(
  '(?<=[.!?\\u061F])\\s+(?=["\'\\u201c(\\[]?[A-Z0-9\\u0600-\\u06FF])' +
    '|\\n\\s*\\n' +
    '|\\n(?=\\s*(?:[\\u2022\\u25cf\\u25aa\\-\\u2013\\u2014*]|\\(?\\d{1,2}[.)]|\\(?[a-zA-Z][.)])\\s)',
  'g'
);

export function norm(text) {
  let t = text.normalize('NFKC').toLowerCase();
  t = t.replace(/[٠-٩۰-۹]/g, (c) => DIGIT_MAP[c]);
  t = t.replace(AR_MARKS, '');
  t = t.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[\u2019\u2018]/g, "'");
  return t.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
}

export function stem(w) {
  if (w.startsWith('ال') && w.length > 4) w = w.slice(2);
  if (w.length <= 3) return w;
  for (const [suf, rep] of [['ies', 'y'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      if (suf === 's' && w.endsWith('ss')) continue;
      w = w.slice(0, w.length - suf.length) + rep;
      break;
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const isNum = (tok) => /^\d/.test(tok);
const tokens = (t) => norm(t).match(TOKEN) || [];

export function termsOf(text) {
  const stems = new Set();
  const nums = new Set();
  for (const tok of tokens(text)) {
    if (isNum(tok)) nums.add(tok);
    else if (!STOP.has(tok) && [...tok].length >= 2) stems.add(stem(tok));
  }
  return [[...stems], [...nums]];
}

export function negCount(text) {
  return (norm(text).match(NEG) || []).length;
}

export function splitSentences(text) {
  const spans = [];
  let start = 0;
  const add = (a, b) => {
    const chunk = text.slice(a, b);
    const lead = chunk.length - chunk.trimStart().length;
    const trimmed = chunk.trim();
    if (trimmed.length >= 3) spans.push([a + lead, a + lead + trimmed.length]);
  };
  for (const m of text.matchAll(BOUNDARY)) {
    const end = m.index;
    if (text.slice(end - 1, end) === '.') {
      const prev = /([A-Za-z.]+)\.$/.exec(text.slice(start, end));
      if (prev) {
        const word = prev[1].toLowerCase().replace(/\.+$/, '');
        if (ABBR.has(word) || word.length === 1) continue;
      }
    }
    add(start, end);
    start = m.index + m[0].length;
  }
  add(start, text.length);
  return spans;
}

// ----------------------------------------------------------------------------- index
export class LocalIndex {
  constructor(docs) {
    this.docs = new Map(docs.map((d) => [d.id, d]));
    this.pageText = new Map();
    this.units = [];
    this.postings = new Map();
    for (const d of docs) {
      for (const p of d.pages) {
        this.pageText.set(d.id + '|' + p.page, p.text);
        const first = this.units.length;
        for (const [a, b] of splitSentences(p.text)) {
          const sent = p.text.slice(a, b);
          const [stems, nums] = termsOf(sent);
          const tf = new Map();
          for (const tok of tokens(sent)) tf.set(tok, (tf.get(tok) || 0) + 1);
          let len = 0;
          for (const n of tf.values()) len += n;
          const uid = this.units.length;
          this.units.push({
            doc: d.id, page: p.page, start: a, end: b, stems: new Set(stems), nums: new Set(nums),
            len: len || 1, neg: negCount(sent), words: sent.split(/\s+/).filter(Boolean).length,
            prev: uid > first ? uid - 1 : null, next: null,
          });
          if (uid > first) this.units[uid - 1].next = uid;
          for (const [tok, n] of tf) {
            const key = isNum(tok) ? tok : STOP.has(tok) ? null : stem(tok);
            if (key) {
              let list = this.postings.get(key);
              if (!list) this.postings.set(key, (list = []));
              list.push([uid, n]);
            }
          }
        }
      }
    }
    this.n = this.units.length || 1;
    let total = 0;
    for (const u of this.units) total += u.len;
    this.avgLen = total / this.n || 1;
    this.dfMap = new Map();
    for (const [k, list] of this.postings) this.dfMap.set(k, new Set(list.map((x) => x[0])).size);
  }

  df(term) {
    return this.dfMap.get(term) || 0;
  }

  search(terms, top = 8) {
    const scores = new Map();
    for (const t of terms) {
      const plist = this.postings.get(t);
      if (!plist) continue;
      const dft = this.df(t);
      const idf = Math.log(1 + (this.n - dft + 0.5) / (dft + 0.5));
      for (const [uid, f] of plist) {
        const ln = this.units[uid].len;
        scores.set(uid, (scores.get(uid) || 0) + (idf * f * 2.5) / (f + 1.5 * (0.25 + (0.75 * ln) / this.avgLen)));
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, top).map((x) => x[0]);
  }

  windows(uid) {
    const u = this.units[uid];
    const out = [[uid]];
    if (u.next !== null) out.push([uid, u.next]);
    if (u.prev !== null) out.push([u.prev, uid]);
    return out;
  }

  merge(ids) {
    const us = ids.map((i) => this.units[i]);
    const first = us[0];
    const last = us[us.length - 1];
    const text = this.pageText.get(first.doc + '|' + first.page).slice(first.start, last.end);
    const stems = new Set();
    const nums = new Set();
    let neg = 0;
    let words = 0;
    for (const u of us) {
      u.stems.forEach((s) => stems.add(s));
      u.nums.forEach((s) => nums.add(s));
      neg += u.neg;
      words += u.words;
    }
    return { doc: first.doc, page: first.page, text, stems, nums, neg, words, single: us.length === 1 };
  }

  evidence(w) {
    return { document: this.docs.get(w.doc).name, page: w.page, quote: w.text.trim() };
  }

  candidateGroups(terms, top = 8) {
    return this.search(terms, top).map((uid) => this.windows(uid).map((ids) => this.merge(ids)));
  }

  missingTerms(stems) {
    return stems.filter((s) => this.df(s) === 0);
  }
}

const cov = (terms, have) => (terms.length ? terms.filter((t) => have.has(t)).length / terms.length : 1.0);

// ----------------------------------------------------------------------------- question types
const OPT_MARK = /(?:(?<=\s)|^)\(?([A-Ha-h])[).:]\s*(?=\S)/g;
const OPEN_START = new Set(['what', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'which', 'describe',
  'explain', 'list', 'define', 'name', 'summarize', 'summarise', 'state', 'give', 'identify', 'compare', 'outline',
  'كم', 'ماذا', 'متى', 'اين', 'أين', 'كيف', 'لماذا', 'من', 'ما', 'اشرح', 'عرف', 'اذكر', 'حدد']);
const AUX_START = new Set(['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should',
  'has', 'have', 'had', 'هل']);

export function parseMc(text) {
  const marks = [...text.matchAll(OPT_MARK)].map((m) => ({ s: m.index, e: m.index + m[0].length, l: m[1] }));
  let best = [];
  marks.forEach((mk, i) => {
    if (mk.l.toUpperCase() !== 'A') return;
    const run = [mk];
    for (const nxt of marks.slice(i + 1)) {
      if (nxt.l.toUpperCase() === String.fromCharCode(run[run.length - 1].l.toUpperCase().charCodeAt(0) + 1)) run.push(nxt);
    }
    if (run.length > best.length) best = run;
  });
  if (best.length < 2) return null;
  const stemText = text.slice(0, best[0].s).trim();
  const opts = best.map((b, i) => {
    const end = i + 1 < best.length ? best[i + 1].s : text.length;
    return [b.l.toUpperCase(), text.slice(b.e, end).trim().replace(/[;,]+$/, '').trim()];
  });
  if (opts.some((o) => !o[1])) return null;
  return [stemText, opts];
}

export function detectType(text, hint) {
  if (['true_false', 'multiple_choice', 'open'].includes(hint)) return hint;
  if (parseMc(text)) return 'multiple_choice';
  const low = text.trim().toLowerCase().replace(/\u061f/g, '?');
  if (/true\s*(?:or|\/|-)\s*false|\bt\/f\b/.test(low)) return 'true_false';
  const words = low.match(/[a-z']+|[\u0600-\u06ff]+/g) || [];
  const first = words[0] || '';
  if (OPEN_START.has(first)) return 'open';
  if (AUX_START.has(first) && low.endsWith('?')) return 'true_false';
  if (!low.endsWith('?')) return 'true_false';
  return 'open';
}

// ----------------------------------------------------------------------------- answering
export function newAnswer(o) {
  return { question: '', qtype: 'open', status: 'found', text: '', evidence: [], unverified: [], reasoning: '',
    withdrawn: false, mode: 'full', pages_sent: 0, pages_total: 0, model: '', usage: {}, note: '', engine: '', ...o };
}
const notFound = (q, qtype, why) =>
  newAnswer({ question: q, qtype, status: 'not_found', text: NOT_FOUND, note: why, engine: 'local' });
const tolerance = (n) => (n <= 6 ? 0 : Math.max(1, Math.floor(n / 10)));
const allIn = (arr, set) => arr.every((x) => set.has(x));

function judge(index, statement) {
  const [K, N] = termsOf(statement);
  if (!K.length && !N.length) return ['none', [], 'no searchable words'];
  const miss = index.missingTerms(K);
  if (K.length && miss.length / K.length > 0.15) return ['none', [], `the document never mentions: ${miss.slice(0, 4).join(', ')}`];
  const sNeg = negCount(statement);
  const verdicts = [];
  for (const group of index.candidateGroups([...K, ...N])) {
    for (const w of group) {
      if (K.length - K.filter((t) => w.stems.has(t)).length > tolerance(K.length)) continue;
      if (allIn(N, w.nums)) {
        if (w.single) {
          if (w.neg > 0 === sNeg > 0) verdicts.push(['yes', w]);
          else if (w.neg <= 1 && w.words <= 35 && sNeg <= 1) verdicts.push(['no', w]);
        } else if (w.neg === 0 && sNeg === 0) verdicts.push(['yes', w]);
      } else if ([...w.nums].some((n) => !N.includes(n)) && N.some((n) => !w.nums.has(n))) {
        verdicts.push(['no', w]);
      }
      break;
    }
  }
  const kinds = new Set(verdicts.map((v) => v[0]));
  if (kinds.size === 1 && kinds.has('yes')) return ['yes', [verdicts[0][1]], 'a sentence contains every key term and number of the statement'];
  if (kinds.size === 1 && kinds.has('no')) return ['no', [verdicts[0][1]], 'a sentence about the same subject has a different number or the opposite polarity'];
  if (kinds.size) return ['none', [], 'the document contains conflicting passages'];
  return ['none', [], 'no sentence contains all the key terms of the statement'];
}

function support(index, stemTerms, optText) {
  const [Ko, No] = termsOf(optText);
  const full = [...Ko, ...No];
  if (!full.length) return [0.0, null];
  let best = [0.0, null];
  for (const group of index.candidateGroups([...full, ...stemTerms], 10)) {
    for (const w of group) {
      const have = new Set([...w.stems, ...w.nums]);
      const covO = cov(full, have);
      if (covO < (full.length <= 5 ? 1.0 : 0.85)) continue;
      const covS = cov(stemTerms, w.stems);
      if (covS < 0.5) continue;
      const score = 0.6 * covO + 0.4 * covS;
      if (score > best[0]) best = [score, w];
      break;
    }
  }
  return best;
}

function answerMc(index, q, stemText, opts) {
  const lowOpts = opts.map((o) => o[1].toLowerCase()).join(' ');
  if (/\b(all|none|both|neither) of the (above|these|following)\b/.test(lowOpts))
    return notFound(q, 'multiple_choice', "options like 'all/none of the above' need reasoning");
  const Ks = termsOf(stemText)[0].filter((k) => index.df(k) > 0);
  const negated = NEG_STEM.test(stemText);
  const multi = /all that apply|select all|choose all|which of the following are/i.test(stemText);
  const scored = opts.map(([l, t]) => [l, t, ...support(index, Ks, t)]);
  const supported = scored.filter((x) => x[3] !== null);
  if (negated) {
    if (supported.length === opts.length - 1 && opts.length >= 3) {
      const [l, t] = scored.find((x) => x[3] === null);
      return finish(index, q, 'multiple_choice', `${l}) ${t}`, supported.map((x) => index.evidence(x[3])),
        'every other option is stated in the document; this one is not');
    }
    return notFound(q, 'multiple_choice', 'could not match all the other options to the document');
  }
  if (!supported.length) return notFound(q, 'multiple_choice', 'no option is stated in the document');
  supported.sort((a, b) => b[2] - a[2]);
  let chosen;
  if (multi) chosen = supported;
  else if (supported.length === 1 || supported[0][2] - supported[1][2] >= 0.15) chosen = supported.slice(0, 1);
  else return notFound(q, 'multiple_choice', 'several options match equally well');
  const text = [...chosen].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => `${x[0]}) ${x[1]}`).join('; ');
  return finish(index, q, 'multiple_choice', text, chosen.map((x) => index.evidence(x[3])),
    'the chosen option appears in a sentence that also matches the question');
}

function idfCov(index, terms, have) {
  const idf = (t) => {
    const d = index.df(t);
    return Math.log(1 + (index.n - d + 0.5) / (d + 0.5));
  };
  const total = terms.reduce((a, t) => a + idf(t), 0);
  return total ? terms.filter((t) => have.has(t)).reduce((a, t) => a + idf(t), 0) / total : 0.0;
}

function answerOpen(index, q) {
  const [K, N] = termsOf(q);
  if (!K.length && !N.length) return notFound(q, 'open', 'no searchable words in the question');
  const miss = index.missingTerms(K);
  if (K.length && miss.length / K.length > 0.15) return notFound(q, 'open', `the document never mentions: ${miss.slice(0, 4).join(', ')}`);
  let best = [0.0, null];
  for (const group of index.candidateGroups([...K, ...N])) {
    for (const w of group) {
      const c = idfCov(index, K, w.stems);
      const plain = cov(K, w.stems);
      if (c >= 0.75 && plain >= 0.6 && allIn(N, w.nums)) {
        if (c > best[0]) best = [c, w];
        break;
      }
    }
  }
  if (!best[1]) return notFound(q, 'open', 'no sentence covers the key terms of the question');
  const w = best[1];
  return finish(index, q, 'open', w.text.replace(/\s+/g, ' ').trim(), [index.evidence(w)],
    'this is the sentence that best matches the question (quoted exactly)');
}

function finish(index, q, qtype, text, evidence, why) {
  const seen = new Set();
  const unique = evidence.filter((e) => {
    const k = `${e.document}|${e.page}|${e.quote}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const docs = [...index.docs.values()];
  const included = {};
  docs.forEach((d) => (included[d.id] = new Set(d.pages.map((p) => p.page))));
  const ok = verifyEvidence(unique, docs, included).filter((e) => e.verified);
  if (!ok.length) return notFound(q, qtype, 'internal check failed');
  const total = docs.reduce((a, d) => a + d.n_pages, 0);
  return newAnswer({ question: q, qtype, status: 'found', text, evidence: ok, reasoning: why, engine: 'local',
    mode: 'full', pages_sent: total, pages_total: total, model: 'offline' });
}

export function askLocal(index, question, hint = 'auto') {
  question = question.trim();
  const qtype = detectType(question, hint);
  const docs = [...index.docs.values()];
  const total = docs.reduce((a, d) => a + d.n_pages, 0);
  let ans;
  if (qtype === 'multiple_choice') {
    const parsed = parseMc(question);
    ans = parsed ? answerMc(index, question, parsed[0], parsed[1]) : notFound(question, qtype, 'no answer options (A, B, C...) were found in the question');
  } else if (qtype === 'true_false') {
    const [verdict, wins, why] = judge(index, question);
    ans = verdict === 'none' ? notFound(question, qtype, why)
      : finish(index, question, qtype, verdict === 'yes' ? 'Yes' : 'No', wins.map((w) => index.evidence(w)), why);
  } else ans = answerOpen(index, question);
  return Object.assign(ans, { mode: 'full', pages_sent: total, pages_total: total, model: 'offline' });
}

// ----------------------------------------------------------------------------- verification
const VT = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2212': '-', '\u00a0': ' ', '\u00ad': '' };
export function normalizeV(text) {
  let t = text.normalize('NFKC').replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2212\u00a0\u00ad]/g, (c) => VT[c]);
  t = t.replace(/-\s*\n\s*/g, '').toLowerCase().replace(/\s+/g, ' ');
  return t.trim();
}
const numsOf = (s) => (s.match(/\d[\d.,]*/g) || []).map((n) => n.replace(/^[.,]+|[.,]+$/g, ''));
const negsOf = (s) => (s.match(/[a-z']+/g) || []).filter((w) => ['not', 'no', 'never', 'cannot', 'without', 'neither', 'nor', 'none'].includes(w) || w.endsWith("n't")).length;

function lev(a, b, maxD) {
  if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxD) return maxD + 1;
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyMatch(needle, haystack) {
  if (needle.length < 20) return false;
  const words = haystack.split(' ');
  const m = needle.split(' ').length;
  const maxD = Math.floor(needle.length * 0.08);
  for (const size of [m, m - 1, m + 1]) {
    if (size < 1) continue;
    for (let i = 0; i + size <= words.length; i++) {
      const win = words.slice(i, i + size).join(' ');
      if (lev(needle, win, maxD) <= maxD) {
        // tiny character differences are tolerated; changed numbers / negations never are
        if (JSON.stringify(numsOf(needle)) === JSON.stringify(numsOf(win)) && negsOf(needle) === negsOf(win)) return true;
      }
    }
  }
  return false;
}

export function quoteInPage(quote, pageText) {
  const segs = quote.split(/\[\.\.\.\]|\[\u2026\]|\.\.\.|\u2026/).map((s) => s.trim()).filter((s) => normalizeV(s).length >= 3);
  if (!segs.length) return false;
  const hay = normalizeV(pageText);
  return segs.every((seg) => {
    const needle = normalizeV(seg);
    return hay.includes(needle) || fuzzyMatch(needle, hay);
  });
}

function matchDoc(name, docs) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return null;
  for (const d of docs) if (key === d.name.toLowerCase() || key === d.id.toLowerCase()) return d;
  for (const d of docs) if (d.name.toLowerCase().includes(key) || key.includes(d.name.toLowerCase())) return d;
  return null;
}

export function verifyEvidence(evidence, docs, included) {
  return evidence.map((item) => {
    const quote = String(item.quote ?? '').trim();
    const claimed = matchDoc(String(item.document ?? ''), docs);
    let page = parseInt(item.page, 10);
    if (Number.isNaN(page)) page = -1;
    const res = { document: claimed ? claimed.name : String(item.document ?? '?'), page, quote, verified: false, corrected: false };
    if (!quote) return res;
    const allowed = (d) => included[d.id] || new Set();
    if (claimed && allowed(claimed).has(page)) {
      const p = claimed.pages.find((x) => x.page === page);
      if (p && quoteInPage(quote, p.text)) { res.verified = true; return res; }
    }
    for (const d of claimed ? [claimed] : docs) {
      for (const p of d.pages) {
        if (allowed(d).has(p.page) && quoteInPage(quote, p.text)) {
          return Object.assign(res, { document: d.name, page: p.page, verified: true, corrected: true });
        }
      }
    }
    return res;
  });
}

// ----------------------------------------------------------------------------- manual Claude / any chat AI
export const estimateTokens = (text) => Math.floor(text.length / CHARS_PER_TOKEN) + 1;

export function selectPages(question, docs, budget) {
  const corpus = [];
  for (const d of docs) for (const p of d.pages) {
    const [stems, nums] = termsOf(p.text);
    const tf = new Map();
    for (const tok of tokens(p.text)) { const k = isNum(tok) ? tok : STOP.has(tok) ? null : stem(tok); if (k) tf.set(k, (tf.get(k) || 0) + 1); }
    corpus.push({ id: d.id, page: p.page, tf, len: [...tf.values()].reduce((a, b) => a + b, 0) || 1, cost: estimateTokens(p.text), stems, nums });
  }
  const [K, N] = termsOf(question);
  const q = [...K, ...N];
  if (!corpus.length || !q.length) return {};
  const n = corpus.length;
  const avg = corpus.reduce((a, c) => a + c.len, 0) / n || 1;
  const df = new Map();
  for (const c of corpus) for (const k of c.tf.keys()) df.set(k, (df.get(k) || 0) + 1);
  const scored = [];
  corpus.forEach((c, i) => {
    let s = 0;
    for (const t of q) {
      const f = c.tf.get(t);
      if (!f) continue;
      const d = df.get(t);
      s += Math.log(1 + (n - d + 0.5) / (d + 0.5)) * (f * 2.5) / (f + 1.5 * (0.25 + (0.75 * c.len) / avg));
    }
    if (s > 0) scored.push([s, i]);
  });
  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const chosen = new Set();
  let used = 0;
  const tryAdd = (i) => {
    if (chosen.has(i) || i < 0 || i >= n || used + corpus[i].cost > budget) return;
    chosen.add(i);
    used += corpus[i].cost;
  };
  const ranked = scored.map((x) => x[1]);
  for (const i of ranked) if (used + corpus[i].cost <= budget * 0.75) tryAdd(i);
  for (const i of ranked.slice(0, 12)) for (const nb of [i - 1, i + 1]) if (nb >= 0 && nb < n && corpus[nb].id === corpus[i].id) tryAdd(nb);
  const out = {};
  [...chosen].sort((a, b) => a - b).forEach((i) => (out[corpus[i].id] ||= []).push(corpus[i].page));
  return out;
}

export function buildContext(docs, question, budget) {
  const total = docs.reduce((a, d) => a + d.n_pages, 0);
  const tokensAll = docs.reduce((a, d) => a + Math.floor(d.n_chars / CHARS_PER_TOKEN) + 1, 0);
  let mode = 'full';
  let included = {};
  if (tokensAll <= budget) docs.forEach((d) => (included[d.id] = d.pages.map((p) => p.page)));
  else { mode = 'focused'; included = selectPages(question, docs, budget); }
  const parts = ['<documents>'];
  let sent = 0;
  for (const d of docs) {
    const pages = [...(included[d.id] || [])].sort((a, b) => a - b);
    if (!pages.length) continue;
    parts.push(`<document name="${d.name}" pages_in_file="${d.n_pages}" pages_shown="${pages.length}">`);
    const byNum = new Map(d.pages.map((p) => [p.page, p.text]));
    for (const n of pages) {
      parts.push(`=== [${d.name}] PAGE ${n} ===\n${byNum.get(n) || '[NO EXTRACTABLE TEXT ON THIS PAGE - possibly a scanned image]'}`);
      sent++;
    }
    parts.push('</document>');
  }
  parts.push('</documents>');
  return { context: parts.join('\n'), included, mode, sent, total };
}

export function buildPromptPackage(docs, question, hint = 'auto', budget = MANUAL_BUDGET_TOKENS) {
  question = question.trim();
  const { context, included, mode, sent, total } = buildContext(docs, question, budget);
  hint = ['true_false', 'multiple_choice', 'open'].includes(hint) ? hint : 'auto';
  const hintLine = hint === 'auto' ? 'Question type: detect it yourself.' : `Question type: ${hint} (use exactly this type).`;
  const user = `${context}\n\n${hintLine}\n\n<question>\n${question}\n</question>`;
  return { question, hint, system: TEXT_SYSTEM_PROMPT, user, prompt: `${TEXT_SYSTEM_PROMPT}\n\n${user}`, empty: sent === 0, mode, sent, total, included };
}

function extractObject(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function parseReplyJson(text) {
  for (const cand of [text, text.replace(/[\u201c\u201d]/g, '"')]) {
    for (let i = cand.indexOf('{'); i !== -1; i = cand.indexOf('{', i + 1)) {
      const raw = extractObject(cand, i);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && ('final_answer' in obj || 'status' in obj)) return obj;
      } catch { /* keep scanning */ }
    }
  }
  return null;
}

function normalizeTf(raw) {
  const v = raw.trim().replace(/\.+$/, '').toLowerCase();
  return ['yes', 'true'].includes(v) ? 'Yes' : ['no', 'false'].includes(v) ? 'No' : null;
}

export function postprocess(payload, docs, included, hint, base) {
  const incl = {};
  for (const [k, v] of Object.entries(included)) incl[k] = new Set(v);
  let qtype = hint !== 'auto' ? hint : String(payload.question_type || 'open');
  if (!['true_false', 'multiple_choice', 'open'].includes(qtype)) qtype = 'open';
  const raw = (payload.evidence || []).filter((e) => e && typeof e === 'object');
  const checked = verifyEvidence(raw, docs, incl);
  const verified = checked.filter((e) => e.verified);
  const unverified = checked.filter((e) => !e.verified);
  let text = String(payload.final_answer ?? '').trim();
  const ans = newAnswer({ ...base, qtype, status: 'found', text, evidence: verified, unverified, reasoning: String(payload.reasoning || '').trim() });
  const nf = (note = '', withdrawn = false) => Object.assign(ans, { status: 'not_found', text: NOT_FOUND, withdrawn, evidence: [], note });
  if (payload.status !== 'found' || !text || text.toLowerCase().replace(/\.+$/, '') === NOT_FOUND.toLowerCase().replace(/\.+$/, '')) return nf();
  if (!verified.length) return nf('The AI proposed an answer, but none of its supporting quotes could be found in the documents, so the answer was withdrawn.', true);
  if (qtype === 'true_false') {
    const t = normalizeTf(text);
    if (t === null) return nf('The answer was not a clear Yes/No and was withdrawn.', true);
    ans.text = t;
  }
  if (base.mode === 'focused') ans.note = `Large document set: the ${base.pages_sent} most relevant of ${base.pages_total} pages were included.`;
  return ans;
}

export function finishTextReply(replyText, docs, pkg, engineName, model = '') {
  const payload = parseReplyJson(replyText);
  if (!payload) throw new Error('JSON');
  const base = { question: pkg.question, mode: pkg.mode, pages_sent: pkg.sent, pages_total: pkg.total, model: model || engineName, engine: engineName };
  return postprocess(payload, docs, pkg.included, pkg.hint, base);
}

export function notFoundAnswer(pkg, engineName, note) {
  return newAnswer({ question: pkg.question, qtype: pkg.hint !== 'auto' ? pkg.hint : 'open', status: 'not_found', text: NOT_FOUND, note, mode: pkg.mode, pages_total: pkg.total, engine: engineName });
}

export function exportMarkdown(session) {
  const lines = [`# ${session.title}`, ''];
  for (const m of session.messages) {
    if (m.role === 'user') lines.push(`**Q:** ${m.content}`, '');
    else {
      lines.push(`**A:** ${m.answer.text}`, '');
      for (const e of m.answer.evidence || []) lines.push(`> ${e.quote}  \n> - *${e.document}, p. ${e.page}*`);
      if ((m.answer.evidence || []).length) lines.push('');
    }
  }
  return lines.join('\n');
}

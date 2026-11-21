// StudyDoc phone edition - UI. All data stays on the device (IndexedDB); no server, no account, no cost.
import {
  LocalIndex, askLocal, buildPromptPackage, finishTextReply, notFoundAnswer, exportMarkdown, NOT_FOUND,
} from './core.js';
import * as store from './store.js';
import { extractPdf, getPdfjs, hashBytes, PdfError } from './pdfread.js';
import { createBrowserOcr } from './ocr.js';

const T = {
  en: {
    tagline: 'Answers come only from your PDFs - with page numbers and exact quotes.',
    sessions: 'Study sessions', newSession: '➕ New session', rename: 'Rename', renamePrompt: 'Session name:',
    del: 'Delete', confirmDelete: 'Delete this session and its documents permanently?', qa: (n) => `${n} Q&A`,
    documents: 'Documents', addPdfs: '➕ Add PDF files', remove: 'Remove',
    reading: (n, t, name) => `Reading ${name} ... page ${n} of ${t}`,
    added: (name, p) => `Added "${name}" (${p} pages).`, duplicate: (name) => `"${name}" is already in this session.`,
    partly: (n) => `${n} page(s) have no readable text.`, pages: (n) => `${n} pages`,
    err_empty: 'The file is empty.', err_unreadable: 'The file could not be read (it may be damaged).',
    err_password: 'The file is password-protected. Remove the password and upload it again.',
    err_noText: 'The file has no extractable text (it looks scanned). Turn on OCR in the menu ☰ and add it again.',
    noDocs: 'No documents yet', noDocsHelp: 'Open the menu ☰ and add one or more PDF files.',
    placeholder: 'Ask a question, a True/False statement, or a multiple-choice question…', send: 'Send',
    type_auto: 'Auto', type_true_false: 'True / False', type_multiple_choice: 'Multiple choice', type_open: 'Open',
    engine: 'Answer engine', offline: 'Offline (free, on your phone)', manual: 'Claude manually (copy/paste, free)',
    helpOffline: 'Finds the sentence in your PDFs that answers and quotes it exactly. Rule-based, not AI, so it says "Not found in the document." when unsure.',
    helpManual: 'The app prepares a prompt; paste it into the free Claude chat, paste the reply back, and the app verifies every quote against your PDFs.',
    settings: 'Settings', manualBudget: 'Manual prompt size (thousand tokens)', export: 'Export chat', help: 'User guide',
    install: 'Install app', online: 'Online', offlineNow: 'Offline (the app still works)', ready: 'Ready to work offline.',
    lang: 'العربية', lbl_true_false: 'True / False', lbl_multiple_choice: 'Multiple choice', lbl_open: 'Answer', lbl_result: 'Result',
    evidence: 'Supporting evidence', verified: '✓ verified in PDF', corrected: '(page corrected)', page: 'page',
    caveat: 'Offline engine: it quotes the sentence it matched - always read the evidence.',
    nfHint: 'The offline engine only matches words written in the document. For questions needing deeper understanding, try "Claude manually".',
    withdrawn: 'The AI proposed an answer, but none of its quotes could be found in your documents, so the answer was withdrawn.',
    focused: (s, t) => `Large document set: the ${s} most relevant of ${t} pages were included.`,
    step1: 'Step 1 - copy this prompt and send it to Claude (free chat) as one message.', copy: '📋 Copy prompt', copied: 'Copied ✓',
    openClaude: 'Open Claude ↗', step2: "Step 2 - paste Claude's complete reply here. The app verifies every quote.",
    reply: 'Paste the reply here', verify: '✅ Verify and save', cancel: 'Cancel',
    errJson: 'No JSON answer found in the pasted text. Ask the AI to answer again using only the JSON format.',
    noKeyTerms: 'No page shares any key terms with this question.', thinking: 'Searching the documents...',
    pagesRead: (s, t) => `${s}/${t} pages read`, engineName: { local: 'Offline engine', manual: 'Claude (manual)' },
    newTitle: 'New study session', close: 'Close',
    ocrOn: 'Read scanned pages with OCR (free, slower)', ocrReading: (n, t, name) => `Scanned pages: OCR ${n} of ${t} in ${name} ... (this can take a while)`,
    ocrBadge: (n) => `📷 ${n} page(s) read by OCR`, ocrWarn: 'Some evidence comes from OCR (text recognised from an image) and may contain small errors - check it against the page.',
    cancelUpload: 'Cancel reading', err_cancelled: 'Cancelled.',
    err_noTextOcr: 'No readable text was found, even with OCR. The scan may be too faint or blurry.',
    err_ocrFailed: 'OCR could not start. Its files are downloaded the first time you are online - connect to the internet once and try again.',
  },
  ar: {
    tagline: 'الإجابات من ملفات PDF فقط - مع رقم الصفحة والاقتباس الحرفي.',
    sessions: 'جلسات الدراسة', newSession: '➕ جلسة جديدة', rename: 'إعادة تسمية', renamePrompt: 'اسم الجلسة:',
    del: 'حذف', confirmDelete: 'حذف هذه الجلسة مع مستنداتها نهائيًا؟', qa: (n) => `${n} سؤال`,
    documents: 'المستندات', addPdfs: '➕ إضافة ملفات PDF', remove: 'إزالة',
    reading: (n, t, name) => `جارٍ قراءة ${name} ... صفحة ${n} من ${t}`,
    added: (name, p) => `تمت إضافة «${name}» (${p} صفحة).`, duplicate: (name) => `«${name}» موجود بالفعل في هذه الجلسة.`,
    partly: (n) => `${n} صفحة بلا نص قابل للقراءة.`, pages: (n) => `${n} صفحة`,
    err_empty: 'الملف فارغ.', err_unreadable: 'تعذّرت قراءة الملف (قد يكون تالفًا).',
    err_password: 'الملف محمي بكلمة مرور. أزل كلمة المرور ثم أعد الرفع.',
    err_noText: 'لا يحتوي الملف على نص قابل للاستخراج (يبدو ممسوحًا ضوئيًا). فعّل OCR من القائمة ☰ ثم أضفه مرة أخرى.',
    noDocs: 'لا توجد مستندات بعد', noDocsHelp: 'افتح القائمة ☰ ثم أضف ملف PDF واحدًا أو أكثر.',
    placeholder: 'اكتب سؤالًا أو عبارة صح/خطأ أو سؤال اختيار من متعدد…', send: 'إرسال',
    type_auto: 'تلقائي', type_true_false: 'صح / خطأ', type_multiple_choice: 'اختيار من متعدد', type_open: 'مفتوح',
    engine: 'طريقة الإجابة', offline: 'بدون إنترنت (مجاني، على هاتفك)', manual: 'Claude يدويًا (نسخ ولصق، مجاني)',
    helpOffline: 'يبحث عن الجملة التي تجيب في ملفاتك ويقتبسها حرفيًا. يعمل بقواعد ثابتة وليس ذكاءً اصطناعيًا، لذلك يقول «Not found in the document.» عند الشك.',
    helpManual: 'يجهّز التطبيق طلبًا جاهزًا؛ الصقه في محادثة Claude المجانية ثم الصق الرد هنا، وسيتحقق التطبيق من كل اقتباس في ملفاتك.',
    settings: 'الإعدادات', manualBudget: 'حجم الطلب اليدوي (ألف رمز)', export: 'تصدير المحادثة', help: 'دليل الاستخدام',
    install: 'تثبيت التطبيق', online: 'متصل', offlineNow: 'غير متصل (التطبيق يعمل)', ready: 'التطبيق جاهز للعمل بدون إنترنت.',
    lang: 'English', lbl_true_false: 'صح / خطأ', lbl_multiple_choice: 'اختيار من متعدد', lbl_open: 'الإجابة', lbl_result: 'النتيجة',
    evidence: 'الدليل من الملف', verified: '✓ تم التحقق في الملف', corrected: '(صُحّح رقم الصفحة)', page: 'صفحة',
    caveat: 'المحرك المحلي يقتبس الجملة المطابقة - راجع الدليل دائمًا.',
    nfHint: 'المحرك المحلي يطابق الكلمات المكتوبة في الملف فقط. للأسئلة التي تحتاج فهمًا أعمق جرّب «Claude يدويًا».',
    withdrawn: 'اقترح الذكاء الاصطناعي إجابة لكن لم يُعثر على أي من اقتباساته في ملفاتك، لذلك أُلغيت الإجابة.',
    focused: (s, t) => `مجموعة مستندات كبيرة: أُدرجت ${s} من ${t} صفحة (الأكثر صلة).`,
    step1: 'الخطوة 1: انسخ هذا الطلب وأرسله إلى Claude (المحادثة المجانية) كرسالة واحدة.', copy: '📋 نسخ الطلب', copied: 'تم النسخ ✓',
    openClaude: 'فتح Claude ↗', step2: 'الخطوة 2: الصق رد Claude كاملًا هنا. سيتحقق التطبيق من كل اقتباس.',
    reply: 'الصق الرد هنا', verify: '✅ تحقق واحفظ', cancel: 'إلغاء',
    errJson: 'لم أجد إجابة بصيغة JSON في النص الملصق. اطلب من الذكاء الاصطناعي إعادة الإجابة بصيغة JSON فقط.',
    noKeyTerms: 'لا توجد صفحة تشترك مع السؤال في أي كلمة مهمة.', thinking: 'جارٍ البحث في المستندات...',
    pagesRead: (s, t) => `${s}/${t} صفحة`, engineName: { local: 'المحرك المحلي', manual: 'Claude (يدوي)' },
    newTitle: 'جلسة دراسة جديدة', close: 'إغلاق',
    ocrOn: 'قراءة الصفحات الممسوحة ضوئيًا بتقنية OCR (مجاني، أبطأ)', ocrReading: (n, t, name) => `صفحات ممسوحة: OCR ${n} من ${t} في ${name} ... (قد يستغرق وقتًا)`,
    ocrBadge: (n) => `📷 ${n} صفحة قُرئت بتقنية OCR`, ocrWarn: 'بعض الأدلة مصدرها OCR (نص مستخرج من صورة) وقد يحتوي أخطاء صغيرة - قارنه بالصفحة.',
    cancelUpload: 'إلغاء القراءة', err_cancelled: 'أُلغيت العملية.',
    err_noTextOcr: 'لم يُعثر على نص مقروء حتى مع OCR. قد تكون الصورة باهتة أو غير واضحة.',
    err_ocrFailed: 'تعذّر تشغيل OCR. تُحمَّل ملفاته أول مرة عند الاتصال بالإنترنت - اتصل بالإنترنت مرة واحدة وأعد المحاولة.',
  },
};

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

async function readBuffer(file) {
  if (file.arrayBuffer) return file.arrayBuffer();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
}

export async function start(deps = {}) {
  const root = document.getElementById('app');
  const ls = (() => { try { return window.localStorage; } catch { return null; } })();
  const S = {
    lang: (ls && ls.getItem('sd_lang')) || ((navigator.language || 'en').startsWith('ar') ? 'ar' : 'en'),
    engine: (ls && ls.getItem('sd_engine')) || 'offline',
    manualK: Number((ls && ls.getItem('sd_manualk')) || 25), qtype: 'auto', ocr: !(ls && ls.getItem('sd_ocr') === '0'), signal: null,
    session: null, sessions: [], docs: [], drawer: false, pending: null, flash: [], progress: '',
    draft: '', reply: '', replyError: '', copied: false, busy: false, index: null, indexKey: '',
    online: navigator.onLine !== false, installEvt: null, scrollBottom: true,
  };
  const t = (k, ...a) => { const v = T[S.lang][k]; return typeof v === 'function' ? v(...a) : v; };
  const pdfjs = () => deps.pdfjs || getPdfjs();

  async function loadAll(sessionId) {
    S.sessions = await store.listSessions();
    let s = sessionId ? await store.loadSession(sessionId) : null;
    if (!s) s = S.sessions.length ? await store.loadSession(S.sessions[0].id) : null;
    if (!s) { s = await store.createSession(T[S.lang].newTitle); s.untitled = true; await store.saveSession(s); }
    S.session = s;
    S.docs = await store.loadDocuments(s);
    S.sessions = await store.listSessions();
    S.pending = null; S.reply = ''; S.replyError = '';
  }
  function getIndex() {
    const key = S.session.id + ':' + S.docs.map((d) => d.id).join(',');
    if (S.indexKey !== key) { S.index = S.docs.length ? new LocalIndex(S.docs) : null; S.indexKey = key; }
    return S.index;
  }

  // ------------------------------------------------------------------ actions
  async function saveExchange(question, answer) {
    const now = Date.now();
    S.session.messages.push({ role: 'user', content: question, ts: now }, { role: 'assistant', answer, ts: now });
    if (S.session.untitled) { S.session.title = question.replace(/\s+/g, ' ').trim().slice(0, 48); S.session.untitled = false; }
    await store.saveSession(S.session);
    S.sessions = await store.listSessions();
    S.scrollBottom = true;
  }
  async function send() {
    const q = S.draft.trim();
    if (!q || !S.docs.length || S.pending) return;
    S.draft = '';
    if (S.engine === 'manual') {
      const pkg = buildPromptPackage(S.docs, q, S.qtype, S.manualK * 1000);
      if (pkg.empty) await saveExchange(q, notFoundAnswer(pkg, 'manual', t('noKeyTerms')));
      else { S.pending = { pkg }; S.reply = ''; S.replyError = ''; S.copied = false; }
    } else {
      S.busy = true; render();
      await new Promise((r) => setTimeout(r, 0));
      await saveExchange(q, askLocal(getIndex(), q, S.qtype));
      S.busy = false;
    }
    render();
  }
  async function verifyReply() {
    try {
      const answer = finishTextReply(S.reply, S.docs, S.pending.pkg, 'manual', 'claude (manual)');
      const q = S.pending.pkg.question;
      S.pending = null; S.reply = '';
      await saveExchange(q, answer);
    } catch (e) {
      S.replyError = t('errJson');
    }
    render();
  }
  async function copyPrompt() {
    const text = S.pending.pkg.prompt;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.querySelector('#promptbox'); ta.select(); document.execCommand && document.execCommand('copy');
    }
    S.copied = true; render();
  }
  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    S.busy = true;
    const session = S.session; // keep adding to the session the files were chosen in, even if the user switches
    const known = new Set(S.docs.map((d) => d.sha1));
    for (const f of files) {
      try {
        const buf = await readBuffer(f);
        const sha = await hashBytes(buf);
        if (known.has(sha)) { S.flash.push(['info', t('duplicate', f.name)]); continue; }
        S.signal = { cancelled: false };
        const doc = await extractPdf(buf, f.name, await pdfjs(), (n, total) => { S.progress = t('reading', n, total, f.name); if (n % 5 === 0 || n === total) render(); }, {
          ocr: S.ocr ? (deps.ocr || createBrowserOcr) : null, signal: S.signal,
          onOcr: (k, total) => { S.progress = t('ocrReading', k, total, f.name); render(); },
        });
        const names = (await store.loadDocuments(session)).map((d) => d.name);
        await store.addDocument(session, doc, names);
        if (S.session.id === session.id) S.docs.push(doc);
        known.add(doc.sha1);
        let msg = t('added', doc.name, doc.n_pages);
        if (doc.unreadable_pages.length) msg += ' ' + t('partly', doc.unreadable_pages.length);
        S.flash.push(['ok', msg]);
      } catch (e) {
        S.flash.push(['err', e instanceof PdfError ? `${f.name}: ${t('err_' + e.code)}` : `${f.name}: ${t('err_unreadable')}`]);
      }
    }
    S.sessions = await store.listSessions();
    S.progress = ''; S.busy = false; S.signal = null;
    getIndex(); render();
  }
  async function removeDoc(id) { await store.removeDocument(S.session, id); S.docs = S.docs.filter((d) => d.id !== id); S.sessions = await store.listSessions(); render(); }
  async function switchSession(id) { await loadAll(id); S.drawer = false; render(); }
  async function newSession() { const s = await store.createSession(T[S.lang].newTitle); s.untitled = true; await store.saveSession(s); await loadAll(s.id); S.drawer = false; render(); }
  async function renameSession() {
    const name = (deps.prompt || window.prompt)(t('renamePrompt'), S.session.title);
    if (name && name.trim()) { S.session.title = name.trim(); S.session.untitled = false; await store.saveSession(S.session); S.sessions = await store.listSessions(); render(); }
  }
  async function deleteSession() {
    if (!(deps.confirm || window.confirm)(t('confirmDelete'))) return;
    await store.deleteSession(S.session.id); await loadAll(null); render();
  }
  function exportChat() {
    const blob = new Blob([exportMarkdown(S.session)], { type: 'text/markdown' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${S.session.title}.md` });
    document.body.append(a); a.click(); a.remove();
  }
  const setLang = (l) => { S.lang = l; ls && ls.setItem('sd_lang', l); render(); };
  const setEngine = (e) => { S.engine = e; ls && ls.setItem('sd_engine', e); render(); };

  // ------------------------------------------------------------------ views
  function answerCard(a) {
    const cls = a.status === 'not_found' ? 'nf' : a.qtype === 'true_false' ? (a.text === 'Yes' ? 'yes' : 'no') : 'ok';
    const label = a.status === 'not_found' ? t('lbl_result') : t('lbl_' + a.qtype) || t('lbl_open');
    const kids = [h('div', { class: `sd-answer ${cls}` }, h('div', { class: 'lbl' }, label), h('div', { class: 'txt', dir: 'auto' }, a.text))];
    if (a.withdrawn) kids.push(h('div', { class: 'note warn' }, t('withdrawn')));
    else if (a.mode === 'focused' && a.status === 'found') kids.push(h('div', { class: 'note' }, t('focused', a.pages_sent, a.pages_total)));
    if (a.status === 'not_found' && a.engine === 'local') kids.push(h('div', { class: 'note' }, t('nfHint')));
    if (a.evidence && a.evidence.length) {
      kids.push(h('div', { class: 'ev-title' }, t('evidence')));
      for (const e of a.evidence) {
        kids.push(h('div', { class: 'sd-ev' },
          h('div', { class: 'src' }, `📄 ${e.document} · ${t('page')} ${e.page}`, h('span', { class: 'ok' }, ' ' + t('verified') + (e.corrected ? ' ' + t('corrected') : ''))),
          h('div', { class: 'q', dir: 'auto' }, `“${e.quote}”`)));
      }
    }
    if (a.engine === 'local' && a.status === 'found') kids.push(h('div', { class: 'note' }, t('caveat')));
    if ((a.evidence || []).some((e) => { const d = S.docs.find((x) => x.name === e.document); return d && (d.ocr_pages || []).includes(e.page); })) kids.push(h('div', { class: 'note warn', 'data-ocr': '1' }, t('ocrWarn')));
    if (a.reasoning && a.status === 'found' && a.engine !== 'local') kids.push(h('details', {}, h('summary', {}, '…'), h('div', { class: 'note', dir: 'auto' }, a.reasoning)));
    kids.push(h('div', { class: 'meta' }, `${t('pagesRead', a.pages_sent, a.pages_total)} · ${t('engineName')[a.engine] || a.model}`));
    return h('div', { class: 'msg assistant' }, kids);
  }

  function drawerView() {
    const sess = S.sessions.map((s) => h('button', { class: 'sess' + (s.id === S.session.id ? ' on' : ''), onClick: () => switchSession(s.id) },
      h('span', { class: 'st', dir: 'auto' }, s.title), h('span', { class: 'sc' }, `${t('qa', Math.floor(s.n_messages / 2))} · ${s.n_docs} 📄`)));
    const input = h('input', { type: 'file', id: 'pdfinput', accept: 'application/pdf,.pdf', multiple: true, hidden: true, onChange: (e) => { addFiles(e.target.files); e.target.value = ''; } });
    const docs = S.docs.map((d) => h('div', { class: 'doc' },
      h('div', { class: 'dn' }, h('b', { dir: 'auto' }, d.name), h('small', {}, t('pages', d.n_pages) + (d.unreadable_pages.length ? ' · ⚠️ ' + t('partly', d.unreadable_pages.length) : '') + ((d.ocr_pages || []).length ? ' · ' + t('ocrBadge', d.ocr_pages.length) : ''))),
      h('button', { class: 'x', 'aria-label': t('remove'), onClick: () => removeDoc(d.id) }, '✕')));
    return h('aside', { class: 'drawer' + (S.drawer ? ' open' : ''), id: 'drawer' },
      h('div', { class: 'dhead' }, h('b', {}, '📚 StudyDoc'), h('button', { class: 'x', id: 'closedrawer', 'aria-label': t('close'), onClick: () => { S.drawer = false; render(); } }, '✕')),
      h('p', { class: 'small' }, t('tagline')),
      h('h3', {}, t('sessions')), h('button', { class: 'btn primary', id: 'newsession', onClick: newSession }, t('newSession')), ...sess,
      h('div', { class: 'row' }, h('button', { class: 'btn', id: 'renamebtn', onClick: renameSession }, '✎ ' + t('rename')), h('button', { class: 'btn danger', id: 'deletebtn', onClick: deleteSession }, '🗑 ' + t('del'))),
      h('h3', {}, t('documents')), input,
      h('label', { class: 'btn primary', for: 'pdfinput', id: 'addpdfs', role: 'button' }, t('addPdfs')),
      h('label', { class: 'radio small' }, h('input', { type: 'checkbox', id: 'ocrtoggle', checked: S.ocr, onChange: (e) => { S.ocr = e.target.checked; ls && ls.setItem('sd_ocr', S.ocr ? '1' : '0'); } }), ' ' + t('ocrOn')),
      S.progress && h('div', { class: 'note', id: 'progress' }, S.progress),
      S.signal && h('button', { class: 'btn danger', id: 'cancelupload', onClick: () => { S.signal.cancelled = true; } }, t('cancelUpload')),
      ...docs,
      h('h3', {}, t('engine')),
      ...['offline', 'manual'].map((e) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'eng', value: e, checked: S.engine === e, onChange: () => setEngine(e) }), ' ' + t(e))),
      h('p', { class: 'small' }, S.engine === 'offline' ? t('helpOffline') : t('helpManual')),
      S.engine === 'manual' && h('label', { class: 'small' }, t('manualBudget') + ' ', h('input', { type: 'number', min: 5, max: 200, step: 5, id: 'manualk', value: S.manualK, onChange: (e) => { S.manualK = Math.max(5, Number(e.target.value) || 25); ls && ls.setItem('sd_manualk', S.manualK); } })),
      h('div', { class: 'row' },
        S.session.messages.length ? h('button', { class: 'btn', id: 'exportbtn', onClick: exportChat }, '⬇️ ' + t('export')) : null,
        h('a', { class: 'btn', href: './help-ar.html', target: '_blank', rel: 'noopener' }, '📖 ' + t('help'))),
      S.installEvt && h('button', { class: 'btn primary', id: 'installbtn', onClick: async () => { S.installEvt.prompt(); S.installEvt = null; render(); } }, '📲 ' + t('install')),
      h('div', { class: 'small', id: 'netstate' }, S.online ? '🟢 ' + t('online') : '🟠 ' + t('offlineNow')));
  }

  function pendingView() {
    const p = S.pending.pkg;
    return h('div', { class: 'msg assistant pending', id: 'pending' },
      h('div', { class: 'q-echo', dir: 'auto' }, p.question),
      h('p', {}, t('step1')),
      h('textarea', { id: 'promptbox', readonly: true, rows: 5, dir: 'auto', value: p.prompt }),
      h('div', { class: 'row' }, h('button', { class: 'btn', id: 'copybtn', onClick: copyPrompt }, S.copied ? t('copied') : t('copy')),
        h('a', { class: 'btn', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener', id: 'openclaude' }, t('openClaude'))),
      h('p', {}, t('step2')),
      h('textarea', { id: 'replybox', rows: 5, dir: 'auto', placeholder: t('reply'), value: S.reply, onInput: (e) => { S.reply = e.target.value; } }),
      S.replyError && h('div', { class: 'note warn', id: 'replyerr' }, S.replyError),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'verifybtn', onClick: verifyReply }, t('verify')),
        h('button', { class: 'btn', id: 'cancelbtn', onClick: () => { S.pending = null; render(); } }, t('cancel'))));
  }

  function render() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    const msgs = S.session.messages.map((m) => m.role === 'user' ? h('div', { class: 'msg user', dir: 'auto' }, m.content) : answerCard(m.answer));
    const main = h('main', { id: 'chat' },
      !S.docs.length && h('div', { class: 'sd-empty' }, h('b', {}, t('noDocs')), h('br'), t('noDocsHelp')),
      S.docs.length ? h('div', { class: 'chips' }, S.docs.map((d) => h('span', { class: 'chip', dir: 'auto' }, `📄 ${d.name} · ${d.n_pages}`))) : null,
      ...S.flash.splice(0).map(([k, m]) => h('div', { class: `flash ${k}` }, m)),
      ...msgs, S.pending && pendingView(),
      S.busy && !S.progress && h('div', { class: 'note' }, t('thinking')));
    const types = ['auto', 'true_false', 'multiple_choice', 'open'].map((k) => h('button', { class: 'pill' + (S.qtype === k ? ' on' : ''), 'data-type': k, onClick: () => { S.qtype = k; render(); } }, t('type_' + k)));
    const ta = h('textarea', { id: 'composer', rows: 1, dir: 'auto', placeholder: t('placeholder'), value: S.draft, disabled: !S.docs.length || !!S.pending,
      onInput: (e) => { S.draft = e.target.value; e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; },
      onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && e.ctrlKey) { e.preventDefault(); send(); } } });
    root.replaceChildren(
      h('header', { class: 'top' },
        h('button', { class: 'icon', id: 'menubtn', 'aria-label': 'menu', onClick: () => { S.drawer = true; render(); } }, '☰'),
        h('h1', { dir: 'auto' }, S.session.title),
        h('button', { class: 'icon lang', id: 'langbtn', onClick: () => setLang(S.lang === 'ar' ? 'en' : 'ar') }, t('lang'))),
      h('div', { class: 'overlay' + (S.drawer ? ' show' : ''), onClick: () => { S.drawer = false; render(); } }),
      drawerView(), main,
      h('footer', { class: 'composer' }, h('div', { class: 'pills' }, types),
        h('div', { class: 'cbox' }, ta, h('button', { class: 'send', id: 'sendbtn', disabled: !S.docs.length || !!S.pending, onClick: send }, t('send')))));
    if (S.scrollBottom) { const c = document.getElementById('chat'); if (c) c.scrollTop = c.scrollHeight; window.scrollTo && window.scrollTo(0, document.body.scrollHeight); S.scrollBottom = false; }
  }

  window.addEventListener('online', () => { S.online = true; render(); });
  window.addEventListener('offline', () => { S.online = false; render(); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; render(); });
  if (!deps.noServiceWorker && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  await loadAll(null);
  render();
  return { S, send, render, addFiles, t };
}
export { NOT_FOUND };

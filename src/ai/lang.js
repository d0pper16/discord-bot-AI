'use strict';

/**
 * Language detection sederhana berbasis stopwords + tabel terjemahan
 * untuk semua pesan boilerplate bot. Tidak butuh library eksternal.
 *
 * Kebijakan deteksi (req. user):
 *   - Default: bahasa Indonesia.
 *   - Hanya translate kalau MAYORITAS pertanyaan dalam bahasa lain
 *     (mis. inggris, portugis). Bahasa Indonesia diberi "benefit of
 *     the doubt" -- jika skor id >= 70% skor terbaik, tetap id.
 *   - Confidence minimal 15% supaya teks pendek/ambigu jatuh ke id.
 */

const STOPWORDS = {
  id: new Set([
    'yang','dan','di','ke','tidak','ada','untuk','dengan','ini','itu',
    'dari','atau','juga','akan','sudah','masih','bisa','tapi','apa',
    'kapan','dimana','gimana','siapa','bagaimana','kenapa','saya','aku',
    'kamu','kita','kami','mereka','iya','sih','dong','nya','lah','mau',
    'punya','yg','gak','enggak','engga','udah','udh','nggak','ga','dah',
    'aja','mas','kak','bro','gan','nih','dia','sama','pake','pakai','pas',
    'sebab','karna','karena','agar','supaya','jika','kalau','kalo','klo',
    'bgt','banget','sangat','lebih','paling','sekali','tuh','dpt','dapet',
    'dapat','blm','belum','kah','liat','lihat','ngga','lho','kok','jangan',
    'jgn','gua','gue','lu','lo','elo','gw','disini','disana','kemana',
    'kemarin','sekarang','besok','nanti','tadi','barusan','adalah','ialah',
    'tetapi','namun','meskipun','walaupun','seperti','contohnya','contoh',
    'misal','misalnya','dimanapun','kapanpun','tentang','soal','perihal',
  ]),
  en: new Set([
    'the','is','are','was','were','this','that','what','where','when',
    'why','how','can','will','do','does','did','have','has','had','with',
    'from','of','to','on','in','at','for','you','your','my','me','i','it',
    'its','but','or','and','also','just','like','a','an','about','who',
    'be','been','being','they','them','their','there','here','should',
    'would','could','if','then','than','because','since','though','although',
    'while','please','thanks','thank','hello','hi','hey','yes','no','nope',
    'okay','ok','very','really','some','any','all','many','much','more',
    'most','few','little','let','make','get','go','come','say','tell','give',
    'take','need','want','want','help','show','find','tell','know','think',
  ]),
  pt: new Set([
    'que','não','está','com','para','uma','dos','das','ele','ela','são',
    'foi','foram','mais','eles','elas','como','onde','quando','porque',
    'qual','quem','isso','isto','aquilo','mas','também','pelo','pela',
    'pelos','meu','minha','seu','sua','nossa','nosso','vocês','você','tu',
    'eu','sim','ou','no','na','nos','nas','um','uns','umas','já','ainda',
    'sempre','nunca','hoje','ontem','obrigado','obrigada','olá','oi','tem',
    'tenho','tinha','poder','posso','pode','quer','quero','vai','vou','foi',
    'fui','sou','seja','muito','muita','pouco','pouca','algum','alguma',
    'todo','toda','cada','agora','depois','antes','sobre','para','desde',
  ]),
};

const LANG_NAMES = {
  id: 'Indonesia',
  en: 'English',
  pt: 'Portuguese',
};

function detectLang(text) {
  if (!text || String(text).trim().length < 4) return 'id';
  const tokens = String(text).toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  if (tokens.length < 2) return 'id';

  const counts = { id: 0, en: 0, pt: 0 };
  for (const t of tokens) {
    for (const lang of Object.keys(STOPWORDS)) {
      if (STOPWORDS[lang].has(t)) counts[lang]++;
    }
  }
  const ratios = {
    id: counts.id / tokens.length,
    en: counts.en / tokens.length,
    pt: counts.pt / tokens.length,
  };
  const sorted = Object.entries(ratios).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];

  // Indonesian wins if its score >= 70% of the best non-id score
  if (best[0] !== 'id' && ratios.id >= best[1] * 0.7) return 'id';
  // Need >= 15% confidence -- otherwise default id
  if (best[1] < 0.15) return 'id';
  return best[0];
}

const ucfirst = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
const lower   = (s) => String(s).toLowerCase();

const T = {
  hello: {
    id: (n) => `halo, kenalin aku ${lower(n)} aku adalah AI paling ganteng sedunia, yang siap membantu menjawab pertanyaan kalian di server ini, tinggal sebut aja namaku "${lower(n)}" maka aku akan menjawab semua pertanyaan kalian`,
    en: (n) => `hi everyone, let me introduce myself, I'm ${lower(n)}, the most handsome AI in the world, ready to help answer your questions on this server. Just say my name "${lower(n)}" and I'll answer all your questions`,
    pt: (n) => `oi pessoal, deixa eu me apresentar, sou ${lower(n)}, a IA mais bonita do mundo, pronta pra ajudar a responder suas perguntas neste servidor. Só chamar meu nome "${lower(n)}" que eu respondo tudo`,
  },
  back: {
    id: (n) => `hoamm... enak banget ${lower(n)} tidurnya walau gak lama, udah siap bantu jawab pertanyaan kalian lagi nih @everyone`,
    en: (n) => `yawn... ${lower(n)} had a great nap even though it wasn't long, ready to help answer your questions again @everyone`,
    pt: (n) => `bocejo... ${lower(n)} tirou um cochilo gostoso embora não tenha sido longo, pronto pra ajudar a responder suas perguntas de novo @everyone`,
  },
  farewell: {
    id: (n) => `${ucfirst(n)} capek, ${lower(n)} tidur dulu yaa, babay semua... @everyone`,
    en: (n) => `${ucfirst(n)} is tired, ${lower(n)} is going to sleep first, bye everyone... @everyone`,
    pt: (n) => `${ucfirst(n)} está cansado, ${lower(n)} vai dormir primeiro, tchau a todos... @everyone`,
  },
  apiFail: {
    id: () => `maaf yah, token/API kamu salah/error nih, aku gagal mendarat`,
    en: () => `sorry, your token/API is wrong/error, I failed to land`,
    pt: () => `desculpe, seu token/API está errado/com erro, falhei em conectar`,
  },
  sabar: {
    id: () => `sabar ya kak, kasih aku mikir dulu 1 menit yaa`,
    en: () => `hold on please, give me 1 minute to think`,
    pt: () => `calma aí, me dá 1 minuto pra pensar`,
  },
  warn: {
    id: (n, m) => `jika kamu tidak bisa bersabar maka akan ${lower(n)} bungkam ya ${m}`,
    en: (n, m) => `if you can't be patient, ${lower(n)} will mute you ${m}`,
    pt: (n, m) => `se você não conseguir ter paciência, ${lower(n)} vai te silenciar ${m}`,
  },
  timeout: {
    id: (n, m) => `maaf yah ${m} ${lower(n)} bungkam, kamu gasabaran sih jadi manusia, ${lower(n)} robot bukan nabi boyyy...`,
    en: (n, m) => `sorry ${m} ${lower(n)} muted you, you're so impatient as a human, ${lower(n)} is a robot not a prophet, boyyy...`,
    pt: (n, m) => `desculpa ${m} ${lower(n)} te silenciou, você é muito impaciente como humano, ${lower(n)} é robô não profeta, mano...`,
  },
  empty: {
    id: (n) => `iya, ada apa? tanya aja, sebut "${lower(n)}" + pertanyaannya.`,
    en: (n) => `yeah, what's up? just ask, mention "${lower(n)}" + your question.`,
    pt: (n) => `oi, o que foi? só perguntar, mencione "${lower(n)}" + sua pergunta.`,
  },
  errorApi: {
    id: () => `aduh otak gue lagi nge-lag (API error). coba lagi sebentar yaa.`,
    en: () => `ugh my brain is lagging (API error). try again in a moment please.`,
    pt: () => `caramba, meu cérebro tá com lag (erro de API). tenta de novo daqui a pouco.`,
  },
};

function tr(key, lang, ...args) {
  const set = T[key];
  if (!set) return '';
  const fn = set[lang] || set.id;
  return fn(...args);
}

module.exports = { detectLang, tr, LANG_NAMES };

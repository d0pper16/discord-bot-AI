'use strict';

/**
 * Language detection saja - dipakai HANYA untuk instruksi prompt AI
 * supaya Gemini menjawab dalam bahasa user (id/en/pt + auto-fallback).
 *
 * Pesan boilerplate (hello/back/farewell/sabar/warn/timeout/empty/errorApi/apiFail)
 * TIDAK ditranslate -- selalu bahasa Indonesia.
 *
 * Kebijakan:
 *   - Default id (Indonesian benefit-of-the-doubt).
 *   - Translate hanya kalau foreign language dominan
 *     (id < 70% dari best score, dan best >= 15%).
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
    'take','need','want','help','show','find','know','think',
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
    'todo','toda','cada','agora','depois','antes','sobre','desde',
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
  if (best[0] !== 'id' && ratios.id >= best[1] * 0.7) return 'id';
  if (best[1] < 0.15) return 'id';
  return best[0];
}

module.exports = { detectLang, LANG_NAMES };

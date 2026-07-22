// Shared language toggle (English / Simplified Chinese), used across every page.
// Each page defines its own dictionary: { key: { en: '...', zh: '...' } }
// and calls initI18n(dict) once its DOM is ready. Static text is marked with
// data-i18n="key" and swapped automatically; dynamic in-game text should call
// t(dict, 'key') instead of hardcoding an English string.
const I18N_KEY = 'ta101_lang';

function getLang() {
    return localStorage.getItem(I18N_KEY) || 'en';
}

function setLang(lang) {
    localStorage.setItem(I18N_KEY, lang);
}

function t(dict, key) {
    const entry = dict[key];
    if (!entry) return key;
    const lang = getLang();
    return entry[lang] !== undefined ? entry[lang] : entry.en;
}

function applyTranslations(dict) {
    const lang = getLang();
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const entry = dict[el.dataset.i18n];
        if (entry && entry[lang] !== undefined) el.textContent = entry[lang];
    });
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('.lang-toggle').forEach(btn => {
        btn.textContent = lang === 'zh' ? 'EN' : '中文';
    });
}

function initI18n(dict) {
    applyTranslations(dict);
    document.querySelectorAll('.lang-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            setLang(getLang() === 'zh' ? 'en' : 'zh');
            applyTranslations(dict);
            if (typeof onLangChange === 'function') onLangChange();
        });
    });
}

import React, { createContext, useContext, useState } from 'react';
import { t, Lang, TranslationKey } from '../services/i18n';

interface LanguageContextType {
    lang: Lang;
    setLang: (l: Lang) => void;
    t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType>({
    lang: 'BM',
    setLang: () => { },
    t: (key) => key,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const stored = (localStorage.getItem('ksb_lang') as Lang) || 'BM';
    const [lang, setLangState] = useState<Lang>(stored);

    const setLang = (l: Lang) => {
        localStorage.setItem('ksb_lang', l);
        setLangState(l);
    };

    const translate = (key: TranslationKey) => t(key, lang);

    return (
        <LanguageContext.Provider value={{ lang, setLang, t: translate }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => useContext(LanguageContext);

export default LanguageContext;

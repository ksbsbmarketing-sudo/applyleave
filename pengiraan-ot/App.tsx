import React, { useState } from 'react';
import { useLanguage } from './components/LanguageContext';
import { OvertimeView } from './components/OvertimeView';

const App: React.FC = () => {
  const { lang, setLang } = useLanguage();
  const isPrintMode = window.location.search.includes('print=true');
  const isDownloadMode = window.location.search.includes('download=true');

  if (isPrintMode || isDownloadMode) {
    return (
      <div className="bg-white min-h-screen selection:bg-blue-100">
        <OvertimeView isPrintMode={isPrintMode} isDownloadMode={isDownloadMode} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e0e5ec] p-4 md:p-8 overflow-x-hidden flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-6xl flex flex-col sm:flex-row justify-between items-center sm:items-end gap-6 mb-12 animate-fade-in relative z-10 print-only:hidden">
        <div className="text-center sm:text-left">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-gray-700 tracking-tighter drop-shadow-md">
            KSB Pengiraan OT <span className="text-blue-500 relative cursor-pointer group">Pro.
              <span className="absolute -top-1 -right-4 w-3 h-3 bg-green-400 rounded-full animate-ping"></span>
              <span className="absolute -top-1 -right-4 w-3 h-3 bg-green-500 rounded-full"></span>
            </span>
          </h1>
          <p className="font-bold text-gray-500 mt-2 uppercase tracking-widest text-[10px] sm:text-xs drop-shadow-sm flex items-center justify-center sm:justify-start gap-2">
            Automated Overtime Gateway (Offline)
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="bg-neu-base shadow-neu-pressed-sm rounded-full p-2 flex items-center gap-2">
            <button onClick={() => setLang('BI')} className={`px-4 py-2 rounded-full text-xs font-black transition-all ${lang === 'BI' ? 'bg-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'text-gray-400 hover:text-blue-400'}`}>EN</button>
            <button onClick={() => setLang('BM')} className={`px-4 py-2 rounded-full text-xs font-black transition-all ${lang === 'BM' ? 'bg-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'text-gray-400 hover:text-blue-400'}`}>BM</button>
          </div>
        </div>
      </div>

      <OvertimeView isPrintMode={false} />
    </div>
  );
}

export default App;

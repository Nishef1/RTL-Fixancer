(() => {
    'use strict';

    const common = window.RTLFixancerCommon;
    if (!common?.registerLanguage) return;

    common.registerLanguage({
        code: 'ar',
        name: 'Arabic',
        regex: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
        fontStack: 'Noto Naskh Arabic, Noto Sans Arabic, Segoe UI, Tahoma, Arial, sans-serif',
        direction: 'rtl'
    });
})();

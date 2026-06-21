(() => {
    'use strict';

    const common = window.RTLFixancerCommon;
    if (!common?.registerLanguage) return;

    common.registerLanguage({
        code: 'he',
        name: 'Hebrew',
        regex: /[\u0590-\u05FF\uFB1D-\uFB4F]/,
        fontStack: 'Noto Sans Hebrew, Arial Hebrew, Segoe UI, Tahoma, Arial, sans-serif',
        direction: 'rtl'
    });
})();

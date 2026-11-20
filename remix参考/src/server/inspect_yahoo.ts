import yf from 'yahoo-finance2';
console.log('Default export keys:', Object.keys(yf || {}));
console.log('Type of default export:', typeof yf);

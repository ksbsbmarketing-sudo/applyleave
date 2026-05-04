const fs = require('fs');
const file = 'c:/Users/klini/Desktop/neuhr---smart-leave-tracker/services/firebase.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/branch: 'Operation'/g, "branch: 'Klinik Syed Badaruddin Balok (HQ)'");
fs.writeFileSync(file, content);

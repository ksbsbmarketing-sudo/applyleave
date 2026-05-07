const fs = require('fs');
const mainPath = 'C:/Users/user/.gemini/antigravity/scratch/applyleave/src/main.js';
const scratchPath = 'C:/Users/user/.gemini/antigravity/brain/72216168-29ed-4d5b-90b5-f652490d0170/browser/scratchpad_hzutlf23.md';

try {
  const scratchContent = fs.readFileSync(scratchPath, 'utf8');
  let jsonStr = scratchContent.match(/\[\s*\{[\s\S]*?\]/)[0];
  const staffData = JSON.parse(jsonStr);
  
  let mainContent = fs.readFileSync(mainPath, 'utf8');
  
  // Notice the pattern: const staffList = [ ... \n].map(...);
  const regex = /const staffList = \[\s*[\s\S]*?\]\.map\([\s\S]*?\)\);/;
  
  if(regex.test(mainContent)) {
    mainContent = mainContent.replace(regex, `const staffList = ${JSON.stringify(staffData, null, 2)};`);
    fs.writeFileSync(mainPath, mainContent);
    console.log("Successfully replaced staffList in main.js with detailed data (" + staffData.length + " entries).");
  } else {
    console.log("Could not find the target staffList block to replace.");
  }
} catch (e) {
  console.error("Error updating files:", e);
}

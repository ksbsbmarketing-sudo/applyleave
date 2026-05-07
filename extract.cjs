const fs = require('fs');
const filepath = 'C:/Users/user/.gemini/antigravity/brain/72216168-29ed-4d5b-90b5-f652490d0170/.system_generated/steps/52/content.md';
try {
  let content = fs.readFileSync(filepath, 'utf8');
  let ics = [...content.matchAll(/ic\s*:\s*["'](\d+)["']/gi)].map(m => m[1]);
  let names = [...content.matchAll(/name\s*:\s*["']([^"']+)["']/gi)].map(m => m[1]);
  
  // Alternative: match whole objects
  let regexObj = /\{[^{}]*name\s*:\s*["']([^"']+)["'][^{}]*ic\s*:\s*["'](\d+)["'][^{}]*\}/gi;
  let matches = [...content.matchAll(regexObj)];
  
  let regexObj2 = /\{[^{}]*ic\s*:\s*["'](\d+)["'][^{}]*name\s*:\s*["']([^"']+)["'][^{}]*\}/gi;
  let matches2 = [...content.matchAll(regexObj2)];

  let results = [];
  matches.forEach(m => results.push({ name: m[1], ic: m[2] }));
  matches2.forEach(m => results.push({ name: m[2], ic: m[1] }));
  
  if (results.length === 0) {
     console.log("No exact objects found. Dumping possible pairs or nearby content.");
     // Try a broader regex
     let broad = /(?:name\s*:\s*["']([^"']+)["'].{0,50}ic\s*:\s*["'](\d+)["'])|(?:ic\s*:\s*["'](\d+)["'].{0,50}name\s*:\s*["']([^"']+)["'])/gi;
     let broadMatches = [...content.matchAll(broad)];
     broadMatches.forEach(m => {
       if (m[1]) results.push({ name: m[1], ic: m[2] });
       else results.push({ name: m[4], ic: m[3] });
     });
  }
  
  console.log("EXTRACTED_STAFF:");
  console.log(JSON.stringify(results, null, 2));

} catch (err) {
  console.error("Error reading file:", err);
}

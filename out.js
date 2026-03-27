const fs = require('fs');
const glob = require('glob');
const path = require('path');

const files = glob.sync('out/**/*.html');
files.forEach((file) => {
  let content = fs.readFileSync(file, 'utf-8');
  
  // 1. Fix _next paths to be relative for Chrome extensions
  content = content.replace(/\/_next/g, './next');

  // 2. Fix inline scripts CSP violations (Chrome Extension Manifest V3 strictly blocks inline Javascript)
  // We extract any inline <script> tag into an external file and reference it
  const scriptRegex = /<script(?![^>]*src=)([^>]*)>(.*?)<\/script>/gs;
  let scriptCounter = 0;

  content = content.replace(scriptRegex, (match, attrs, body) => {
    // Ignore JSON data scripts like __NEXT_DATA__
    if (attrs.includes('type="application/json"')) {
      return match;
    }

    if (body.trim()) {
      const filename = `${path.basename(file, '.html')}-inline-${scriptCounter++}.js`;
      const filePath = path.join(path.dirname(file), filename);
      
      // Save the inline Javascript into a real file
      fs.writeFileSync(filePath, body, 'utf-8');
      
      // Return a standard link to the extracted file instead of inline script
      return `<script${attrs} src="./${filename}"></script>`;
    }
    
    return match;
  });

  fs.writeFileSync(file, content, 'utf-8');
});

// Rename the _next directory to avoid Chrome Extension reserved underscore issues
const sourcePath = 'out/_next';
const destinationPath = 'out/next';

if (fs.existsSync(sourcePath)) {
  fs.renameSync(sourcePath, destinationPath);
  console.log('Renamed "_next" directory to "next" successfully.');
} else if (fs.existsSync(destinationPath)) {
  console.log('Directory "next" already exists.');
}

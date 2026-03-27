const fs = require('fs');
const glob = require('glob');
const path = require('path');

// 1. Process HTML files for CSP inline script extraction
const htmlFiles = glob.sync('out/**/*.html');
htmlFiles.forEach((file) => {
  let content = fs.readFileSync(file, 'utf-8');
  
  // Extract inline <script> tag into an external file and reference it (CSP fix)
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

// 2. Rename _next directory to next (avoids Chrome reserved '_' prefix issues)
const sourcePath = 'out/_next';
const destinationPath = 'out/next';

if (fs.existsSync(sourcePath)) {
  fs.renameSync(sourcePath, destinationPath);
  console.log('Renamed "_next" directory to "next" successfully.');
} else if (fs.existsSync(destinationPath)) {
  console.log('Directory "next" already exists.');
}

// 3. Fix absolute '/_next/' paths internally within all exported CSS and JS files
// Next.js chunks natively try to fetch additional scripts from /_next/, which 404s in an extension
const allFiles = glob.sync('out/**/*.{html,js,css,json}');
allFiles.forEach((file) => {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('/_next/')) {
    const modifiedContent = content.replace(/\/_next\//g, './next/');
    fs.writeFileSync(file, modifiedContent, 'utf-8');
  }
});

console.log('Processed Chrome Extension Static Export Fixes.');

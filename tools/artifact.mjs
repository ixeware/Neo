// Turns the single-file Vite build into an Artifact page (the host adds doctype/head/body).
import fs from 'node:fs';
const [src = 'dist/index.html', out = 'dist/artifact.html'] = process.argv.slice(2);
const html = fs.readFileSync(src, 'utf8');
const grab = re => { const m = html.match(re); if (!m) throw new Error('missing ' + re); return m; };
const title = grab(/<title>[\s\S]*?<\/title>/)[0];
const links = (html.match(/<link [^>]*>/g) || []).join('\n');
const style = grab(/<style[\s\S]*?<\/style>/)[0];
const script = grab(/<script type="module"[\s\S]*?<\/script>/)[0].replace(' crossorigin', '');
const body = grab(/<body>([\s\S]*?)<\/body>/)[1].trim();
fs.writeFileSync(out, `${title}\n${links}\n${style}\n${body}\n${script}\n`);
console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);

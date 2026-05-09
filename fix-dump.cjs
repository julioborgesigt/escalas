const fs = require('fs');
const content = fs.readFileSync('dump.sql', 'utf8');
fs.writeFileSync('dump_fixed.sql', 'PRAGMA foreign_keys=OFF;\n' + content, 'utf8');

// syntax check of the builder script embedded in SKILL.md
const fs = require("fs");
const md = fs.readFileSync("powershell/offline/skills/ifrs16-lease/SKILL.md", "utf8");
const m = md.match(/```js\n([\s\S]*?)```/);
if (!m) { console.log("NO SCRIPT BLOCK"); process.exit(1); }
const code = m[1];
try {
  new (require("vm").Script)("(async () => {" + code + "})");
  console.log("JS SYNTAX OK, script length:", code.length, "chars");
} catch (e) {
  console.log("SYNTAX ERROR:", e.message);
  const lines = code.split("\n");
  process.exit(1);
}

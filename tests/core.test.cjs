
const {test}=require("node:test");
const assert=require("node:assert/strict");
const core=require("../assets/core.js");
test("URLs reject executable schemes and embedded credentials",()=>{
  for(const input of ["javascript:alert(1)","data:text/html,hi","https://user:pass@example.com","https://bad host.com","file:///etc/passwd"]) assert.equal(core.normaliseSite(input),"",input);
  assert.equal(core.normaliseSite("example.com"),"https://example.com");
  assert.equal(core.normHost("https://WWW.Example.com/path?q=1"),"example.com");
});
test("CSV cells neutralize spreadsheet formulas and quote content",()=>{
  for(const input of ["=cmd()","+cmd()","-cmd()","@cmd()","\t=cmd()"," \r+cmd()"]) assert.ok(core.csvCell(input).startsWith('"\''));
  assert.equal(core.csvCell('a,"b"'),'"a,""b"""');
  assert.equal(core.csvCell(null),'""');
});
test("Preferences validate arbitrary imported or stored values",()=>{
  assert.deepEqual(core.validatePreferences({theme:"evil",accent:"red;display:none",density:"broken",defaultSite:"javascript:x",brand:"x".repeat(100)}),{theme:"system",accent:"#0f766e",density:"comfortable",brand:"x".repeat(60),defaultSite:"",strategy:"mobile"});
});

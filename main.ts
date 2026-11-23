import * as fs from "node:fs";

// Tiny stack VM (ISA v1): 32-bit wrapping ints, 256-value data stack,
// 64-entry call stack, 256 words of memory. Runs every /input/<id>/
// program.bin with its input.bin and writes /output/<id>/stdout.bin
// and /output/<id>/exit.txt. Written from ISA.md.
function run(prog, input) {
  const st = [];
  const cs = [];
  const mem = new Int32Array(256);
  const out = [];
  let pc = 0, ip = 0, steps = 0;
  const pop = () => { if (!st.length) throw 2; return st.pop(); };
  const push = (v) => { if (st.length >= 256) throw 3; st.push(v | 0); };
  const u = (x) => x >>> 0;
  try {
    for (;;) {
      if (steps >= 1000000) throw 10;
      if (pc < 0 || pc >= prog.length) throw 9;
      const op = prog[pc];
      const ok = op <= 7 || (op >= 0x10 && op <= 0x1e) || (op >= 0x20 && op <= 0x22)
        || (op >= 0x30 && op <= 0x34) || op === 0x40 || op === 0x41
        || (op >= 0x50 && op <= 0x53);
      if (!ok) throw 5;
      let n = 0;
      if (op === 1) n = 1; else if (op === 2) n = 4;
      else if (op >= 0x30 && op <= 0x33) n = 2;
      if (pc + 1 + n > prog.length) throw 9;
      steps++;
      const nx = pc + 1 + n;
      const i16 = () => { const v = prog[pc + 1] | (prog[pc + 2] << 8); return (v << 16) >> 16; };
      const u16 = () => prog[pc + 1] | (prog[pc + 2] << 8);
      switch (op) {
        case 0x00: return [Buffer.from(out), 0];
        case 0x01: push((prog[pc + 1] << 24) >> 24); pc = nx; break;
        case 0x02: push(prog.readInt32LE(pc + 1)); pc = nx; break;
        case 0x03: pop(); pc = nx; break;
        case 0x04: { const a = pop(); push(a); push(a); pc = nx; break; }
        case 0x05: { const b = pop(), a = pop(); push(b); push(a); pc = nx; break; }
        case 0x06: { const b = pop(), a = pop(); push(a); push(b); push(a); pc = nx; break; }
        case 0x07: { const c = pop(), b = pop(), a = pop(); push(b); push(c); push(a); pc = nx; break; }
        case 0x10: { const b = pop(), a = pop(); push(a + b); pc = nx; break; }
        case 0x11: { const b = pop(), a = pop(); push(a - b); pc = nx; break; }
        case 0x12: { const b = pop(), a = pop(); push(Math.imul(a, b)); pc = nx; break; }
        case 0x13: { const b = pop(), a = pop(); if (!b) throw 4; push(Math.trunc(a / b) | 0); pc = nx; break; }
        case 0x14: { const b = pop(), a = pop(); if (!b) throw 4; push((a % b) | 0); pc = nx; break; }
        case 0x15: { const b = pop(), a = pop(); if (!b) throw 4; push((Math.trunc(u(a) / u(b))) | 0); pc = nx; break; }
        case 0x16: { const b = pop(), a = pop(); if (!b) throw 4; push((u(a) % u(b)) | 0); pc = nx; break; }
        case 0x17: { push(-pop()); pc = nx; break; }
        case 0x18: { const b = pop(), a = pop(); push(a & b); pc = nx; break; }
        case 0x19: { const b = pop(), a = pop(); push(a | b); pc = nx; break; }
        case 0x1a: { const b = pop(), a = pop(); push(a ^ b); pc = nx; break; }
        case 0x1b: { push(~pop()); pc = nx; break; }
        case 0x1c: { const b = pop(), a = pop(); push(a << (b & 31)); pc = nx; break; }
        case 0x1d: { const b = pop(), a = pop(); push(a >> (b & 31)); pc = nx; break; }
        case 0x1e: { const b = pop(), a = pop(); push((a >>> (b & 31)) | 0); pc = nx; break; }
        case 0x20: { const b = pop(), a = pop(); push(a === b ? 1 : 0); pc = nx; break; }
        case 0x21: { const b = pop(), a = pop(); push(a < b ? 1 : 0); pc = nx; break; }
        case 0x22: { const b = pop(), a = pop(); push(u(a) < u(b) ? 1 : 0); pc = nx; break; }
        case 0x30: pc = nx + i16(); break;
        case 0x31: { const v = pop(); pc = v === 0 ? nx + i16() : nx; break; }
        case 0x32: { const v = pop(); pc = v !== 0 ? nx + i16() : nx; break; }
        case 0x33: if (cs.length >= 64) throw 7; cs.push(nx); pc = u16(); break;
        case 0x34: if (!cs.length) throw 8; pc = cs.pop(); break;
        case 0x40: { const a = pop(); if (a < 0 || a > 255) throw 6; push(mem[a]); pc = nx; break; }
        case 0x41: { const a = pop(), v = pop(); if (a < 0 || a > 255) throw 6; mem[a] = v; pc = nx; break; }
        case 0x50: { const v = pop(), s = String(v); if (out.length + s.length > 65536) throw 11; for (const ch of s) out.push(ch.charCodeAt(0)); pc = nx; break; }
        case 0x51: { const v = pop(); if (out.length + 1 > 65536) throw 11; out.push(v & 255); pc = nx; break; }
        case 0x52: push(ip < input.length ? input[ip++] : -1); pc = nx; break;
        case 0x53: { const v = pop(); return [Buffer.from(out), v & 255]; }
      }
    }
  } catch (e) {
    return [Buffer.from(out), e];
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const O = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
for (const id of fs.readdirSync(I).sort()) {
  const dir = I + "/" + id;
  if (!fs.statSync(dir).isDirectory()) continue;
  const prog = fs.readFileSync(dir + "/program.bin");
  const input = fs.existsSync(dir + "/input.bin") ? fs.readFileSync(dir + "/input.bin") : Buffer.alloc(0);
  const [stdout, code] = run(prog, input);
  fs.mkdirSync(O + "/" + id, { recursive: true });
  fs.writeFileSync(O + "/" + id + "/stdout.bin", stdout);
  fs.writeFileSync(O + "/" + id + "/exit.txt", String(code) + "\n");
}

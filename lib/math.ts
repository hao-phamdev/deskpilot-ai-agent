/**
 * Safe math evaluator (recursive-descent parser). Never uses eval() / Function(),
 * so an LLM-supplied expression cannot execute code.
 *
 * Grammar:
 *   expr   := term (('+' | '-') term)*
 *   term   := power (('*' | '/' | '%') power)*
 *   power  := unary ('^' power)?
 *   unary  := ('-' | '+') unary | call
 *   call   := IDENT '(' expr (',' expr)* ')' | IDENT | NUMBER | '(' expr ')'
 */
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  log: Math.log10,
  ln: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function evaluate(input: string): number {
  const src = input.replace(/×/g, "*").replace(/÷/g, "/");
  let i = 0;

  const peek = () => {
    while (src[i] === " ") i++;
    return src[i];
  };
  const fail = (msg: string): never => {
    throw new Error(`${msg} at position ${i + 1} in "${input}"`);
  };

  function parseExpr(): number {
    let v = parseTerm();
    for (let c = peek(); c === "+" || c === "-"; c = peek()) {
      i++;
      v = c === "+" ? v + parseTerm() : v - parseTerm();
    }
    return v;
  }
  function parseTerm(): number {
    let v = parsePower();
    for (let c = peek(); c === "*" || c === "/" || c === "%"; c = peek()) {
      i++;
      const r = parsePower();
      if (c === "*") v *= r;
      else if (c === "/") {
        if (r === 0) fail("Division by zero");
        v /= r;
      } else v %= r;
    }
    return v;
  }
  function parsePower(): number {
    const base = parseUnary();
    if (peek() === "^") {
      i++;
      return base ** parsePower();
    }
    return base;
  }
  function parseUnary(): number {
    const c = peek();
    if (c === "-") {
      i++;
      return -parseUnary();
    }
    if (c === "+") {
      i++;
      return parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const c = peek();
    if (c === "(") {
      i++;
      const v = parseExpr();
      if (peek() !== ")") fail("Expected ')'");
      i++;
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const id = /^[a-z]+/i.exec(src.slice(i));
    if (id) {
      const name = id[0].toLowerCase();
      i += id[0].length;
      if (peek() === "(") {
        const fn = FUNCS[name] ?? fail(`Unknown function "${name}"`);
        i++;
        const args = [parseExpr()];
        while (peek() === ",") {
          i++;
          args.push(parseExpr());
        }
        if (peek() !== ")") fail("Expected ')'");
        i++;
        return fn(...args);
      }
      if (name in CONSTS) return CONSTS[name];
      fail(`Unknown name "${name}"`);
    }
    return fail(c === undefined ? "Unexpected end of expression" : `Unexpected character "${c}"`);
  }

  const result = parseExpr();
  if (peek() !== undefined) fail(`Unexpected character "${peek()}"`);
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}

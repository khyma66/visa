import { readFile } from 'node:fs/promises';
import ts from 'typescript';
export const destinationModule = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL('../src/lib/destination-routing.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`;

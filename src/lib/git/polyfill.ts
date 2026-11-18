/**
 * isomorphic-git 是按 Node 生态写的，代码里直接用全局 `Buffer` / `process`。
 * 浏览器（Vite 的 ESM 构建）没有这两个全局量，缺了就会在第一次读写 Git 对象时
 * 抛 `Buffer is not defined`。这里在模块加载阶段补上最小实现 —— 必须在任何
 * isomorphic-git 调用之前执行，所以由 `repo.ts` 顶部导入。
 */
import { Buffer as NodeBuffer } from 'buffer'

type MinimalProcess = {
  env: Record<string, string | undefined>
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void
}

/** 直接按「可能缺字段」的普通对象看待全局，避免和 @types/node 的 Process 打架 */
const globals = globalThis as unknown as {
  Buffer?: typeof NodeBuffer
  process?: MinimalProcess
}

if (typeof globals.Buffer === 'undefined') {
  globals.Buffer = NodeBuffer
}

if (typeof globals.process === 'undefined') {
  // 只补 isomorphic-git 真正用到的两个字段；不需要完整的 Node process
  globals.process = {
    env: {},
    nextTick: (fn, ...args) => {
      queueMicrotask(() => fn(...args))
    },
  }
}

export {}

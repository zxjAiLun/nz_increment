/**
 * Phase 3.25：Rune 面板共享类型。
 *
 * 三个面板子 composable（useRuneEmbedPanel / useRuneFeedPanel / useRuneBatchLockPanel）
 * 与顶层 controller 共用同一反馈通道类型。独立成文件是为了保证
 * 「子 composable 之间不互相 import」（互斥与协调只由顶层 controller 负责）。
 */
export type RunePanelFeedback = { kind: 'success' | 'error'; message: string } | null

/**
 * Host/process metrics for the dashboard System page, using Node built-ins
 * only (no extra dependency). Results are cached for 1s so a fast UI tick or
 * the 5s SSE stream never hammers the OS.
 *
 * Network throughput (rx/tx) is intentionally omitted — it's optional per the
 * dashboard design and not available cheaply via built-ins.
 */
import os from 'os';
import fs from 'fs';

export interface SystemMetrics {
  ts: number;
  cpu: {
    cores: number;
    model: string;
    loadavg: [number, number, number] | null;
    /** per-core utilisation 0..100 since the previous sample */
    perCore: number[];
    /** system-wide CPU utilisation 0..100 (average of `perCore`) */
    total: number;
    /** AIOStreams process CPU utilisation 0..100 (normalised over all cores). */
    process: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    heapUsed: number;
    rss: number;
  };
  disk: { path: string; total: number; used: number; free: number } | null;
  process: {
    uptimeSec: number;
    nodeVersion: string;
    pid: number;
    platform: string;
  };
}

type CpuTimes = { idle: number; total: number };

let lastSample: CpuTimes[] | null = null;
/** Process CPU sample anchor: previous `cpuUsage()` (µs) + wall time (ms). */
let lastProcSample: { usage: NodeJS.CpuUsage; ts: number } | null = null;
let cache: { at: number; data: SystemMetrics } | null = null;

function sampleCpus(): CpuTimes[] {
  return os.cpus().map((c) => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { idle: t.idle, total };
  });
}

/**
 * Process CPU utilisation since the previous call as a percentage of one full
 * core (so 100 = "one core saturated"). Divides by `cores` so the figure is
 * comparable to the system-wide `cpu.total` value. Returns 0 on the first call.
 */
function sampleProcessCpu(cores: number): number {
  const usage = process.cpuUsage();
  const ts = Date.now();
  if (!lastProcSample) {
    lastProcSample = { usage, ts };
    return 0;
  }
  const dUser = usage.user - lastProcSample.usage.user; // µs
  const dSys = usage.system - lastProcSample.usage.system;
  const dWall = (ts - lastProcSample.ts) * 1000; // ms → µs
  lastProcSample = { usage, ts };
  if (dWall <= 0) return 0;
  const ratio = (dUser + dSys) / dWall / Math.max(1, cores);
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function systemDiskRoot(): string {
  return os.platform() === 'win32' ? (process.env.SystemDrive ?? 'C:\\') : '/';
}

async function diskFor(dir: string): Promise<SystemMetrics['disk']> {
  try {
    const sf = await fs.promises.statfs(dir);
    const total = sf.bsize * sf.blocks;
    const free = sf.bsize * sf.bavail;
    return { path: dir, total, used: total - free, free };
  } catch {
    return null;
  }
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  if (cache && Date.now() - cache.at < 1000) return cache.data;

  const cur = sampleCpus();
  const perCore = cur.map((c, i) => {
    const prev = lastSample?.[i];
    if (!prev) return 0;
    const dTotal = c.total - prev.total;
    const dIdle = c.idle - prev.idle;
    if (dTotal <= 0) return 0;
    return Math.round((1 - dIdle / dTotal) * 100);
  });
  lastSample = cur;
  const total =
    perCore.length > 0
      ? Math.round(perCore.reduce((a, b) => a + b, 0) / perCore.length)
      : 0;
  const cores = os.cpus().length;
  const processPct = sampleProcessCpu(cores);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const mem = process.memoryUsage();
  const laRaw = os.loadavg();
  const la: [number, number, number] | null =
    os.platform() === 'win32' ? null : [laRaw[0], laRaw[1], laRaw[2]];

  const data: SystemMetrics = {
    ts: Date.now(),
    cpu: {
      cores,
      model: os.cpus()[0]?.model ?? 'unknown',
      loadavg: la,
      perCore,
      total,
      process: processPct,
    },
    memory: {
      total: totalMem,
      used: totalMem - freeMem,
      free: freeMem,
      heapUsed: mem.heapUsed,
      rss: mem.rss,
    },
    disk: await diskFor(systemDiskRoot()),
    process: {
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
      platform: `${os.type()} ${os.release()}`,
    },
  };

  cache = { at: Date.now(), data };
  return data;
}

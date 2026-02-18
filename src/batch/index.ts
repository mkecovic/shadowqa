import crypto from "crypto";
import fs from "fs";
import path from "path";
import { AsyncQueue } from "./queue.js";
import { processComparison } from "../compare/process.js";
import type { Batch, BatchJob, BatchMeta } from "./types.js";

export class BatchManager {
  private batches = new Map<string, Batch>();
  private queue: AsyncQueue;
  private reportsDir: string;
  private onSummaryReady?: (batchId: string) => void;

  constructor(reportsDir: string, concurrency = 3) {
    this.reportsDir = reportsDir;
    this.queue = new AsyncQueue(concurrency);
  }

  setOnSummaryReady(cb: (batchId: string) => void): void {
    this.onSummaryReady = cb;
  }

  createBatch(
    pairs: { sourceUrl: string; targetUrl: string }[],
    viewport: { width: number; height: number }
  ): Batch {
    const batchId = crypto.randomUUID();
    const jobs: BatchJob[] = pairs.map((p) => ({
      jobId: crypto.randomUUID(),
      sourceUrl: p.sourceUrl,
      targetUrl: p.targetUrl,
      status: "pending" as const,
      progress: 0,
    }));

    const batch: Batch = {
      id: batchId,
      jobs,
      status: "pending",
      viewport,
      createdAt: new Date().toISOString(),
    };

    this.batches.set(batchId, batch);
    return batch;
  }

  startBatch(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    batch.status = "running";
    this.saveBatchMeta(batch);

    const jobPromises = batch.jobs.map((job) =>
      this.queue.add(() => this.processJob(batch, job))
    );

    Promise.allSettled(jobPromises).then(async () => {
      const hasErrors = batch.jobs.some((j) => j.status === "error");
      const allComplete = batch.jobs.every(
        (j) => j.status === "complete" || j.status === "error"
      );

      if (allComplete) {
        batch.status = hasErrors ? "error" : "complete";
        batch.completedAt = new Date().toISOString();

        try {
          await this.generateSummary(batch);
        } catch (err) {
          console.error(`Failed to generate summary for batch ${batchId}:`, err);
        }

        this.saveBatchMeta(batch);

        if (this.onSummaryReady) {
          this.onSummaryReady(batchId);
        }
      }
    });
  }

  getBatch(batchId: string): BatchMeta | null {
    const batch = this.batches.get(batchId);
    if (!batch) {
      // Try loading from disk
      const metaPath = path.join(this.reportsDir, `${batchId}.batch.json`);
      if (fs.existsSync(metaPath)) {
        try {
          return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        } catch {
          return null;
        }
      }
      return null;
    }
    return this.toBatchMeta(batch);
  }

  listBatches(limit = 10): BatchMeta[] {
    const files = fs
      .readdirSync(this.reportsDir)
      .filter((f) => f.endsWith(".batch.json"));

    const metas: BatchMeta[] = files
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(this.reportsDir, f), "utf-8")
          ) as BatchMeta;
        } catch {
          return null;
        }
      })
      .filter((m): m is BatchMeta => m !== null)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, limit);

    // Also include any in-memory batches not yet on disk
    for (const [, batch] of this.batches) {
      if (!metas.some((m) => m.id === batch.id)) {
        metas.push(this.toBatchMeta(batch));
      }
    }

    return metas
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, limit);
  }

  private async processJob(batch: Batch, job: BatchJob): Promise<void> {
    job.status = "running";
    job.progress = 0;
    this.saveBatchMeta(batch);

    try {
      const result = await processComparison(
        job.sourceUrl,
        job.targetUrl,
        batch.viewport,
        this.reportsDir,
        (_status, progress) => {
          job.progress = progress;
          this.saveBatchMeta(batch);
        }
      );

      job.status = "complete";
      job.progress = 100;
      job.reportId = result.reportId;
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      console.error(
        `Batch ${batch.id} job ${job.jobId} failed:`,
        job.error
      );
    }

    this.saveBatchMeta(batch);
  }

  private async generateSummary(batch: Batch): Promise<void> {
    // Lazy import to avoid circular dependencies
    const { buildBatchSummaryReport } = await import(
      "../report/summary.js"
    );

    // Load individual report metas for completed jobs
    const individualMetas: any[] = [];
    for (const job of batch.jobs) {
      if (job.reportId) {
        const metaPath = path.join(
          this.reportsDir,
          `${job.reportId}.meta.json`
        );
        if (fs.existsSync(metaPath)) {
          try {
            individualMetas.push(
              JSON.parse(fs.readFileSync(metaPath, "utf-8"))
            );
          } catch {
            // skip
          }
        }
      }
    }

    const batchMeta = this.toBatchMeta(batch);
    const summaryHtml = buildBatchSummaryReport(batchMeta, individualMetas);
    const summaryId = `${batch.id}-summary`;

    fs.writeFileSync(
      path.join(this.reportsDir, `${summaryId}.html`),
      summaryHtml
    );

    batch.summaryReportId = summaryId;
  }

  private toBatchMeta(batch: Batch): BatchMeta {
    return {
      id: batch.id,
      status: batch.status,
      viewport: batch.viewport,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
      totalJobs: batch.jobs.length,
      completedJobs: batch.jobs.filter((j) => j.status === "complete").length,
      failedJobs: batch.jobs.filter((j) => j.status === "error").length,
      summaryReportId: batch.summaryReportId,
      jobs: batch.jobs.map((j) => ({
        jobId: j.jobId,
        sourceUrl: j.sourceUrl,
        targetUrl: j.targetUrl,
        status: j.status,
        progress: j.progress,
        reportId: j.reportId,
        error: j.error,
      })),
    };
  }

  deleteBatch(batchId: string): boolean {
    // Remove from memory
    this.batches.delete(batchId);

    // Remove batch meta file
    const metaPath = path.join(this.reportsDir, `${batchId}.batch.json`);
    if (!fs.existsSync(metaPath)) return false;

    // Read meta to find summary report
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as BatchMeta;
      if (meta.summaryReportId) {
        const summaryPath = path.join(this.reportsDir, `${meta.summaryReportId}.html`);
        if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
      }
    } catch {
      // Continue with deletion even if meta parse fails
    }

    fs.unlinkSync(metaPath);
    return true;
  }

  private saveBatchMeta(batch: Batch): void {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }

    const meta = this.toBatchMeta(batch);
    fs.writeFileSync(
      path.join(this.reportsDir, `${batch.id}.batch.json`),
      JSON.stringify(meta)
    );
  }
}
